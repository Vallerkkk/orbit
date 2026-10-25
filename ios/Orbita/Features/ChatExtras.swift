import SwiftUI

/// Resultado de /api/media/search (ou /trending), igual ao do site.
struct MediaItem: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let url: URL?
    let preview: URL?
}

struct MediaSearchReply: Decodable {
    let available: Bool
    let results: [MediaItem]
}

/// Seletor de GIFs e figurinhas (GIPHY via servidor; a chave nunca chega ao app).
struct MediaPicker: View {
    let api: APIClient
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = 0 // 0 = GIFs, 1 = figurinhas
    @State private var query = ""
    @State private var results: [MediaItem] = []
    @State private var message: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Tipo", selection: $kind) {
                    Text("GIFs").tag(0)
                    Text("Figurinhas").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)

                TextField("Buscar no GIPHY", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 16)
                    .accessibilityLabel("Buscar GIFs ou figurinhas")

                ScrollView {
                    if let message {
                        Text(message).font(.footnote).foregroundStyle(.secondary).padding(24)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
                        ForEach(results.filter { $0.url != nil }) { item in
                            Button {
                                guard let url = item.url else { return }
                                onPick(ChatMedia.token(isGif: kind == 0, title: item.title, url: url))
                                dismiss()
                            } label: {
                                AsyncImage(url: item.preview ?? item.url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Orbit.raised
                                }
                                .frame(height: 120)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel((kind == 0 ? "Enviar GIF " : "Enviar figurinha ") + item.title)
                        }
                    }
                    .padding(.horizontal, 16)
                    Text("Busca via GIPHY").font(.caption2).foregroundStyle(.secondary).padding(.vertical, 12)
                }
            }
            .padding(.top, 12)
            .navigationTitle("GIFs e figurinhas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fechar") { dismiss() } }
            }
            .task(id: "\(kind)|\(query)") {
                // Espera a digitação parar; cada mudança cancela a busca anterior.
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                await load()
            }
        }
        .presentationDragIndicator(.visible)
    }

    private func load() async {
        message = nil
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let reply = try await api.mediaSearch(kind: kind == 0 ? "gifs" : "stickers", query: needle)
            guard !Task.isCancelled else { return }
            results = reply.results
            if !reply.available { message = "A busca de GIFs não está disponível agora." }
            else if results.isEmpty { message = "Nada encontrado." }
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            message = "Não foi possível buscar agora."
        }
    }
}

/// Bolha de GIF ou figurinha dentro de uma mensagem.
struct MediaBubble: View {
    let media: ChatMedia.Parsed
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            AsyncImage(url: media.url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Label("Não carregou", systemImage: "photo").font(.caption).foregroundStyle(.secondary)
                default:
                    ProgressView().frame(height: 120)
                }
            }
            .frame(maxWidth: 240, maxHeight: 240, alignment: .leading)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityLabel((media.isGif ? "GIF" : "Figurinha") + (media.title.isEmpty ? "" : ": \(media.title)"))
            Text("via GIPHY").font(.caption2).foregroundStyle(.secondary)
        }
    }
}

/// Reações além das seis rápidas: uma grade com emojis comuns.
struct EmojiGrid: View {
    static let emojis = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "😮", "😢", "😡", "🙏", "👏", "💯",
                         "✅", "❌", "🤔", "😍", "🥳", "😎", "🤝", "🚀", "💜", "😅", "🙌", "🤯"]
    let pick: (String) -> Void
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 8)], spacing: 8) {
                    ForEach(Self.emojis, id: \.self) { emoji in
                        Button { pick(emoji) } label: {
                            Text(emoji).font(.title).frame(width: 52, height: 52)
                                .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Reagir com \(emoji)")
                    }
                }
                .padding(16)
            }
            .navigationTitle("Reagir").navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
    }
}

/// Busca nas mensagens carregadas na tela (o histórico antigo entra conforme você rola).
struct ChatSearchView: View {
    let messages: [Message]
    let authorName: (UUID) -> String
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private var results: [Message] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 2 else { return [] }
        return messages.reversed().filter { $0.content.localizedCaseInsensitiveContains(needle) }
    }

    var body: some View {
        NavigationStack {
            List {
                if results.isEmpty {
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2
                         ? "Digite pelo menos 2 letras."
                         : "Nada encontrado nas mensagens carregadas.")
                        .foregroundStyle(.secondary)
                }
                ForEach(results) { message in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(authorName(message.authorId)).font(.caption.bold()).foregroundStyle(.secondary)
                        Text(message.content).lineLimit(3)
                        Text(message.date, format: .dateTime.day().month().hour().minute())
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .searchable(text: $query, prompt: "Buscar nas mensagens")
            .navigationTitle("Buscar").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fechar") { dismiss() } }
            }
        }
    }
}
