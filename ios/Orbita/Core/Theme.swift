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

enum Orbit {
    static let pink = Color("AccentColor")
    static let lilac = Color("Lilac")
    static let ink = Color(hex: "1A0A18")
    static let green = Color(hex: "3DDC84")
    static let danger = Color(hex: "FF5D6C")
    static let background = Color("Background")
    static let surface = Color("Surface")
    static let raised = Color("Raised")
    static let gradient = LinearGradient(colors: [Color(hex: "E07AD6"), Color(hex: "B78CFF")],
                                         startPoint: .topLeading, endPoint: .bottomTrailing)
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let value = UInt64(hex, radix: 16) ?? 0x8B80FF
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255,
                  green: Double((value >> 8) & 255) / 255,
                  blue: Double(value & 255) / 255, opacity: 1)
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
