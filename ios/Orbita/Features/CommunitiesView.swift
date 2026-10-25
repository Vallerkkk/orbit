import SwiftUI

struct CommunitiesView: View {
    @Environment(AppSession.self) private var app
    @State private var search = ""
    @State private var picker = false
    @State private var voice: ChatDestination?
    @State private var pendingVoice: ChatDestination?
    private var store: DirectoryStore { app.directory }
    private var channels: [Channel] {
        store.visibleChannels.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                header
                SearchField(prompt: "Encontre um canal", text: $search)
                if let error = store.error {
                    ErrorNotice(text: error) { Task { await refresh() } }
                }
                if store.loading && !store.loaded {
                    ProgressView("Buscando suas comunidades…").frame(maxWidth: .infinity).padding(36)
                } else if store.communities.isEmpty {
                    EmptyCard(icon: "globe.europe.africa", title: "Seu universo começa aqui",
                              detail: "Nenhuma comunidade disponível para esta conta. Você pode entrar ou criar uma pelo site.")
                    Link("Abrir Órbita na web", destination: APIClient.origin).frame(minHeight: 44)
                } else {
                    channelSection(title: "Conversas de texto", rooms: channels.filter { !$0.isVoice })
                    channelSection(title: "Salas de voz", rooms: channels.filter(\.isVoice))
                    if channels.isEmpty {
                        EmptyCard(icon: "number", title: "Nenhum canal por aqui",
                                  detail: search.isEmpty ? "Os canais aparecerão quando você tiver acesso." : "Tente buscar por outro nome.")
                    }
                }
                Label("Entre, converse e sinta-se em casa.", systemImage: "sparkle")
                    .font(.footnote).foregroundStyle(.secondary).padding(.bottom, 24)
            }.padding(.horizontal, 20).padding(.top, 12)
        }
        .background(Orbit.background)
        .navigationTitle("Comunidades")
        .refreshable { await refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { picker = true } label: {
                    Image(systemName: "square.grid.2x2").frame(minWidth: 44, minHeight: 44)
                }.accessibilityLabel("Trocar comunidade")
            }
        }
        .sheet(isPresented: $picker) { CommunityPicker() }
        .sheet(item: $voice, onDismiss: {
            if let target = pendingVoice, let api = app.api {
                pendingVoice = nil
                Task { await app.calls.join(target, api: api) }
            }
        }) { target in VoiceLobby(target: target) { pendingVoice = target } }
        .navigationDestination(for: ChatDestination.self) { target in ChatView(destination: target) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18).fill(Orbit.gradient).opacity(0.18)
                    OrbitMark(size: 46)
                }.frame(width: 66, height: 66)
                Spacer()
                Image(systemName: "sparkles").font(.title2).foregroundStyle(Orbit.pink).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                SectionEyebrow(text: "Seu ponto de encontro")
                Text(store.selected?.name ?? "Órbita").font(.largeTitle.bold())
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Text(store.selected?.description.isEmpty == false
                     ? store.selected!.description : "Voz, boas conversas e a sua comunidade.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Button { picker = true } label: {
                HStack {
                    Text("Suas comunidades").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(store.communities.count)").foregroundStyle(.secondary)
                    Image(systemName: "chevron.down").font(.caption.bold())
                }
                .frame(minHeight: 44)
            }.foregroundStyle(.primary)
        }
        .padding(22)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Orbit.surface)
                .overlay(alignment: .top) {
                    RoundedRectangle(cornerRadius: 2).fill(Orbit.gradient).frame(width: 64, height: 3)
                }
        }
    }

    @ViewBuilder private func channelSection(title: String, rooms: [Channel]) -> some View {
        if !rooms.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionEyebrow(text: title)
                VStack(spacing: 0) {
                    ForEach(Array(rooms.enumerated()), id: \.element.id) { index, channel in
                        if channel.isVoice {
                            Button { voice = channel.destination } label: { channelRow(channel) }.buttonStyle(.plain)
                                .accessibilityIdentifier("channel-\(channel.id.uuidString.lowercased())")
                        } else {
                            NavigationLink(value: channel.destination) { channelRow(channel) }.buttonStyle(.plain)
                                .accessibilityIdentifier("channel-\(channel.id.uuidString.lowercased())")
                        }
                        if index != rooms.count - 1 { Divider().padding(.leading, 70) }
                    }
                }
                .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 22))
            }
        }
    }

    private func channelRow(_ channel: Channel) -> some View {
        HStack(spacing: 14) {
            Image(systemName: channel.isVoice ? "waveform" : "number")
                .font(.title3.weight(.semibold))
                .foregroundStyle(channel.isVoice ? Orbit.pink : Orbit.lilac)
                .frame(width: 40, height: 44)
                .background(Orbit.raised, in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 4) {
                Text(channel.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                Text(channel.description.isEmpty ? (channel.isVoice ? "Toque para entrar na sala" : "Comece uma conversa")
                     : channel.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16).padding(.vertical, 14).contentShape(Rectangle())
    }

    private func refresh() async {
        guard !app.isDemo, let api = app.api, let user = app.userId else { return }
        await store.load(api: api, user: user, force: true)
    }
}

private struct CommunityPicker: View {
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List(app.directory.communities) { group in
                Button {
                    app.directory.selectedCommunityId = group.id
                    dismiss()
                } label: {
                    HStack(spacing: 14) {
                        Text(String(group.name.prefix(2)).uppercased()).font(.headline)
                            .foregroundStyle(Orbit.lilac).frame(width: 48, height: 48)
                            .background(Orbit.lilac.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(group.name).foregroundStyle(.primary).font(.headline)
                            if !group.description.isEmpty {
                                Text(group.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                        Spacer()
                        if group.id == app.directory.selectedCommunityId {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Orbit.pink)
                        }
                    }.padding(.vertical, 4)
                }
                .listRowBackground(Orbit.surface)
            }
            .scrollContentBackground(.hidden).background(Orbit.background)
            .navigationTitle("Suas comunidades").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Concluir") { dismiss() } } }
        }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
}

struct VoiceLobby: View {
    let target: ChatDestination
    let onJoin: () -> Void
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                Image(systemName: "waveform").font(.system(size: 52, weight: .medium))
                    .foregroundStyle(Orbit.gradient).padding(28)
                    .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 36))
                    .accessibilityHidden(true)
                Text(target.title).font(.largeTitle.bold()).multilineTextAlignment(.center)
                Text("Entre para ouvir.\nVocê decide quando ligar o microfone e a câmera.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
                Spacer()
                if app.isDemo {
                    Text("As chamadas reais estão desativadas na demonstração.").font(.footnote).foregroundStyle(.secondary)
                }
                Button("Entrar na sala") {
                    guard app.api != nil else { return }
                    onJoin()
                    dismiss()
                }
                .buttonStyle(OrbitButtonStyle())
                .disabled(app.isDemo || app.api == nil)
                Label("Microfone e câmera começam desligados", systemImage: "lock.shield")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(24).background(Orbit.background)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
            }
        }
        .presentationDetents([.large]).presentationDragIndicator(.visible)
    }
}
