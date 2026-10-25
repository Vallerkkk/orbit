import SwiftUI
import Observation
import Supabase
import UserNotifications
import UIKit

@MainActor @Observable
final class AppSession {
    enum Phase: Equatable { case loading, signIn, signedIn, failed }
    var phase: Phase = .loading
    var error: String?
    var busy = false
    var isDemo = false
    private(set) var userId: UUID?
    private(set) var api: APIClient?
    private(set) var directory = DirectoryStore()
    private(set) var feed = FeedStore()
    private(set) var media = MediaStore()
    let calls = CallCoordinator()
    var drafts: [String: String] = [:] // In-memory only; cleared at sign-out.
    private var authTask: Task<Void, Never>?
    private var revision = UUID()
    private var nativePushToken: String?
    private var pushObserver: NSObjectProtocol?

    init() {
        pushObserver = NotificationCenter.default.addObserver(forName: .orbitaAPNsToken, object: nil, queue: .main) { [weak self] note in
            guard let token = note.object as? String else { return }
            Task { @MainActor [weak self] in
                self?.nativePushToken = token
                await self?.syncNativePushToken()
            }
        }
    }

    func launch() async {
        guard !isDemo else { return }
        phase = .loading
        error = nil
        do {
            let client = try await APIClient.bootstrap()
            api = client
            media.api = client
            watchAuth(client)
            if let current = try? await client.supabase.auth.session, !current.isExpired {
                client.cache(session: current)
                accept(user: current.user.id)
            } else {
                phase = .signIn
            }
        } catch is CancellationError {
        } catch {
            self.error = "Não foi possível conectar à Órbita. Confira sua conexão e tente novamente."
            phase = .failed
        }
    }

    func signIn(email: String, password: String) async {
        guard let api, !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let session = try await api.supabase.auth.signIn(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            api.cache(session: session)
            accept(user: session.user.id)
        } catch {
            self.error = "Não foi possível entrar. Verifique e-mail, senha e conexão."
        }
    }

    func signOut() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if isDemo {
            await reset()
            isDemo = false
            phase = .signIn
            // Demo can start without a network connection; bootstrap when leaving it.
            if api == nil { await launch() }
            else if let api { watchAuth(api) }
            return
        }
        do {
            // Sem isto o iPhone continuaria recebendo as notificações da conta que saiu.
            if let token = nativePushToken, let api { try? await api.unregisterIOSPushToken(token) }
            try await api?.supabase.auth.signOut(scope: .local)
            await reset()
            phase = .signIn
        } catch {
            self.error = "Não foi possível encerrar a sessão. Tente novamente."
        }
    }

    /// Sessão para as telas do site abertas no app. O app é o único que renova o
    /// token (o site roda sem renovação automática), então entrega um token com
    /// pelo menos 5 minutos de validade, renovando antes se precisar.
    func webTokens(forceRefresh: Bool = false) async throws -> WebSessionTokens {
        guard let api, !isDemo else { throw AppFailure.message("Entre na sua conta para abrir esta tela.") }
        var session = try await api.currentSession()
        if forceRefresh || session.expiresAt - Date().timeIntervalSince1970 < 300 {
            session = try await api.supabase.auth.refreshSession()
            api.cache(session: session)
        }
        return WebSessionTokens(accessToken: session.accessToken, refreshToken: session.refreshToken)
    }

    func startDemo() {
        authTask?.cancel()
        authTask = nil
        isDemo = true
        media.clear()
        media.api = nil
        drafts.removeAll()
        userId = Demo.me.id
        directory.useDemo()
        feed.useDemo()
        phase = .signedIn
        error = nil
    }

    private func accept(user: UUID) {
        guard !isDemo else { return }
        if let previous = userId, previous != user {
            // Do not let another user's data flash between sessions.
            directory = DirectoryStore()
            feed = FeedStore()
            media.clear()
            drafts.removeAll()
            Task { await calls.leave() }
        }
        userId = user
        phase = .signedIn
        requestPushAuthorization()
        Task { await syncNativePushToken() }
    }

    private func requestPushAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    private func syncNativePushToken() async {
        guard let token = nativePushToken, let api, userId != nil, !isDemo else { return }
        try? await api.registerIOSPushToken(token)
    }

    private func watchAuth(_ client: APIClient) {
        authTask?.cancel()
        authTask = Task { [weak self] in
            for await (_, session) in client.supabase.auth.authStateChanges {
                guard !Task.isCancelled, let self, !self.isDemo else { return }
                if let session, !session.isExpired {
                    client.cache(session: session)
                    self.accept(user: session.user.id)
                }
                else if self.userId != nil {
                    await self.reset()
                    self.phase = .signIn
                }
            }
        }
    }

    private func reset() async {
        revision = UUID()
        userId = nil
        drafts.removeAll()
        directory = DirectoryStore()
        feed = FeedStore()
        media.clear()
        media.api = api
        await calls.leave()
    }
}

