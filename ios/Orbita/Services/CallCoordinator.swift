import SwiftUI
import Observation
import AVFoundation
import LiveKit
import Combine

struct JoinTicket: Decodable {
    let url: String
    let token: String
    let canPublish: Bool
    let stage: Bool
    let moderator: Bool
}

// Owned by AppSession, never by a channel view. Closing a screen or the sheet
// does not destroy the room. Each join owns its own Room, avoiding join/leave races.
@MainActor @Observable
final class CallCoordinator {
    private(set) var room = Room()
    private(set) var target: ChatDestination?
    private(set) var joining = false
    private(set) var canPublish = false
    private(set) var stage = false
    private(set) var micEnabled = false
    private(set) var cameraEnabled = false
    private(set) var screenShareEnabled = false
    var showing = false
    var changingMedia = false
    var error: String?
    private var revision = UUID()
    @ObservationIgnored private var observation: AnyCancellable?
    @ObservationIgnored private var broadcastObservation: AnyCancellable?
    var hasCall: Bool { target != nil }

    init() {
        // On iOS versions that use ReplayKit, starting the system broadcast
        // happens after setScreenShare returns. Keep the UI in sync with the
        // LiveKit broadcast manager instead of guessing from the button tap.
        broadcastObservation = BroadcastManager.shared.isBroadcastingPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] broadcasting in
                guard let self else { return }
                if !broadcasting { self.screenShareEnabled = false }
            }
    }

    func join(_ target: ChatDestination, api: APIClient) async {
        if hasCall {
            showing = true
            if self.target?.id != target.id {
                error = "Encerre a chamada atual antes de entrar em outra sala."
            }
            return
        }
        revision = UUID()
        let stamp = revision
        let screenOptions = ScreenShareCaptureOptions(
            dimensions: .h1080_169,
            fps: 15,
            appAudio: true,
            useBroadcastExtension: true,
            useScreenCaptureKit: true
        )
        let ownedRoom = Room(roomOptions: RoomOptions(
            defaultScreenShareCaptureOptions: screenOptions,
            adaptiveStream: true,
            dynacast: true
        ))
        room = ownedRoom
        observation = ownedRoom.objectWillChange.sink { [weak self, weak ownedRoom] _ in
            Task { @MainActor in
                guard let self, let ownedRoom, self.revision == stamp else { return }
                self.micEnabled = ownedRoom.localParticipant.isMicrophoneEnabled()
                self.cameraEnabled = ownedRoom.localParticipant.isCameraEnabled()
                self.screenShareEnabled = ownedRoom.localParticipant.isScreenShareEnabled()
            }
        }
        self.target = target
        joining = true
        showing = true
        error = nil
        micEnabled = false
        cameraEnabled = false
        screenShareEnabled = false
        do {
            let ticket = try await api.join(target)
            guard revision == stamp else { return }
            guard let url = URL(string: ticket.url), url.scheme == "wss" else {
                throw AppFailure.message("A sala não está usando uma conexão segura.")
            }
            canPublish = ticket.canPublish
            stage = ticket.stage
            // Join silently. Microphone and camera are enabled only after a tap
            // and the corresponding system permission; audience rooms cannot publish.
            try await ownedRoom.connect(url: ticket.url, token: ticket.token)
            guard revision == stamp else { await ownedRoom.disconnect(); return }
            joining = false
            Haptic.success()
            if target.isDirect {
                struct Event: Encodable { let conversationId: UUID; let callerId: UUID }
                do {
                    let current = try await api.currentSession()
                    guard revision == stamp else { return }
                    try await api.mutate("call_events", body: Event(conversationId: target.id, callerId: current.user.id))
                } catch {
                    if revision == stamp { self.error = "Você entrou na sala, mas não foi possível avisar a outra pessoa." }
                }
            }
        } catch {
            guard revision == stamp else { await ownedRoom.disconnect(); return }
            joining = false
            self.error = "Não foi possível entrar na chamada. Verifique a conexão e tente novamente."
            Haptic.error()
            await ownedRoom.disconnect()
        }
    }

    func microphone() async {
        guard canPublish, !changingMedia, room.connectionState == .connected else { return }
        let stamp = revision
        let owned = room
        let enable = !micEnabled
        changingMedia = true
        defer { if revision == stamp { changingMedia = false } }
        do {
            if enable {
                let granted = await withCheckedContinuation { continuation in
                    if #available(iOS 17.0, *) {
                        AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
                    } else {
                        AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
                    }
                }
                guard revision == stamp else { return }
                guard granted else {
                    throw AppFailure.message("Permita o microfone nos Ajustes do iPhone para falar.")
                }
            }
            try await owned.localParticipant.setMicrophone(enabled: enable)
            guard revision == stamp else { return }
            micEnabled = enable
            error = nil
        } catch { if revision == stamp { self.error = error.localizedDescription } }
    }

    func camera() async {
        guard canPublish, !changingMedia, room.connectionState == .connected else { return }
        let stamp = revision
        let owned = room
        let enable = !cameraEnabled
        changingMedia = true
        defer { if revision == stamp { changingMedia = false } }
        do {
            if enable {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                guard revision == stamp else { return }
                guard granted else {
                    throw AppFailure.message("Permita a câmera nos Ajustes do iPhone para usar vídeo.")
                }
            }
            try await owned.localParticipant.setCamera(enabled: enable)
            guard revision == stamp else { return }
            cameraEnabled = enable
            error = nil
        } catch { if revision == stamp { self.error = error.localizedDescription } }
    }

    func screenShare() async {
        guard canPublish, !changingMedia, room.connectionState == .connected else { return }
        let stamp = revision
        let owned = room
        let enable = !screenShareEnabled
        changingMedia = true
        defer { if revision == stamp { changingMedia = false } }
        do {
            let publication = try await owned.localParticipant.setScreenShare(enabled: enable)
            guard revision == stamp else { return }
            if enable {
                // With ReplayKit, LiveKit opens the system broadcast picker and
                // returns nil until the user actually selects Órbita. Do not
                // show a false active state or make the next tap stop sharing.
                guard publication != nil || BroadcastManager.shared.isBroadcasting else {
                    screenShareEnabled = false
                    error = nil
                    return
                }
                screenShareEnabled = true
            } else {
                if BroadcastManager.shared.isBroadcasting {
                    BroadcastManager.shared.requestStop()
                }
                screenShareEnabled = false
            }
            error = nil
        } catch {
            if revision == stamp {
                self.error = enable
                    ? "Não foi possível compartilhar a tela. Confirme a seleção no seletor do sistema."
                    : error.localizedDescription
            }
        }
    }

    func leave() async {
        revision = UUID()
        let previous = room
        observation = nil
        target = nil
        showing = false
        joining = false
        changingMedia = false
        micEnabled = false
        cameraEnabled = false
        screenShareEnabled = false
        canPublish = false
        error = nil
        if BroadcastManager.shared.isBroadcasting { BroadcastManager.shared.requestStop() }
        await previous.disconnect()
    }

    func suspendCamera() async {
        let stamp = revision
        let owned = room
        guard hasCall, owned.localParticipant.isCameraEnabled() else { return }
        do {
            try await owned.localParticipant.setCamera(enabled: false)
            if revision == stamp { cameraEnabled = false }
        } catch {
            if revision == stamp { self.error = "Não foi possível pausar a câmera. Encerre a chamada se necessário." }
        }
    }
}
