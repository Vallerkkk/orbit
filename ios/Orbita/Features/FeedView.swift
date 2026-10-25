import SwiftUI
import PhotosUI
import UIKit

struct FeedView: View {
    @Environment(AppSession.self) private var app
    @State private var composing = false
    @State private var detail: FeedPost?
    private var store: FeedStore { app.feed }
    var body: some View {
        @Bindable var store = app.feed
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    SectionEyebrow(text: "Ideias em movimento")
                    Text("O que está na sua órbita?").font(.title2.bold())
                }
                Picker("Publicações", selection: $store.scope) {
                    Text("Descobrir").tag("explore")
                    Text("Seguindo").tag("following")
                    Text("Salvos").tag("saved")
                }.pickerStyle(.segmented)
                Button { composing = true } label: {
                    HStack(spacing: 14) {
                        Avatar(profile: app.directory.me)
                        Text("Compartilhe algo…").foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: "square.and.pencil").foregroundStyle(Orbit.pink)
                    }.padding(16).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 22))
                }.buttonStyle(.plain).disabled(app.isDemo)
                if let error = store.error {
                    ErrorNotice(text: error) { Task { await refresh() } }
                }
                if store.loading && store.posts.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(28) }
                ForEach(store.posts) { post in
                    PostCard(post: post, full: false, open: { detail = post }) { kind in
                        guard !app.isDemo, let api = app.api, let user = app.userId else { return }
                        Task { await store.toggle(post, kind: kind, user: user, api: api) }
                    }
                    .task {
                        if post.id == store.posts.last?.id, let api = app.api, !app.isDemo {
                            await store.load(api: api, reset: false)
                        }
                    }
                }
                if store.loadingMore { ProgressView().frame(maxWidth: .infinity).padding(16) }
                if store.posts.isEmpty && !store.loading {
                    EmptyCard(icon: "sparkles", title: "Um universo de ideias",
                              detail: store.scope == "saved" ? "Suas publicações salvas aparecerão aqui."
                              : "Quando houver publicações, elas aparecerão aqui.")
                }
            }.padding(20)
        }
        .background(Orbit.background)
        .navigationTitle("Feed")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { composing = true } label: { Image(systemName: "plus").frame(minWidth: 44, minHeight: 44) }
                    .accessibilityLabel("Nova publicação").disabled(app.isDemo)
            }
        }
        .task(id: store.scope) { await refresh() }
        .refreshable { await refresh() }
        .sheet(isPresented: $composing) { NewPostView() }
        .sheet(item: $detail) { PostDetail(post: $0) }
    }
    private func refresh() async {
        guard !app.isDemo, let api = app.api else { return }
        await store.load(api: api)
    }
}

private struct PostCard: View {
    let post: FeedPost
    let full: Bool
    let open: () -> Void
    let mutate: (String) -> Void
    @Environment(AppSession.self) private var app
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Avatar(profile: post.author)
                VStack(alignment: .leading, spacing: 4) {
                    Text(post.author?.displayName ?? "Participante").font(.subheadline.bold())
                    Text(post.author?.username.map { "@\($0)" } ?? "Órbita")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Text(post.date, format: .dateTime.day().month(.abbreviated))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Text(full ? post.content : String(post.content.prefix(650)))
                .font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
            if !full && post.content.count > 650 {
                Button("Ler mais", action: open).font(.subheadline.bold()).frame(minHeight: 44)
            }
            if let quote = post.quote {
                VStack(alignment: .leading, spacing: 8) {
                    Label(quote.author, systemImage: "quote.opening").font(.caption.bold())
                    Text(quote.content).font(.subheadline).foregroundStyle(.secondary).lineLimit(full ? nil : 5)
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 16))
            }
            ForEach(Array((post.media ?? []).prefix(4).enumerated()), id: \.offset) { _, path in
                PrivateImage(path: path, label: "Imagem da publicação", bucket: "orbita-feed")
            }
            Divider()
            HStack(spacing: 8) {
                Button { mutate("like") } label: {
                    Label("\(post.likes)", systemImage: post.liked ? "heart.fill" : "heart")
                        .font(.subheadline).frame(minWidth: 44, minHeight: 44)
                }
                .foregroundStyle(post.liked ? Orbit.pink : .secondary)
                .accessibilityLabel("\(post.liked ? "Descurtir" : "Curtir"), \(post.likes) curtidas")
                .disabled(app.isDemo || app.feed.mutating.contains(post.id))
                if full {
                    Label("\(post.replies)", systemImage: "bubble").font(.subheadline)
                        .foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 44)
                } else {
                    Button(action: open) {
                        Label("\(post.replies)", systemImage: "bubble").font(.subheadline)
                            .frame(minWidth: 44, minHeight: 44)
                    }.foregroundStyle(.secondary).accessibilityLabel("Ver publicação e \(post.replies) respostas")
                }
                Spacer()
                ShareLink(item: post.content) { Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44) }
                    .foregroundStyle(.secondary).accessibilityLabel("Compartilhar texto")
                Button { mutate("save") } label: {
                    Image(systemName: post.saved ? "bookmark.fill" : "bookmark").frame(width: 44, height: 44)
                }
                .foregroundStyle(post.saved ? Orbit.lilac : .secondary)
                .accessibilityLabel(post.saved ? "Remover dos salvos" : "Salvar publicação")
                .disabled(app.isDemo || app.feed.mutating.contains(post.id))
            }
        }
        .padding(20).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 24))
    }
}

