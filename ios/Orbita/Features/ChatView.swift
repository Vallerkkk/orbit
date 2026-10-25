import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

struct ChatView: View {
    let destination: ChatDestination
    @Environment(AppSession.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var store = ChatStore()
    @State private var draft = ""
    @State private var initialized = false
    @State private var atBottom = true
    @State private var newMessages = 0
    @State private var scrollRequest = UUID()
    @State private var deletion: Message?
    @State private var editingMessage: Message?
    @State private var attachment: Attachment?
    @State private var lobby = false
    @State private var pendingCall = false
    @State private var photoItem: PhotosPickerItem?
    @State private var pendingAttachment: (name: String, type: String, data: Data)?
    @State private var uploading = false
    @State private var showingPoll = false
    @State private var poll: MessagePoll?
    @FocusState private var composing: Bool

    var body: some View {
        GeometryReader { viewport in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        conversationIntro
                        if let error = store.error {
                            ErrorNotice(text: error) { Task { await store.refresh() } }.padding(.horizontal, 20)
                        }
                        if store.loading { ProgressView("Carregando mensagens…").frame(maxWidth: .infinity).padding() }
                        if store.hasOlder {
                            Button {
                                let first = store.messages.first?.id
                                Task {
                                    await store.older()
                                    if let first { proxy.scrollTo(first, anchor: .top) }
                                }
                            } label: {
                                if store.loadingOlder { ProgressView() } else { Text("Carregar mensagens anteriores") }
                            }
                            .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 44)
                            .disabled(store.loadingOlder)
                        }
                        ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                            if index == 0 || !Calendar.current.isDate(message.date, inSameDayAs: store.messages[index - 1].date) {
                                Text(message.date.formatted(.dateTime.day().month(.wide)))
                                    .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                            }
                            MessageRow(message: message, profile: app.directory.profiles[message.authorId],
                                       own: message.authorId == app.userId,
                                       repliedMessage: message.replyTo.flatMap { id in store.messages.first { $0.id == id } },
                                       attachmentTapped: { attachment = $0 },
                                       reactionTapped: { emoji in
                                           guard let user = app.userId, !app.isDemo else { return }
                                           Task { await store.react(message, emoji: emoji, user: user) }
                                       })
                                .padding(.horizontal, 16).id(message.id)
                                .contextMenu {
                                    if !app.isDemo { Button("Responder", systemImage: "arrowshape.turn.up.left") {
                                        store.reply = message
                                        composing = true
                                    } }
                                    Button("Copiar texto", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.content }
                                    if message.authorId == app.userId && !app.isDemo {
                                        Button("Editar mensagem", systemImage: "pencil") { editingMessage = message }
                                        Button("Excluir mensagem", systemImage: "trash", role: .destructive) { deletion = message }
                                    }
                                    if !app.isDemo {
                                        Button(message.pinned ? "Desfixar mensagem" : "Fixar mensagem",
                                               systemImage: message.pinned ? "pin.slash" : "pin") {
                                            if let user = app.userId { Task { await store.togglePin(message, author: user) } }
                                        }
                                    }
                                }
                        }
                        if store.messages.isEmpty && !store.loading && store.error == nil {
                            EmptyCard(icon: "bubble.left", title: "A conversa começa com você",
                                      detail: "Um oi já é um ótimo começo.").padding(20)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                            .background(GeometryReader { geo in
                                Color.clear.preference(key: ChatBottomKey.self,
                                                       value: geo.frame(in: .named("chatScroll")).maxY)
                            })
                    }.padding(.bottom, 12)
                }
                .coordinateSpace(name: "chatScroll")
                .scrollDismissesKeyboard(.interactively)
                .onPreferenceChange(ChatBottomKey.self) { offset in
                    atBottom = offset <= viewport.size.height + 80
                    if atBottom { newMessages = 0 }
                }
                .onChange(of: store.messages.last?.id) { old, _ in
                    if old == nil || atBottom {
                        scrollToBottom(proxy, animated: old != nil)
                    } else { newMessages += 1 }
                }
                .onChange(of: scrollRequest) { _, _ in scrollToBottom(proxy, animated: true) }
                .onChange(of: composing) { _, focused in
                    if focused && atBottom {
                        Task { try? await Task.sleep(for: .milliseconds(300)); scrollToBottom(proxy, animated: true) }
                    }
                }
                .overlay(alignment: .bottom) {
                    if !atBottom && newMessages > 0 {
                        Button {
                            scrollToBottom(proxy, animated: true)
                            newMessages = 0
                        } label: {
                            Label("Novas mensagens", systemImage: "arrow.down")
                                .font(.footnote.bold()).padding(.horizontal, 18).padding(.vertical, 12)
                                .foregroundStyle(Orbit.ink).background(Orbit.gradient, in: Capsule())
                        }.padding(.bottom, 12)
                    }
                }
                .refreshable { await store.refresh() }
            }
        }
        .background(Orbit.background)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .navigationTitle(destination.isDirect ? destination.title : "#\(destination.title)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if destination.isDirect {
                    Button { lobby = true } label: {
                        Image(systemName: "phone").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Iniciar chamada")
                    .disabled(app.isDemo || app.api == nil)
                }
            }
        }
        .toolbar(.hidden, for: .tabBar)
        .task(id: scenePhase) {
            if !initialized {
                draft = app.drafts[destination.draftKey] ?? ""
                initialized = true
            }
            guard scenePhase == .active else { store.stop(); return }
            if app.isDemo { store.useDemo(); return }
            guard let api = app.api else { return }
            await store.start(destination: destination, api: api, directory: app.directory)
        }
        .onChange(of: draft) { _, text in app.drafts[destination.draftKey] = text }
        .onDisappear { store.stop() }
        .sheet(item: $attachment) { AttachmentPreview(attachment: $0) }
        .sheet(item: $editingMessage) { message in
            EditMessageView(message: message) { value in
                if let user = app.userId { Task { await store.edit(message, content: value, author: user) } }
                editingMessage = nil
            }
        }
        .sheet(isPresented: $showingPoll) {
            PollComposer { value in
                poll = value
                showingPoll = false
            }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await preparePhoto(item) }
        }
        .sheet(isPresented: $lobby, onDismiss: {
            if pendingCall, let api = app.api {
                pendingCall = false
                Task { await app.calls.join(destination, api: api) }
            }
        }) { VoiceLobby(target: destination) { pendingCall = true } }
        .confirmationDialog("Excluir esta mensagem?", isPresented: Binding(
            get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
                if let message = deletion {
                    Button("Excluir para todos", role: .destructive) {
                        if let user = app.userId { Task { await store.delete(message, author: user) } }
                        deletion = nil
                    }
                }
                Button("Cancelar", role: .cancel) { deletion = nil }
            }
    }

    private var conversationIntro: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: destination.isDirect ? "lock" : "number").foregroundStyle(Orbit.lilac)
                Text(destination.isDirect ? "Um espaço para vocês" : "O começo de boas conversas")
                    .font(.subheadline.bold())
            }
            if !destination.subtitle.isEmpty {
                Text(destination.subtitle).font(.footnote).foregroundStyle(.secondary)
            }
            if !app.isDemo {
                Label(store.realtimeReady ? "Tempo real conectado"
                      : store.loading ? "Sincronizando conversa" : "Tempo real desconectado · puxe para atualizar",
                      systemImage: store.realtimeReady ? "bolt.horizontal.circle" : "arrow.triangle.2.circlepath")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(20)
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let reply = store.reply {
                HStack(spacing: 10) {
                    Rectangle().fill(Orbit.pink).frame(width: 3)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Respondendo a \(app.directory.profiles[reply.authorId]?.displayName ?? "Participante")")
                            .font(.caption.bold()).foregroundStyle(Orbit.lilac)
                        Text(reply.content).font(.caption).lineLimit(1).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { store.reply = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .accessibilityLabel("Cancelar resposta")
                }.padding(.horizontal, 12).frame(height: 52)
            }
            if let pendingAttachment {
                HStack(spacing: 10) {
                    Image(systemName: pendingAttachment.type.hasPrefix("image/") ? "photo" : "doc")
                        .foregroundStyle(Orbit.lilac)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pendingAttachment.name).font(.caption.weight(.semibold)).lineLimit(1)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(pendingAttachment.data.count), countStyle: .file))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { self.pendingAttachment = nil } label: {
                        Image(systemName: "xmark.circle.fill").frame(width: 36, height: 36)
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Remover arquivo selecionado")
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 14))
            }
            HStack(alignment: .bottom, spacing: 10) {
                PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
                    Image(systemName: uploading ? "arrow.triangle.2.circlepath" : "plus")
                        .font(.headline).frame(width: 44, height: 44)
                        .background(Orbit.raised, in: Circle())
                }
                .disabled(app.isDemo || store.sending || uploading)
                .accessibilityLabel("Adicionar foto ou vídeo")
                Button { showingPoll = true } label: {
                    Image(systemName: "chart.bar.doc.horizontal")
                        .font(.subheadline).frame(width: 44, height: 44)
                        .background(poll == nil ? Orbit.raised : Orbit.lilac.opacity(0.3), in: Circle())
                }
                .disabled(app.isDemo || store.sending || uploading)
                .accessibilityLabel(poll == nil ? "Criar enquete" : "Editar enquete")
                if pendingAttachment != nil || poll != nil {
                    Button {
                        pendingAttachment = nil
                        poll = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .frame(width: 36, height: 44)
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Remover anexo e enquete")
                }
                TextField(app.isDemo ? "Entre para conversar" : "Mensagem", text: $draft, axis: .vertical)
                    .font(.body).lineLimit(1...5).padding(.horizontal, 16).padding(.vertical, 13)
                    .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 22))
                    .focused($composing).disabled(store.sending || app.isDemo)
                    .accessibilityLabel("Escrever mensagem")
                    .accessibilityIdentifier("message-composer")
                Button(action: send) {
                    Group {
                        if store.sending { ProgressView().tint(Orbit.ink) }
                        else { Image(systemName: "arrow.up").font(.headline.bold()) }
                    }
                    .frame(width: 48, height: 48)
                    .foregroundStyle(Orbit.ink).background(Orbit.gradient, in: Circle())
                    .opacity(canSend ? 1 : 0.4)
                }
                .disabled(!canSend).accessibilityLabel("Enviar mensagem")
            }
            if draft.unicodeScalars.count > 3800 {
                Text("\(draft.unicodeScalars.count)/4.000")
                    .font(.caption2).foregroundStyle(draft.unicodeScalars.count > 4000 ? Orbit.danger : .secondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
        .background(Orbit.surface)
    }

    private var canSend: Bool {
        !app.isDemo && !store.sending &&
        (MessageRules.canSend(draft) || pendingAttachment != nil || poll != nil)
    }
    private func send() {
        guard canSend, let user = app.userId else { return }
        let text = draft
        Task {
            var attachmentId: UUID?
            if let pending = pendingAttachment, let api = app.api {
                uploading = true
                defer { uploading = false }
                do {
                    let path = "\(user.uuidString.lowercased())/\(destination.storageScope)/\(destination.id.uuidString.lowercased())/\(UUID().uuidString.lowercased())-\(pending.name.replacingOccurrences(of: " ", with: "-"))"
                    try await api.uploadFile(data: pending.data, path: path, mimeType: pending.type)
                    let row = try await api.createAttachment(owner: user, scope: destination,
                                                             name: pending.name, mimeType: pending.type,
                                                             size: Int64(pending.data.count), path: path)
                    attachmentId = row.id
                } catch {
                    store.error = "Não foi possível anexar este arquivo. Tente novamente."
                    return
                }
            }
            if await store.send(text, author: user, attachment: attachmentId, poll: poll) {
                guard app.userId == user, !app.isDemo else { return }
                if draft == text { draft = "" }
                pendingAttachment = nil
                poll = nil
                app.drafts[destination.draftKey] = draft
                scrollRequest = UUID()
            }
        }
    }

    private func preparePhoto(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self), data.count <= 26_214_400 else {
                store.error = "Escolha um arquivo de até 25 MB."
                return
            }
            let type = item.supportedContentTypes.first?.preferredMIMEType ?? "application/octet-stream"
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "bin"
            pendingAttachment = ("arquivo-\(UUID().uuidString.prefix(8)).\(ext)", type, data)
            photoItem = nil
        } catch {
            store.error = "Não foi possível ler o arquivo selecionado."
        }
    }
    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.18)) { proxy.scrollTo("bottom", anchor: .bottom) }
        } else { proxy.scrollTo("bottom", anchor: .bottom) }
    }
}

