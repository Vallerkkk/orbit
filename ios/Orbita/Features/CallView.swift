import SwiftUI
import LiveKit
import AVKit

struct CallMiniBar: View {
    @ObservedObject var room: Room
    @Environment(AppSession.self) private var app
    var body: some View {
        Button { app.calls.showing = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "waveform").font(.headline)
                VStack(alignment: .leading, spacing: 2) {
                    Text(app.calls.target?.title ?? "Chamada").font(.caption.bold()).lineLimit(1)
                    Text(room.connectionState == .connected ? "Toque para voltar à chamada"
                         : room.connectionState == .disconnected && !app.calls.joining
                         ? "Desconectado · toque para ver" : "Conectando ou reconectando…")
                        .font(.caption2).lineLimit(1)
                }
                Spacer()
                Image(systemName: app.calls.micEnabled ? "mic.fill" : "mic.slash.fill")
                Image(systemName: "chevron.up").font(.caption.bold())
            }
            .foregroundStyle(Orbit.ink).padding(.horizontal, 20).frame(minHeight: 52)
            .background(Orbit.gradient)
        }.buttonStyle(.plain).accessibilityLabel("Voltar à chamada \(app.calls.target?.title ?? "")")
    }
}

struct ActiveCallView: View {
    @ObservedObject var room: Room
    @Environment(AppSession.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    private var calls: CallCoordinator { app.calls }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionEyebrow(text: calls.stage ? "Palco de voz" : "Perto, mesmo de longe")
                        Text(calls.target?.title ?? "Chamada").font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                        Label(status, systemImage: room.connectionState == .connected ? "checkmark.shield" : "antenna.radiowaves.left.and.right")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if !calls.canPublish && !calls.joining && room.connectionState == .connected {
                            Text("Você está na plateia. Seu microfone e sua câmera permanecem desligados.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    if let error = calls.error { ErrorNotice(text: error) }
                    if calls.joining { ProgressView("Entrando na sala…").frame(maxWidth: .infinity).padding(20) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 260 : 145), spacing: 12)], spacing: 12) {
                        ParticipantTile(participant: room.localParticipant, local: true)
                        ForEach(Array(room.remoteParticipants.values).sorted {
                            ($0.identity?.stringValue ?? "") < ($1.identity?.stringValue ?? "")
                        }, id: \.identity) { participant in
                            ParticipantTile(participant: participant, local: false)
                        }
                    }
                    if room.remoteParticipants.isEmpty && room.connectionState == .connected {
                        Text("A sala está pronta. A próxima boa conversa pode chegar a qualquer momento.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if room.connectionState == .disconnected && !calls.joining {
                        Text("A chamada foi desconectada. Saia e entre novamente para tentar reconectar.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }.padding(24)
            }
            .background(Orbit.background)
            .safeAreaInset(edge: .bottom) { controls }
            .navigationTitle("Na mesma órbita").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { calls.showing = false } label: {
                        Image(systemName: "chevron.down").frame(width: 44, height: 44)
                    }.accessibilityLabel("Minimizar chamada")
                }
            }
        }
    }
    private var status: String {
        switch room.connectionState {
        case .connected: return "\(room.remoteParticipants.count + 1) na sala · conexão ativa"
        case .reconnecting: return "Reconectando sem encerrar sua chamada"
        case .connecting: return "Conectando…"
        default: return calls.joining ? "Preparando a sala…" : "Desconectado"
        }
    }
    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { mediaButtons; endButton }
            VStack(spacing: 12) { HStack(spacing: 12) { mediaButtons }; endButton }
        }
        .padding(20).background(Orbit.surface)
    }
    @ViewBuilder private var mediaButtons: some View {
        control(calls.micEnabled ? "Silenciar" : "Microfone",
                icon: calls.micEnabled ? "mic.fill" : "mic.slash.fill",
                active: calls.micEnabled) { Task { await calls.microphone() } }
        control("Câmera", icon: calls.cameraEnabled ? "video.fill" : "video.slash.fill",
                active: calls.cameraEnabled) { Task { await calls.camera() } }
        control(calls.screenShareEnabled ? "Parar tela" : "Tela",
                icon: calls.screenShareEnabled ? "rectangle.inset.filled.on.rectangle" : "rectangle.on.rectangle",
                active: calls.screenShareEnabled) { Task { await calls.screenShare() } }
        VStack(spacing: 6) {
            AudioRoutePicker().frame(width: 52, height: 52)
                .background(Orbit.raised, in: Circle())
                .accessibilityLabel("Saída de áudio do sistema")
            Text("Áudio").font(.caption2).foregroundStyle(.secondary)
        }.frame(minWidth: 62)
    }
    private var endButton: some View {
        Button { Task { await calls.leave() } } label: {
            VStack(spacing: 6) {
                Image(systemName: "phone.down.fill").font(.title3)
                    .frame(width: 56, height: 52).foregroundStyle(.white).background(Orbit.danger, in: Capsule())
                Text("Sair").font(.caption2).foregroundStyle(.secondary)
            }
        }.accessibilityLabel("Sair da chamada")
    }
    private func control(_ title: String, icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.title3)
                    .foregroundStyle(active ? Orbit.ink : .primary).frame(width: 52, height: 52)
                    .background(active ? Color(hex: "B78CFF") : Orbit.raised, in: Circle())
                Text(title).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(minWidth: 62)
        }
        .accessibilityLabel(title)
        .accessibilityValue(active ? "Ligado" : "Desligado")
        .disabled(!calls.canPublish || calls.changingMedia || room.connectionState != .connected)
    }
}

