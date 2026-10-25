import SwiftUI
import UIKit

/// Light haptic touches for moments that deserve to feel acknowledged —
/// joining/leaving a call, toggling mic/camera, surfacing an error. Kept to
/// a handful of call sites so it reads as responsive, not noisy.
enum Haptic {
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

/// Temas do app, os mesmos de Configurações → Tema no site/desktop (grafite.css).
/// A escolha fica em UserDefaults com a mesma chave do site ("orbita-theme"), e as
/// telas web abertas dentro do app recebem o mesmo tema.
struct OrbitTheme: Identifiable, Equatable {
    let id: String
    let name: String
    let accent: String       // --ac
    let secondary: String    // --ac2
    let onAccent: String     // --onac (texto sobre o destaque)
    let accentLight: String  // --ac-l (destaque no modo claro)

    static let storageKey = "orbita-theme"
    static let defaultKey = "nitro"
    static let all: [OrbitTheme] = [
        .init(id: "nitro", name: "Pink", accent: "E07AD6", secondary: "B78CFF", onAccent: "1A0A18", accentLight: "B03AA6"),
        .init(id: "orbita", name: "Violeta Órbita", accent: "9B87FF", secondary: "5AA9FF", onAccent: "0F0B24", accentLight: "6A4FE0"),
        .init(id: "blurple", name: "Blurple", accent: "7F89FF", secondary: "4FB3FF", onAccent: "0B0D2A", accentLight: "4752C4"),
        .init(id: "emerald", name: "Emerald", accent: "34D399", secondary: "22D3EE", onAccent: "03241A", accentLight: "047857"),
        .init(id: "cyber", name: "Cyber Neon", accent: "22E6F5", secondary: "FF4FD8", onAccent: "001E22", accentLight: "0E7490"),
        .init(id: "forest", name: "Floresta", accent: "7BC96F", secondary: "D6C25E", onAccent: "0F2209", accentLight: "3F7A34"),
        .init(id: "ocean", name: "Oceano", accent: "4FB3FF", secondary: "2DD4BF", onAccent: "04203A", accentLight: "0B6BB8"),
        .init(id: "sunset", name: "Pôr do Sol", accent: "FF8A5C", secondary: "FF5D8F", onAccent: "2A0F05", accentLight: "C2410C"),
        .init(id: "midnight", name: "Meia-Noite", accent: "8FA8FF", secondary: "7C6BFF", onAccent: "0B1230", accentLight: "3B4FC4"),
        .init(id: "blood", name: "Sangue", accent: "FF5A6A", secondary: "FF9F43", onAccent: "2A0508", accentLight: "C0182E"),
        .init(id: "gold", name: "Ouro", accent: "F2C14E", secondary: "FF9F43", onAccent: "2A1F02", accentLight: "8A6100"),
        .init(id: "sakura", name: "Sakura", accent: "FF9EC7", secondary: "C9A7FF", onAccent: "2B0A1A", accentLight: "C2386F"),
    ]