private struct NewPostView: View {
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var postId = UUID()
    @State private var mediaItems: [PhotosPickerItem] = []
    @State private var selectedMedia: [Data] = []
    @State private var error: String?
    @State private var discard = false
    @FocusState private var focused: Bool
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Avatar(profile: app.directory.me)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(app.directory.me?.displayName ?? "Você").font(.headline)
                            Text("Publicação no feed").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    TextField("Uma ideia, uma descoberta, um novo começo…", text: $text, axis: .vertical)
                        .font(.title3).lineLimit(8...20).focused($focused)
                        .disabled(app.feed.writing)
                        .accessibilityLabel("Texto da publicação")
                    PhotosPicker(selection: $mediaItems, maxSelectionCount: 4, matching: .images) {
                        Label("Adicionar até 4 imagens", systemImage: "photo.on.rectangle.angled")
                    }
                    .onChange(of: mediaItems) { _, items in
                        Task { selectedMedia = await loadMedia(items) }
                    }
                    if !selectedMedia.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(Array(selectedMedia.enumerated()), id: \.offset) { _, data in
                                    if let image = UIImage(data: data) {
                                        Image(uiImage: image).resizable().scaledToFill()
                                            .frame(width: 88, height: 88)
                                            .clipShape(RoundedRectangle(cornerRadius: 14))
                                    }
                                }
                            }
                        }
                    }
                    Text("\(text.unicodeScalars.count)/280")
                        .font(.caption).foregroundStyle(text.unicodeScalars.count > 280 ? Orbit.danger : .secondary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    if let error { ErrorNotice(text: error) }
                }.padding(24)
            }.background(Orbit.background)
            .navigationTitle("Nova publicação").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { if text.isEmpty { dismiss() } else { discard = true } }.disabled(app.feed.writing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard let api = app.api, let user = app.userId else { return }
                        Task {
                            do {
                                let paths = try await uploadMedia(selectedMedia, user: user, api: api)
                                try await app.feed.publish(text, user: user, api: api, id: postId, media: paths)
                                dismiss()
                            } catch { self.error = error.localizedDescription + " Seu rascunho foi mantido." }
                        }
                    } label: {
                        if app.feed.writing { ProgressView() } else { Text("Publicar").bold() }
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count > 280
                              || (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && selectedMedia.isEmpty)
                              || app.feed.writing)
                }
            }
            .confirmationDialog("Descartar o rascunho?", isPresented: $discard, titleVisibility: .visible) {
                Button("Descartar", role: .destructive) { dismiss() }
                Button("Continuar escrevendo", role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(!text.isEmpty)
        .task { focused = true }
    }

    private func loadMedia(_ items: [PhotosPickerItem]) async -> [Data] {
        var result: [Data] = []
        for item in items.prefix(4) {
            guard let data = try? await item.loadTransferable(type: Data.self), data.count <= 2_000_000,
                  let image = UIImage(data: data), let compressed = image.jpegData(compressionQuality: 0.82) else { continue }
            result.append(compressed)
        }
        return result
    }

    private func uploadMedia(_ items: [Data], user: UUID, api: APIClient) async throws -> [String] {
        var paths: [String] = []
        for data in items.prefix(4) {
            let path = "\(user.uuidString.lowercased())/\(UUID().uuidString.lowercased()).jpg"
            try await api.upload(data: data, path: path, mimeType: "image/jpeg", bucket: "orbita-feed")
            paths.append(path)
        }
        return paths
    }
}

