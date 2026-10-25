import Foundation
import Observation
import Supabase

@MainActor @Observable
final class ChatStore {
    private(set) var messages: [Message] = []
    var loading = false
    var loadingOlder = false
    var sending = false
    var realtimeReady = false
    var hasOlder = false
    var error: String?
    var reply: Message?
    private let pageSize = 50
    private var channel: RealtimeChannelV2?
    private var subscriptions: [RealtimeSubscription] = []
    private var changes = Set<UUID>()
    private var deleted = Set<UUID>()
    private var flushTask: Task<Void, Never>?
    private var revision = UUID()
    private var destination: ChatDestination?
    private var api: APIClient?
    @ObservationIgnored private weak var directory: DirectoryStore?
    private var active = false
    private var refreshing = false
    private var refreshAgain = false
    private var eventVersion: UInt64 = 0
    private var touched: [UUID: UInt64] = [:]

    private var selection: String {
        "id,author_id,content,created_at,edited_at,pinned,reply_to,attachment_id,poll,attachments(id,name,mime_type,size,storage_path,file_id),reactions(id,emoji,user_id),poll_votes(id,user_id,option_index)"
    }

    func useDemo() {
        messages = Demo.messages
        hasOlder = false
    }

    func start(destination: ChatDestination, api: APIClient, directory: DirectoryStore) async {
        stop()
        self.destination = destination
        self.api = api
        self.directory = directory
        active = true
        loading = messages.isEmpty
        error = nil
        let stamp = revision
        let live = api.supabase.channel("ios:\(destination.draftKey):\(UUID())")
        channel = live
        let filter = "\(destination.scopeKey)=eq.\(destination.id.uuidString.lowercased())"
        subscriptions.append(live.onPostgresChange(AnyAction.self, schema: "public",
                                                    table: destination.table, filter: filter) { [weak self] action in
            let data: Data?
            switch action {
            case .insert(let row): data = try? JSONEncoder().encode(row.record)
            case .update(let row): data = try? JSONEncoder().encode(row.record)
            default: return
            }
            guard let data, let key = try? JSONDecoder().decode(RecordID.self, from: data) else { return }
            Task { @MainActor in self?.enqueue(key.id, deleted: false, stamp: stamp) }
        })
        // DELETE payloads contain only the PK under RLS and cannot use the scope
        // filter. We only remove IDs already present in THIS screen's history.
        subscriptions.append(live.onPostgresChange(DeleteAction.self, schema: "public",
                                                    table: destination.table) { [weak self] row in
            guard let data = try? JSONEncoder().encode(row.oldRecord),
                  let key = try? JSONDecoder().decode(RecordID.self, from: data) else { return }
            Task { @MainActor in self?.enqueue(key.id, deleted: true, stamp: stamp) }
        })
        subscriptions.append(live.onStatusChange { [weak self] status in
            Task { @MainActor in
                guard let self, self.revision == stamp else { return }
                let wasReady = self.realtimeReady
                self.realtimeReady = status == .subscribed
                if self.realtimeReady && !wasReady && !self.loading {
                    await self.refresh()
                }
            }
        })
        // HTTP history and socket subscription start concurrently. A slow socket
        // must not delay the first useful paint.
        async let subscription: Void = live.subscribeWithError()
        await refresh()
        if revision == stamp { loading = false; scheduleFlush(stamp) }
        do { try await subscription }
        catch {
            guard revision == stamp else { return }
            realtimeReady = false
            self.error = "Tempo real indisponível. Você ainda pode atualizar o histórico manualmente."
        }
        guard revision == stamp, !Task.isCancelled else {
            await api.supabase.removeChannel(live)
            return
        }
        // Close the initial HTTP/socket handoff gap. onStatusChange also handles
        // later reconnects, while refresh() coalesces overlapping requests.
        await refresh()
    }

    func stop() {
        revision = UUID()
        active = false
        flushTask?.cancel()
        flushTask = nil
        subscriptions.forEach { $0.cancel() }
        subscriptions.removeAll()
        changes.removeAll()
        deleted.removeAll()
        realtimeReady = false
        loading = false
        loadingOlder = false
        refreshing = false
        refreshAgain = false
        touched.removeAll()
        if let channel, let api {
            self.channel = nil
            Task { await api.supabase.removeChannel(channel) }
        }
    }