    static func named(_ key: String?) -> OrbitTheme { all.first { $0.id == key } ?? all[0] }
    static var current: OrbitTheme { named(UserDefaults.standard.string(forKey: storageKey)) }
    static func isValid(_ key: String) -> Bool { all.contains { $0.id == key } }
}

/// Cores do app. As de destaque seguem o tema escolhido; a raiz do app é recriada
/// quando o tema muda (OrbitaApp), então todas as telas releem estes valores.
enum Orbit {
    static var pink: Color { Color(light: OrbitTheme.current.accentLight, dark: OrbitTheme.current.accent) }
    static var lilac: Color { Color(hex: OrbitTheme.current.secondary) }
    static var ink: Color { Color(hex: OrbitTheme.current.onAccent) }
    static let green = Color(hex: "3DDC84")
    static let danger = Color(hex: "FF5D6C")
    static let background = Color("Background")
    static let surface = Color("Surface")
    static let raised = Color("Raised")
    static var gradient: LinearGradient {
        LinearGradient(colors: [Color(hex: OrbitTheme.current.accent), Color(hex: OrbitTheme.current.secondary)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let value = UInt64(hex, radix: 16) ?? 0x8B80FF
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255,
                  green: Double((value >> 8) & 255) / 255,
                  blue: Double(value & 255) / 255, opacity: 1)
    }

    /// Cor que acompanha o modo claro/escuro do iPhone.
    init(light: String, dark: String) {
        let light = UIColor(Color(hex: light)), dark = UIColor(Color(hex: dark))
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

struct OrbitButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Orbit.ink)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Orbit.gradient, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .opacity(!isEnabled ? 0.45 : configuration.isPressed ? 0.78 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct OrbitMark: View {
    var size: CGFloat = 64
    var body: some View {
        Image("OrbitLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The app's launch moment: the mark scales/fades in with a spring, a thin
/// orbiting ring drifts around it, and the tagline follows a beat later.
/// Gives the cold start a sense of arrival instead of a flat logo+spinner.
struct LaunchView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var markScale: CGFloat = 0.55
    @State private var markOpacity: Double = 0
    @State private var ringOpacity: Double = 0
    @State private var ringRotation: Double = -40
    @State private var taglineOpacity: Double = 0
    @State private var taglineOffset: CGFloat = 8

    var body: some View {
        VStack(spacing: 28) {
            ZStack {
                Circle()
                    .stroke(Orbit.gradient, lineWidth: 1.6)
                    .frame(width: 132, height: 132)
                    .opacity(ringOpacity)
                    .rotationEffect(.degrees(ringRotation))
                Circle()
                    .trim(from: 0, to: 0.22)
                    .stroke(Orbit.pink, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .frame(width: 132, height: 132)
                    .opacity(ringOpacity)
                    .rotationEffect(.degrees(ringRotation))
                OrbitMark(size: 88)
                    .scaleEffect(markScale)
                    .opacity(markOpacity)
            }
            VStack(spacing: 14) {
                Text("Seu lugar no universo.")
                    .font(.title3.weight(.semibold))
                ProgressView().tint(Orbit.pink)
            }
            .opacity(taglineOpacity)
            .offset(y: taglineOffset)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear(perform: animateIn)
    }

    private func animateIn() {
        guard !reduceMotion else {
            markScale = 1; markOpacity = 1; ringOpacity = 1; taglineOpacity = 1; taglineOffset = 0
            return
        }
        withAnimation(.spring(response: 0.62, dampingFraction: 0.62)) {
            markScale = 1
            markOpacity = 1
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.15)) {
            ringOpacity = 1
        }
        withAnimation(.easeOut(duration: 0.55).delay(0.3)) {
            taglineOpacity = 1
            taglineOffset = 0
        }
        withAnimation(.linear(duration: 10).repeatForever(autoreverses: false)) {
            ringRotation = ringRotation + 360
        }
    }
}

struct SectionEyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.caption.weight(.bold)).tracking(1.7).foregroundStyle(.secondary)
    }
}

struct EmptyCard: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.largeTitle).foregroundStyle(Orbit.lilac).accessibilityHidden(true)
            Text(title).font(.title3.bold())
            Text(detail).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(28)
        .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 24))
    }
}

struct ErrorNotice: View {
    let text: String
    var retry: (() -> Void)?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(text, systemImage: "exclamationmark.circle").font(.subheadline)
            if let retry {
                Button("Tentar novamente", action: retry).font(.subheadline.bold()).frame(minHeight: 44)
            }
        }
        .foregroundStyle(.primary)
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Orbit.danger.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }
}

struct SearchField: View {
    let prompt: String
    @Binding var text: String
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(prompt, text: $text).textInputAutocapitalization(.never).autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Limpar busca")
            }
        }
        .padding(.leading, 14).padding(.trailing, text.isEmpty ? 14 : 0).frame(minHeight: 48)
        .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 16))
    }
}