private struct EditMessageView: View {
    let message: Message
    let finished: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: String

    init(message: Message, finished: @escaping (String) -> Void) {
        self.message = message
        self.finished = finished
        _text = State(initialValue: message.content)
    }

    var body: some View {
        NavigationStack {
            TextField("Mensagem", text: $text, axis: .vertical)
                .lineLimit(4...12)
                .padding(20)
                .navigationTitle("Editar mensagem")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Salvar") {
                            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard MessageRules.canSend(value) else { return }
                            finished(value)
                            dismiss()
                        }.disabled(!MessageRules.canSend(text))
                    }
                }
        }
        .presentationDetents([.medium])
    }
}

private struct PollComposer: View {
    let finished: (MessagePoll) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var options = ["", ""]
    var body: some View {
        NavigationStack {
            Form {
                Section("Pergunta") { TextField("O que você quer perguntar?", text: $question) }
                Section("Opções") {
                    ForEach(options.indices, id: \.self) { index in
                        TextField("Opção \(index + 1)", text: $options[index])
                    }
                    if options.count < 6 {
                        Button("Adicionar opção") { options.append("") }
                    }
                }
            }
            .navigationTitle("Nova enquete").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Adicionar") {
                        let values = options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                        guard question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false,
                              (2...6).contains(values.count), Set(values).count == values.count else { return }
                        finished(MessagePoll(question: question.trimmingCharacters(in: .whitespacesAndNewlines), options: values))
                    }.disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || options.filter { !$0.isEmpty }.count < 2)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct ChatBottomKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct MessageRow: View {
    let message: Message
    let profile: Profile?
    let own: Bool
    let repliedMessage: Message?
    let attachmentTapped: (Attachment) -> Void
    let reactionTapped: (String) -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if own { Spacer(minLength: 32) }
            if !own { Avatar(profile: profile, size: 34).padding(.top, 2) }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(own ? "Você" : profile?.displayName ?? "Participante")
                        .font(.caption.weight(.semibold)).foregroundStyle(own ? Orbit.lilac : .secondary)
                    Text(message.date, format: .dateTime.hour().minute())
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if message.replyTo != nil {
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2).fill(Orbit.lilac).frame(width: 3)
                        Text(repliedMessage?.content ?? "Em resposta a uma mensagem anterior")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }.fixedSize(horizontal: false, vertical: true)
                }
                Text(message.content).font(.body).textSelection(.enabled)
                if message.pinned || message.editedAt != nil {
                    HStack(spacing: 8) {
                        if message.pinned { Label("Fixada", systemImage: "pin.fill") }
                        if message.editedAt != nil { Text("editada") }
                    }.font(.caption2).foregroundStyle(.secondary)
                }
                if let poll = message.poll {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(poll.question, systemImage: "chart.bar.doc.horizontal").font(.subheadline.bold())
                        ForEach(Array(poll.options.enumerated()), id: \.offset) { index, option in
                            let votes = message.pollVotes?.filter { $0.optionIndex == index }.count ?? 0
                            HStack {
                                Text(option).font(.caption)
                                Spacer()
                                Text("\(votes)").font(.caption2).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 10).frame(minHeight: 34)
                            .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 9))
                        }
                    }
                    .padding(10).background(Orbit.raised.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
                }
                if let attachment = message.attachments {
                    if attachment.isImage, let path = attachment.path {
                        Button { attachmentTapped(attachment) } label: {
                            PrivateImage(path: path, label: attachment.name).frame(maxHeight: 300)
                        }.buttonStyle(.plain).accessibilityLabel("Ampliar \(attachment.name)")
                    }
                    Button { attachmentTapped(attachment) } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(attachment.name).lineLimit(2)
                                Text(attachment.sizeLabel).font(.caption2).foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: "doc") }
                        .font(.caption).frame(minHeight: 44, alignment: .leading)
                    }
                }
                HStack(spacing: 6) {
                    ForEach(["👍", "❤️", "😂", "🎉", "🔥", "👀"], id: \.self) { emoji in
                        let count = message.reactions?.filter { $0.emoji == emoji }.count ?? 0
                        Button { reactionTapped(emoji) } label: {
                            Text(count == 0 ? emoji : "\(emoji) \(count)")
                                .font(.caption).padding(.horizontal, 8).padding(.vertical, 5)
                                .background(Orbit.raised, in: Capsule())
                        }.buttonStyle(.plain)
                    }
                }
            }
            .padding(14)
            .background(own ? Orbit.lilac.opacity(0.12) : Orbit.surface,
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if !own { Spacer(minLength: 16) }
        }
        .accessibilityElement(children: .contain)
    }
}
