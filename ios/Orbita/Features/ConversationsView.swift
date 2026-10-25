import SwiftUI

struct ConversationsView: View {
    @Environment(AppSession.self) private var app
    @State private var search = ""
    @State private var friends = false
    @State private var path: [ChatDestination] = []
    private var directory: DirectoryStore { app.directory }
    private var rows: [Conversation] {
        directory.conversations.filter { conversation in
            guard let user = app.userId else { return false }
            let peer = directory.profiles[conversation.peerId(for: user)]
            return search.isEmpty || (peer?.displayName.localizedCaseInsensitiveContains(search) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    SectionEyebrow(text: "Uma boa conversa aproxima")
                    Text("Seu espaço, a dois.").font(.title2.bold())
                }
                SearchField(prompt: "Busque uma pessoa", text: $search)
                if let error = directory.error { ErrorNotice(text: error) }
                if rows.isEmpty && !directory.loading {
                    EmptyCard(icon: "bubble.left.and.bubble.right", title: "Diga um oi",
                              detail: "Abra uma conversa com alguém da sua lista de amigos.")
                    Button("Encontrar meus amigos") { friends = true }.buttonStyle(OrbitButtonStyle())
                }
                VStack(spacing: 0) {
                    ForEach(rows) { conversation in
                        if let user = app.userId {
                            let peer = directory.profiles[conversation.peerId(for: user)]
                            NavigationLink(value: destination(conversation, peer: peer)) {
                                HStack(spacing: 14) {
                                    Avatar(profile: peer, size: 52)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(peer?.displayName ?? "Participante").font(.headline).foregroundStyle(.primary)
                                        Text(peer?.username.map { "@\($0)" } ?? "Conversa privada")
                                            .font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                                }.padding(16).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            if conversation.id != rows.last?.id { Divider().padding(.leading, 82) }
                        }
                    }
                }.background(Orbit.surface, in: RoundedRectangle(cornerRadius: 24))
                Text("Conversa privada, com acesso controlado pelo servidor.")
                    .font(.footnote).foregroundStyle(.secondary)
                // This does not claim E2E encryption; the existing backend is RLS-based.
            }.padding(20)
        }
        .background(Orbit.background)
        .navigationTitle("Conversas")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { friends = true } label: { Image(systemName: "square.and.pencil").frame(minWidth: 44, minHeight: 44) }
                    .accessibilityLabel("Nova conversa")
            }
        }
        .navigationDestination(for: ChatDestination.self) { ChatView(destination: $0) }
        .sheet(isPresented: $friends) {
            FriendsSheet { conversation, peer in
                friends = false
                path = [destination(conversation, peer: peer)]
            }
        }
        .navigationDestination(isPresented: Binding(get: { !path.isEmpty }, set: { if !$0 { path = [] } })) {
            if let target = path.first { ChatView(destination: target) }
        }
        .refreshable {
            if !app.isDemo, let api = app.api, let user = app.userId {
                await directory.load(api: api, user: user, force: true)
            }
        }
    }

    private func destination(_ row: Conversation, peer: Profile?) -> ChatDestination {
        .init(id: row.id, title: peer?.displayName ?? "Conversa",
              subtitle: peer?.username.map { "@\($0)" } ?? "Conversa privada", isDirect: true, isVoice: false)
    }
}

private struct FriendsSheet: View {
    let open: (Conversation, Profile?) -> Void
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    @State private var search = ""
    @State private var results: [Profile] = []
    @State private var searching = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    SearchField(prompt: "Buscar por nome ou @usuário", text: $search)
                        .onChange(of: search) { _, value in
                            guard let api = app.api, !app.isDemo else { return }
                            searching = true
                            Task {
                                defer { searching = false }
                                do { results = try await app.directory.searchProfiles(value, api: api) }
                            catch { self.error = "Não foi possível buscar pessoas agora." }
                            }
                        }
                    if let error { ErrorNotice(text: error) }
                    if !app.directory.incomingFriendRequests.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionEyebrow(text: "Pedidos recebidos")
                            ForEach(app.directory.incomingFriendRequests) { request in
                                let peer = app.directory.profiles[request.requesterId]
                                HStack(spacing: 12) {
                                    Avatar(profile: peer)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(peer?.displayName ?? "Alguém da Órbita").font(.subheadline.bold())
                                        Text("quer adicionar você").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button { respond(request, accept: true) } label: {
                                        Image(systemName: "checkmark").frame(width: 38, height: 38)
                                    }.buttonStyle(.borderedProminent).tint(Orbit.pink)
                                    Button { respond(request, accept: false) } label: {
                                        Image(systemName: "xmark").frame(width: 38, height: 38)
                                    }.buttonStyle(.bordered)
                                }.padding(12).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }
                    if searching { ProgressView().frame(maxWidth: .infinity) }
                    if !results.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionEyebrow(text: "Pessoas")
                            ForEach(results) { peer in
                                HStack(spacing: 12) {
                                    Avatar(profile: peer)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(peer.displayName).font(.subheadline.bold())
                                        Text(peer.username.map { "@\($0)" } ?? "Perfil").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button { send(peer) } label: {
                                        Image(systemName: "person.badge.plus").frame(width: 42, height: 42)
                                    }.buttonStyle(.bordered)
                                }.padding(12).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }
                    if app.directory.friendships.isEmpty {
                        EmptyCard(icon: "person.2", title: "Amizades que viram conversas",
                                  detail: "Busque alguém acima para enviar um pedido de amizade.")
                    }
                    if let user = app.userId {
                        ForEach(app.directory.friendships) { friend in
                            let peerId = friend.peerId(for: user)
                            let peer = app.directory.profiles[peerId]
                            Button {
                                guard !busy, let api = app.api else { return }
                                busy = true
                                Task {
                                    defer { busy = false }
                                    do {
                                        let row = try await app.directory.openConversation(peer: peerId, user: user, api: api)
                                        open(row, peer)
                                    } catch { self.error = error.localizedDescription }
                                }
                            } label: {
                                HStack(spacing: 14) {
                                    Avatar(profile: peer)
                                    Text(peer?.displayName ?? "Participante").foregroundStyle(.primary).font(.headline)
                                    Spacer()
                                    Image(systemName: "bubble.left").foregroundStyle(Orbit.pink)
                                }.padding(16).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 18))
                            }.disabled(busy || app.isDemo)
                        }
                    }
                    if busy { ProgressView() }
                }.padding(20)
            }
            .background(Orbit.background)
            .navigationTitle("Nova conversa").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fechar") { dismiss() } } }
        }
        .presentationDragIndicator(.visible)
    }

    private func send(_ peer: Profile) {
        guard let api = app.api, let user = app.userId, !app.isDemo, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.directory.sendFriendRequest(to: peer.id, from: user, api: api)
                results.removeAll { $0.id == peer.id }
            } catch { self.error = "Não foi possível enviar o pedido. Talvez vocês já sejam amigos." }
        }
    }

    private func respond(_ request: Friendship, accept: Bool) {
        guard let api = app.api, let user = app.userId, !app.isDemo, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await app.directory.respond(to: request, accept: accept, user: user, api: api) }
            catch { self.error = "Não foi possível atualizar o pedido." }
        }
    }
}