private struct PostDetail: View {
    let post: FeedPost
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var replies: [FeedPost] = []
    @State private var loading = false
    @State private var hasMore = false
    @State private var error: String?
    @State private var replyText = ""
    @State private var replying = false
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    PostCard(post: currentPost, full: true, open: {}) { kind in
                        guard !app.isDemo, let api = app.api, let user = app.userId else { return }
                        Task { await app.feed.toggle(currentPost, kind: kind, user: user, api: api) }
                    }
                    SectionEyebrow(text: "Respostas")
                    HStack(alignment: .bottom, spacing: 10) {
                        TextField("Escreva uma resposta…", text: $replyText, axis: .vertical)
                            .lineLimit(1...4).padding(12).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 14))
                        Button {
                            guard let api = app.api, let user = app.userId, MessageRules.canSend(replyText), !replying else { return }
                            let text = replyText
                            replying = true
                            Task {
                                defer { replying = false }
                                do {
                                    try await app.feed.publish(text, user: user, api: api, id: UUID(), replyTo: post.id)
                                    replyText = ""
                                    await load(reset: true)
                                } catch { self.error = error.localizedDescription }
                            }
                        } label: {
                            Image(systemName: replying ? "arrow.triangle.2.circlepath" : "arrow.up")
                                .frame(width: 44, height: 44).foregroundStyle(Orbit.ink).background(Orbit.gradient, in: Circle())
                        }.disabled(!MessageRules.canSend(replyText) || replying || app.isDemo)
                    }
                    if let error { ErrorNotice(text: error) { Task { await load(reset: replies.isEmpty) } } }
                    ForEach(replies) { reply in
                        HStack(alignment: .top, spacing: 12) {
                            Avatar(profile: reply.author, size: 36)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(reply.author?.displayName ?? "Participante").font(.caption.bold())
                                Text(reply.content).textSelection(.enabled)
                            }
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 18))
                    }
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    if hasMore { Button("Mais respostas") { Task { await load(reset: false) } }.frame(minHeight: 44).disabled(loading) }
                    if replies.isEmpty && !loading {
                        Text("Nenhuma resposta disponível.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Link("Continuar no site da Órbita", destination: APIClient.origin)
                        .font(.footnote).frame(minHeight: 44)
                }.padding(20)
            }
            .background(Orbit.background)
            .navigationTitle("Publicação").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluir") { dismiss() } } }
            .task { await load(reset: true) }
        }
    }
    private var currentPost: FeedPost { app.feed.posts.first { $0.id == post.id } ?? post }
    private func load(reset: Bool) async {
        guard !app.isDemo, !loading, let api = app.api else { return }
        loading = true
        defer { loading = false }
        struct Query: Encodable {
            let scope = "thread"
            let parentFilter: UUID
            let beforeAt: String?
            let beforeId: UUID?
        }
        do {
            let cursor = reset ? nil : replies.last
            let rows: [FeedPost] = try await api.rpc("social_timeline", body: Query(
                parentFilter: post.id, beforeAt: cursor?.createdAt, beforeId: cursor?.id))
            try Task.checkCancellation()
            if reset { replies = rows }
            else { let ids = Set(replies.map(\.id)); replies += rows.filter { !ids.contains($0.id) } }
            hasMore = rows.count == 25
            error = nil
        } catch is CancellationError {
        } catch { self.error = error.localizedDescription }
    }
}
