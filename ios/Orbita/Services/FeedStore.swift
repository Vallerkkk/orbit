import Foundation
import Observation

@MainActor @Observable
final class FeedStore {
    var scope = "explore"
    private(set) var posts: [FeedPost] = []
    var loading = false
    var loadingMore = false
    var hasMore = false
    var error: String?
    var writing = false
    var mutating = Set<UUID>()
    private var generation = UUID()
    private var loadedScope = ""

    func useDemo() { posts = Demo.posts; hasMore = false }

    func load(api: APIClient, reset: Bool = true) async {
        if !reset && (loading || loadingMore || !hasMore) { return }
        let stamp: UUID
        if reset {
            generation = UUID()
            stamp = generation
            loading = true
            loadingMore = false
            if loadedScope != scope {
                posts = []
                hasMore = false
                loadedScope = scope
            }
        } else {
            stamp = generation
            loadingMore = true
        }
        error = nil
        let requestedScope = scope
        defer {
            if generation == stamp { loading = false; loadingMore = false }
        }
        do {
            let cursor = reset ? nil : posts.last
            let query = FeedQuery(scope: requestedScope, beforeAt: cursor?.createdAt, beforeId: cursor?.id)
            let rows: [FeedPost] = try await api.rpc("social_timeline", body: query)
            guard generation == stamp, !Task.isCancelled, scope == requestedScope else { return }
            if reset { posts = rows }
            else {
                let known = Set(posts.map(\.id))
                posts += rows.filter { !known.contains($0.id) }
            }
            hasMore = rows.count == 25
        } catch is CancellationError {
        } catch { if generation == stamp { self.error = error.localizedDescription } }
    }

    func toggle(_ post: FeedPost, kind: String, user: UUID, api: APIClient) async {
        guard !mutating.contains(post.id), ["like", "save"].contains(kind) else { return }
        let stamp = generation
        mutating.insert(post.id)
        defer { mutating.remove(post.id) }
        do {
            let table = kind == "like" ? "social_likes" : "social_bookmarks"
            let enabled = kind == "like" ? post.liked : post.saved
            if enabled {
                try await api.delete(table, query: [.eq("post_id", post.id), .eq("user_id", user)])
            } else {
                struct Body: Encodable { let postId: UUID; let userId: UUID }
                try await api.mutate(table, body: Body(postId: post.id, userId: user))
            }
            guard generation == stamp, let index = posts.firstIndex(where: { $0.id == post.id }) else { return }
            if kind == "like" {
                posts[index].liked.toggle()
                posts[index].likes = max(0, posts[index].likes + (enabled ? -1 : 1))
            } else { posts[index].saved.toggle() }
        } catch {
            if generation == stamp { self.error = "Não foi possível atualizar a publicação. Atualize o feed." }
        }
    }

    func publish(_ content: String, user: UUID, api: APIClient, id: UUID,
                 replyTo: UUID? = nil, media: [String] = []) async throws {
        let clean = content.trimmingCharacters(in: .whitespacesAndNewlines)
        // Media-only posts are supported by the web feed and by NewPostView.
        // Keep the text limit, but do not reject a post whose media array is
        // non-empty and whose caption is intentionally blank.
        guard !writing,
              ((1...280).contains(clean.unicodeScalars.count) || (!media.isEmpty && clean.isEmpty)) else {
            throw AppFailure.message("Escreva entre 1 e 280 caracteres.")
        }
        writing = true
        defer { writing = false }
        struct Body: Encodable { let id: UUID; let authorId: UUID; let content: String; let media: [String]; let replyTo: UUID? }
        // A stable client post UUID is explicitly granted by social_feed.sql.
        // Keep it across retries; unlike chat, a repeated post cannot be duplicated.
        do {
            try await api.mutate("social_posts", body: Body(id: id, authorId: user, content: clean, media: media, replyTo: replyTo))
        } catch {
            let existing: [ExistingPost] = (try? await api.read("social_posts", query: [.eq("id", id),
                .eq("author_id", user), .init(name: "select", value: "id,content")])) ?? []
            guard let accepted = existing.first else { throw error }
            guard accepted.content == clean else {
                throw AppFailure.message("A tentativa anterior já publicou outro texto. Seu rascunho atual foi mantido; confira o feed antes de criar outra publicação.")
            }
        }
        await load(api: api)
    }
}

private struct ExistingPost: Decodable { let id: UUID; let content: String }