private struct ParticipantTile: View {
    @ObservedObject var participant: Participant
    let local: Bool
    private var video: VideoTrack? {
        // Screen share takes priority over the camera tile, same as the web client.
        if let screenShare = participant.videoTracks.first(where: { $0.source == .screenShareVideo }),
           !screenShare.isMuted {
            return screenShare.track as? VideoTrack
        }
        guard let publication = participant.videoTracks.first(where: { $0.source == .camera }),
              !publication.isMuted else { return nil }
        return publication.track as? VideoTrack
    }
    private var name: String { local ? "Você" : participant.name ?? "Participante" }
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Orbit.raised
            if let video { NativeVideo(track: video) }
            else {
                VStack(spacing: 12) {
                    Text(String(name.prefix(2)).uppercased())
                        .font(.title2.bold()).foregroundStyle(Orbit.lilac)
                        .frame(width: 64, height: 64)
                        .background(Orbit.lilac.opacity(0.12), in: RoundedRectangle(cornerRadius: 24))
                    Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(.bottom, 20)
            }
            HStack(spacing: 6) {
                Image(systemName: participant.isMicrophoneEnabled() ? "mic.fill" : "mic.slash.fill")
                Text(name).lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.caption.weight(.semibold)).foregroundStyle(.white)
            .padding(10).background(.black.opacity(0.55))
        }
        .frame(minHeight: 190)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(participant.isSpeaking ? Orbit.green : .clear, lineWidth: 2))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(participant.isSpeaking ? "falando" : "na sala"), \(participant.isMicrophoneEnabled() ? "microfone ligado" : "microfone desligado")")
    }
}

private struct NativeVideo: UIViewRepresentable {
    let track: VideoTrack
    func makeUIView(context: Context) -> VideoView {
        let view = VideoView(frame: .zero)
        view.layoutMode = .fill
        view.track = track
        return view
    }
    func updateUIView(_ uiView: VideoView, context: Context) { if uiView.track !== track { uiView.track = track } }
    static func dismantleUIView(_ uiView: VideoView, coordinator: ()) { uiView.track = nil }
}

private struct AudioRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .label
        view.activeTintColor = UIColor(Orbit.pink)
        return view
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