@MainActor @Observable
final class DirectoryStore {
    private(set) var communities: [Community] = []
    private(set) var channels: [Channel] = []
    private(set) var conversations: [Conversation] = []
    private(set) var friendships: [Friendship] = []
    private(set) var incomingFriendRequests: [Friendship] = []
    /// ADM global da Órbita (site_roles creator/admin), como no site.
    private(set) var isSiteAdmin = false
    private(set) var profiles: [UUID: Profile] = [:]
    var selectedCommunityId: UUID?
    var loading = false
    var error: String?
    var loaded = false
    var me: Profile?
    private var generation = UUID()

    var selected: Community? { communities.first { $0.id == selectedCommunityId } }
    var visibleChannels: [Channel] {
        channels.filter { $0.communityId == selectedCommunityId }.sorted { $0.position < $1.position }
    }

    func useDemo() {
        communities = Demo.communities
        channels = Demo.channels
        profiles = Dictionary(uniqueKeysWithValues: Demo.people.map { ($0.id, $0) })
        me = Demo.me
        conversations = Demo.conversations
        incomingFriendRequests = []
        selectedCommunityId = communities.first?.id
        loaded = true
    }

    func load(api: APIClient, user: UUID, force: Bool = false) async {
        guard !loading, force || !loaded else { return }
        loading = true
        error = nil
        let stamp = generation
        defer { if generation == stamp { loading = false } }
        do {
            async let communityRows: [Community] = api.read("communities", query: [
                .init(name: "select", value: "id,name,description,is_default"),
                .init(name: "order", value: "is_default.desc,name.asc")])
            async let channelRows: [Channel] = api.read("channels", query: [
                .init(name: "select", value: "id,community_id,name,kind,description,position"),
                .init(name: "order", value: "position.asc")])
            async let conversationRows: [Conversation] = api.read("conversations", query: [
                .init(name: "select", value: "id,user_a,user_b,created_at"),
                .init(name: "order", value: "created_at.desc")])
            async let friendRows: [Friendship] = api.read("friendships", query: [
                .init(name: "select", value: "id,requester_id,recipient_id,status"),
                .init(name: "order", value: "status.asc")])
            let (groups, rooms, direct, friends) = try await (communityRows, channelRows, conversationRows, friendRows)
            try Task.checkCancellation()
            guard generation == stamp else { return }
            let ids = Set(direct.map { $0.peerId(for: user) } + friends.map { $0.peerId(for: user) } + [user])
            try await ensureProfiles(ids, api: api)
            guard generation == stamp else { return }
            communities = groups
            channels = rooms
            conversations = direct
            friendships = friends.filter { $0.status == "accepted" }
            incomingFriendRequests = friends.filter { $0.status == "pending" && $0.recipientId == user }
            me = profiles[user]
            struct SiteRole: Decodable { let role: String }
            // Falha aqui não impede o resto do app: só esconde as telas de ADM.
            let roles: [SiteRole] = (try? await api.read("site_roles", query: [
                .init(name: "select", value: "role"), .eq("user_id", user)])) ?? []
            guard generation == stamp else { return }
            isSiteAdmin = roles.contains { ["creator", "admin"].contains($0.role) }
            if !groups.contains(where: { $0.id == selectedCommunityId }) { selectedCommunityId = groups.first?.id }
            loaded = true
        } catch is CancellationError {
        } catch {
            guard generation == stamp else { return }
            self.error = error.localizedDescription
        }
    }