    func refresh() async {
        guard let api, let target = destination, active else { return }
        if refreshing { refreshAgain = true; return }
        refreshing = true
        error = nil
        let stamp = revision
        let versionAtRequest = eventVersion
        defer {
            if revision == stamp {
                refreshing = false
                if refreshAgain {
                    refreshAgain = false
                    Task { await self.refresh() }
                }
            }
        }
        do {
            let rows: [Message] = try await api.read(target.table, query: baseQuery(target))
            try await directory?.ensureProfiles(Set(rows.map(\.authorId)), api: api)
            guard revision == stamp, !Task.isCancelled else { return }
            // Refresh the latest window without discarding the user's older page.
            // Re-read visible older IDs to reconcile edits/deletes missed offline.
            let overlaps = messages.isEmpty || rows.contains { row in messages.contains { $0.id == row.id } }
            // If more than a whole page arrived offline, don't silently stitch a
            // disconnected older window to the newest page and hide a middle gap.
            let old = messages.filter { prior in
                guard overlaps else { return false }
                guard let boundary = rows.last else { return false }
                return ServerTime.orderKey(prior.createdAt) < ServerTime.orderKey(boundary.createdAt)
            }
            var verifiedOld: [Message] = []
            for offset in stride(from: 0, to: old.count, by: 60) {
                let ids = old[offset..<min(offset + 60, old.count)].map { $0.id.uuidString }.joined(separator: ",")
                let batch: [Message] = try await api.read(target.table, query: [
                    .init(name: "select", value: selection), .eq(target.scopeKey, target.id),
                    .init(name: "id", value: "in.(\(ids))")])
                verifiedOld += batch
            }
            guard revision == stamp, !Task.isCancelled else { return }
            let protectedIds = Set(touched.filter { $0.value > versionAtRequest }.keys)
            let protectedRows = messages.filter { protectedIds.contains($0.id) }
            let snapshot = MessageRules.merged(verifiedOld, rows).filter { !protectedIds.contains($0.id) }
            messages = MessageRules.merged(snapshot, protectedRows).filter { !deleted.contains($0.id) }
            hasOlder = (rows.count == pageSize || (!old.isEmpty && hasOlder)) && messages.count < 500
            if !overlaps { error = "O histórico avançou enquanto você estava fora. Carregamos a página mais recente; use “Carregar mensagens anteriores” para continuar." }
        } catch is CancellationError {
        } catch {
            if revision == stamp { self.error = error.localizedDescription }
        }
    }

    func older() async {
        guard let api, let target = destination, let first = messages.first,
              hasOlder, !loadingOlder, active else { return }
        let stamp = revision
        loadingOlder = true
        defer { if revision == stamp { loadingOlder = false } }
        do {
            var query = baseQuery(target)
            query.append(.init(name: "or", value: PageCursor(timestamp: first.createdAt, id: first.id).filter))
            let rows: [Message] = try await api.read(target.table, query: query)
            try await directory?.ensureProfiles(Set(rows.map(\.authorId)), api: api)
            guard revision == stamp, !Task.isCancelled else { return }
            messages = MessageRules.merged(messages, rows).filter { !deleted.contains($0.id) }
            hasOlder = rows.count == pageSize && messages.count < 500
        } catch is CancellationError {
        } catch { if revision == stamp { self.error = error.localizedDescription } }
    }

    // No optimistic database IDs and no automatic retries of a non-idempotent INSERT.
    // The composer keeps the draft until the server returns its generated row.
    func send(_ text: String, author: UUID, attachment: UUID? = nil, poll: MessagePoll? = nil) async -> Bool {
        // The web client allows attachment-only and poll-only messages. Empty
        // content is still a valid Postgres value; only the fully empty send
        // must be rejected.
        guard let api, let target = destination, !sending,
              MessageRules.canSend(text) || attachment != nil || poll != nil else { return false }
        sending = true
        error = nil
        defer { sending = false }
        do {
            let payload = MessageInsert(destination: target, author: author,
                                        content: MessageRules.normalized(text), attachment: attachment,
                                        reply: reply?.id, poll: poll)
            let rows: [Message] = try await api.write(target.table, body: payload,
                                                     query: [.init(name: "select", value: selection)])
            guard !rows.isEmpty else { throw AppFailure.message("O envio não foi confirmado.") }
            guard destination?.draftKey == target.draftKey else { return false }
            for row in rows { markTouched(row.id) }
            messages = MessageRules.merged(messages, rows)
            reply = nil
            return true
        } catch {
            guard destination?.draftKey == target.draftKey else { return false }
            self.error = "O envio não foi confirmado. O rascunho foi mantido. Confira o histórico antes de reenviar para evitar duplicação."
            return false
        }
    }

