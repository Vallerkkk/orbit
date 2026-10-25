import SwiftUI
import UIKit

final class OrbitaAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .orbitaAPNsToken, object: token)
    }
}

extension Notification.Name {
    static let orbitaAPNsToken = Notification.Name("orbita.apns.token")
}

@main
struct OrbitaApp: App {
    @UIApplicationDelegateAdaptor(OrbitaAppDelegate.self) private var appDelegate
    @State private var app = AppSession()
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage(OrbitTheme.storageKey) private var themeKey = OrbitTheme.defaultKey
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Color(light: OrbitTheme.named(themeKey).accentLight, dark: OrbitTheme.named(themeKey).accent))
                .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
                .task {
                    if ProcessInfo.processInfo.arguments.contains("-demo") { app.startDemo() }
                    else { await app.launch() }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppSession.self) private var app
    @AppStorage(OrbitTheme.storageKey) private var themeKey = OrbitTheme.defaultKey
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                LaunchView().transition(.opacity)
            case .failed:
                VStack(spacing: 24) {
                    OrbitMark(size: 80)
                    ErrorNotice(text: app.error ?? "Não foi possível conectar.") {
                        Task { await app.launch() }
                    }
                    Button("Explorar demonstração") { app.startDemo() }.frame(minHeight: 44)
                }
                .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            case .signIn:
                SignInView()
                    .transition(.opacity.combined(with: .scale(scale: 1.02)))
            case .signedIn:
                // Trocar de tema recria as abas (as cores Orbit.* são lidas de novo); a chamada
                // e a sessão ficam no AppSession e continuam.
                MainTabs().id("\(app.userId?.uuidString ?? "")-\(themeKey)")
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: app.phase)
        .background(Orbit.background.ignoresSafeArea())
    }
}

private struct SignInView: View {
    @Environment(AppSession.self) private var app
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?
    private enum Field { case email, password }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack { OrbitMark(size: 52); Spacer(); Text("ÓRBITA").font(.caption.bold()).tracking(4) }
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Perto de quem\nfaz seu mundo.").font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Conversas, comunidades e voz.\nAgora no ritmo do seu iPhone.")
                            .font(.body).foregroundStyle(.secondary)
                    }.padding(.top, 20)
                    VStack(spacing: 14) {
                        TextField("Seu e-mail", text: $email)
                            .textContentType(.username).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focus, equals: .email).submitLabel(.next)
                            .onSubmit { focus = .password }
                            .accessibilityLabel("E-mail")
                        Divider()
                        SecureField("Sua senha", text: $password).textContentType(.password)
                            .focused($focus, equals: .password).submitLabel(.go)
                            .onSubmit { authenticate() }.accessibilityLabel("Senha")
                    }
                    .padding(20).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 22))
                    if let error = app.error { ErrorNotice(text: error) }
                    Button(action: authenticate) {
                        if app.busy { ProgressView().tint(Orbit.ink) }
                        else { HStack { Text("Entrar na minha órbita"); Image(systemName: "arrow.right") } }
                    }
                    .buttonStyle(OrbitButtonStyle())
                    .disabled(app.busy || email.isEmpty || password.isEmpty)
                    VStack(spacing: 12) {
                        Link("Criar conta ou recuperar senha no site", destination: APIClient.origin)
                            .font(.subheadline).frame(minHeight: 44)
                        Button("Conhecer o aplicativo") { focus = nil; app.startDemo(); password = "" }
                            .font(.subheadline).frame(minHeight: 44)
                    }.frame(maxWidth: .infinity)
                    Label("Mesma conta. Uma experiência nativa.", systemImage: "lock.shield")
                        .font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }.padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Orbit.background)
            .toolbar(.hidden, for: .navigationBar)
        }
        .onChange(of: app.phase) { _, phase in if phase == .signedIn { password = "" } }
    }
    private func authenticate() {
        guard !app.busy, !email.isEmpty, !password.isEmpty else { return }
        focus = nil
        Task { await app.signIn(email: email, password: password); password = "" }
    }
}

struct MainTabs: View {
    @Environment(AppSession.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @SceneStorage("orbita.tab") private var tab = 0
    var body: some View {
        @Bindable var calls = app.calls
        TabView(selection: $tab) {
            NavigationStack { CommunitiesView() }
                .tabItem { Label("Comunidades", systemImage: "square.stack.3d.up") }.tag(0)
            NavigationStack { ConversationsView() }
                .tabItem { Label("Conversas", systemImage: "bubble.left.and.bubble.right") }.tag(1)
            NavigationStack { FeedView() }
                .tabItem { Label("Feed", systemImage: "sparkles") }.tag(2)
            NavigationStack { ProfileView() }
                .tabItem { Label("Você", systemImage: "person.crop.circle") }.tag(3)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if app.isDemo {
                Text("DEMONSTRAÇÃO · dados fictícios, sem envios")
                    .font(.caption2.bold()).foregroundStyle(Orbit.ink)
                    .frame(maxWidth: .infinity).padding(.vertical, 6).background(Orbit.lilac)
            }
            if calls.hasCall {
                CallMiniBar(room: calls.room)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.78), value: calls.hasCall)
        .sheet(isPresented: $calls.showing) {
            ActiveCallView(room: calls.room)
                .presentationDragIndicator(.visible)
                .presentationDetents([.large])
        }
        .task(id: scenePhase) {
            guard scenePhase == .active, !app.isDemo, let api = app.api, let user = app.userId else { return }
            await app.directory.load(api: api, user: user, force: app.directory.loaded)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { Task { await calls.suspendCamera() } }
        }
    }
}