    func ensureProfiles(_ ids: Set<UUID>, api: APIClient) async throws {
        let missing = ids.filter { profiles[$0] == nil }
        guard !missing.isEmpty else { return }
        // Batch profiles; never issue a request per message or per avatar.
        let array = Array(missing)
        for offset in stride(from: 0, to: array.count, by: 60) {
            let batch = array[offset..<min(offset + 60, array.count)]
            let values = batch.map { $0.uuidString.lowercased() }.joined(separator: ",")
            let rows: [Profile] = try await api.read("profiles", query: [
                .init(name: "select", value: "id,display_name,username,bio,avatar_color,avatar_url,banner_url,pronouns,presence_status,custom_status,presence_activity"),
                .init(name: "id", value: "in.(\(values))")])
            try Task.checkCancellation()
            for row in rows { profiles[row.id] = row }
        }
    }

    func searchProfiles(_ text: String, api: APIClient) async throws -> [Profile] {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return [] }
        let escaped = query.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: ",", with: "")
            let rows: [Profile] = try await api.read("profiles", query: [
                .init(name: "select", value: "id,display_name,username,bio,avatar_color,avatar_url,banner_url,pronouns,presence_status,custom_status,presence_activity"),
            .init(name: "or", value: "display_name.ilike.*\(escaped)*,username.ilike.*\(escaped)*"),
            .init(name: "limit", value: "20")
        ])
        return rows.filter { $0.id != me?.id }
    }

    func sendFriendRequest(to peer: UUID, from user: UUID, api: APIClient) async throws {
        struct Payload: Encodable { let requesterId: UUID; let recipientId: UUID; let status: String }
        _ = try await api.write("friendships", body: Payload(requesterId: user, recipientId: peer, status: "pending")) as [Friendship]
    }

    func respond(to request: Friendship, accept: Bool, user: UUID, api: APIClient) async throws {
        guard request.recipientId == user else { throw AppFailure.message("Este pedido não pertence a você.") }
        if accept {
            struct Payload: Encodable { let status: String }
            _ = try await api.write("friendships", body: Payload(status: "accepted"), method: "PATCH",
                                    query: [.eq("id", request.id)]) as [Friendship]
        } else {
            try await api.delete("friendships", query: [.eq("id", request.id)])
        }
        incomingFriendRequests.removeAll { $0.id == request.id }
        if accept, !friendships.contains(where: { $0.id == request.id }) {
            var accepted = request
            accepted.status = "accepted"
            friendships.append(accepted)
        }
    }

    func openConversation(peer: UUID, user: UUID, api: APIClient) async throws -> Conversation {
        if let existing = conversations.first(where: { $0.peerId(for: user) == peer }) { return existing }
        let pair = MessageRules.canonicalPair(user, peer)
        struct Payload: Encodable { let userA: UUID; let userB: UUID }
        do {
            let rows: [Conversation] = try await api.write("conversations", body: Payload(userA: pair.0, userB: pair.1))
            guard let row = rows.first else { throw AppFailure.message("Não foi possível abrir a conversa.") }
            conversations.insert(row, at: 0)
            return row
        } catch {
            // Another client may have created the unique pair at the same time.
            let existing: [Conversation] = try await api.read("conversations", query: [
                .eq("user_a", pair.0), .eq("user_b", pair.1)])
            guard let row = existing.first else { throw error }
            if !conversations.contains(where: { $0.id == row.id }) { conversations.insert(row, at: 0) }
            return row
        }
    }

    func saveProfile(name: String, bio: String, pronouns: String, customStatus: String,
                     api: APIClient, user: UUID) async throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let bio = bio.trimmingCharacters(in: .whitespacesAndNewlines)
        let pronouns = pronouns.trimmingCharacters(in: .whitespacesAndNewlines)
        let customStatus = customStatus.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (3...24).contains(name.unicodeScalars.count), bio.unicodeScalars.count <= 320,
              pronouns.unicodeScalars.count <= 40, customStatus.unicodeScalars.count <= 80 else {
            throw AppFailure.message("Use um nome de 3–24 caracteres, bio de até 320, pronomes de até 40 e status de até 80.")
        }
        struct Payload: Encodable { let displayName: String; let bio: String; let pronouns: String; let customStatus: String }
        let rows: [Profile] = try await api.write("profiles", body: Payload(displayName: name, bio: bio,
                                                                            pronouns: pronouns, customStatus: customStatus),
                                                 method: "PATCH", query: [.eq("id", user)])
        guard let row = rows.first else { throw AppFailure.message("O perfil não foi atualizado.") }
        profiles[user] = row
        me = row
    }
}

/// Tokens entregues às telas web. Não são guardados em lugar nenhum pelo app.
struct WebSessionTokens: Equatable {
    let accessToken: String
    let refreshToken: String
}