    func delete(_ message: Message, author: UUID) async {
        guard message.authorId == author, let api, let target = destination else { return }
        let stamp = revision
        do {
            try await api.delete(target.table, query: [.eq("id", message.id), .eq("author_id", author)])
            guard stamp == revision else { return }
            messages.removeAll { $0.id == message.id }
            if reply?.id == message.id { reply = nil }
        } catch { if stamp == revision { self.error = error.localizedDescription } }
    }

    func edit(_ message: Message, content: String, author: UUID) async {
        guard message.authorId == author, let api, let target = destination,
              MessageRules.canSend(content) else { return }
        struct Payload: Encodable { let content: String }
        do {
            let rows: [Message] = try await api.write(target.table, body: Payload(content: MessageRules.normalized(content)),
                                                     method: "PATCH", query: [.eq("id", message.id), .eq("author_id", author),
                                                                               .init(name: "select", value: selection)])
            messages = MessageRules.merged(messages, rows)
        } catch { self.error = "Não foi possível editar a mensagem." }
    }

    func togglePin(_ message: Message, author: UUID) async {
        guard let api, let target = destination else { return }
        struct Payload: Encodable { let pinned: Bool }
        do {
            let rows: [Message] = try await api.write(target.table, body: Payload(pinned: !message.pinned),
                                                     method: "PATCH", query: [.eq("id", message.id),
                                                                               .init(name: "select", value: selection)])
            messages = MessageRules.merged(messages, rows)
        } catch { self.error = "Não foi possível atualizar a mensagem fixada." }
    }

    func react(_ message: Message, emoji: String, user: UUID) async {
        guard let api, let target = destination else { return }
        let existing = message.reactions?.first { $0.userId == user && $0.emoji == emoji }
        do {
            if let existing {
                try await api.delete("reactions", query: [.eq("id", existing.id)])
            } else {
                struct Payload: Encodable { let messageId: UUID?; let directMessageId: UUID?; let userId: UUID; let emoji: String }
                let payload = Payload(messageId: target.isDirect ? nil : message.id,
                                      directMessageId: target.isDirect ? message.id : nil,
                                      userId: user, emoji: emoji)
                try await api.mutate("reactions", body: payload)
            }
            await refresh()
        } catch { self.error = "Não foi possível atualizar a reação." }
    }

    private func baseQuery(_ target: ChatDestination) -> [URLQueryItem] {
        [.init(name: "select", value: selection), .eq(target.scopeKey, target.id),
         .init(name: "order", value: "created_at.desc,id.desc"),
         .init(name: "limit", value: String(pageSize))]
    }

    private func enqueue(_ id: UUID, deleted isDeleted: Bool, stamp: UUID) {
        guard stamp == revision, active else { return }
        if isDeleted {
            guard refreshing || messages.contains(where: { $0.id == id }) || changes.contains(id) else { return }
            deleted.insert(id)
            changes.remove(id)
            messages.removeAll { $0.id == id }
        } else if !deleted.contains(id) { changes.insert(id) }
        markTouched(id)
        scheduleFlush(stamp)
    }

    private func markTouched(_ id: UUID) {
        eventVersion &+= 1
        touched[id] = eventVersion
        if touched.count > 1500 && !refreshing {
            let visible = Set(messages.map(\.id)).union(changes)
            touched = touched.filter { visible.contains($0.key) }
        }
    }

    private func scheduleFlush(_ stamp: UUID) {
        guard flushTask == nil, !changes.isEmpty else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled, let self, self.revision == stamp else { return }
            // Initial history can race with incoming changes; flush after it settles.
            while self.loading {
                try? await Task.sleep(for: .milliseconds(100))
                guard !Task.isCancelled, self.revision == stamp else { return }
            }
            let ids = Array(self.changes.prefix(60))
            self.changes.subtract(ids)
            guard let api = self.api, let target = self.destination else { return }
            do {
                let rows: [Message] = try await api.read(target.table, query: [
                    .init(name: "select", value: self.selection), .eq(target.scopeKey, target.id),
                    .init(name: "id", value: "in.(\(ids.map(\.uuidString).joined(separator: ",")))")])
                try await self.directory?.ensureProfiles(Set(rows.map(\.authorId)), api: api)
                guard self.revision == stamp, !Task.isCancelled else { return }
                self.messages = MessageRules.merged(self.messages, rows).filter { !self.deleted.contains($0.id) }
            } catch {
                if self.revision == stamp {
                    self.error = "Algumas mensagens podem estar desatualizadas. Puxe para atualizar."
                }
            }
            if self.revision == stamp {
                self.flushTask = nil
                self.scheduleFlush(stamp)
            }
        }
    }
}

private struct RecordID: Decodable { let id: UUID }
