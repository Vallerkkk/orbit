import SwiftUI
import UIKit

struct ProfileView: View {
    @Environment(AppSession.self) private var app
    @AppStorage("appearance") private var appearance = "system"
    @State private var editing = false
    @State private var logout = false
    private var profile: Profile? { app.directory.me }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top) {
                        Avatar(profile: profile, size: 88)
                        Spacer()
                        Text("SUA ÓRBITA").font(.caption2.bold()).tracking(2).foregroundStyle(Orbit.lilac)
                            .padding(.top, 8)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(profile?.displayName ?? "Você").font(.largeTitle.bold())
                            .fixedSize(horizontal: false, vertical: true)
                        Text(profile?.username.map { "@\($0)" } ?? "").font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let bio = profile?.bio, !bio.isEmpty { Text(bio).font(.body).foregroundStyle(.secondary) }
                    if let pronouns = profile?.pronouns, !pronouns.isEmpty {
                        Text(pronouns).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let status = profile?.customStatus, !status.isEmpty {
                        Label(status, systemImage: "text.bubble").font(.subheadline)
                    }
                    if let activity = profile?.presenceActivity, !activity.isEmpty {
                        Label(activity, systemImage: "waveform").font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Editar meu perfil") { editing = true }
                        .buttonStyle(OrbitButtonStyle()).disabled(app.isDemo || profile == nil)
                }
                .padding(24).frame(maxWidth: .infinity, alignment: .leading)
                .background(Orbit.surface, in: RoundedRectangle(cornerRadius: 28))
                VStack(alignment: .leading, spacing: 16) {
                    SectionEyebrow(text: "Do seu jeito")
                    Label("Aparência", systemImage: "circle.lefthalf.filled").font(.headline)
                    Picker("Aparência", selection: $appearance) {
                        Text("Sistema").tag("system")
                        Text("Claro").tag("light")
                        Text("Escuro").tag("dark")
                    }.pickerStyle(.segmented)
                    Text("O tamanho do texto e a redução de movimento seguem os Ajustes do iPhone.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(20).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 22))
                VStack(alignment: .leading, spacing: 0) {
                    Link(destination: URL(string: UIApplication.openSettingsURLString)!) {
                        settingsRow("Permissões do iPhone", icon: "hand.raised")
                    }
                    Divider().padding(.leading, 54)
                    Link(destination: APIClient.origin) { settingsRow("Conta e recursos na web", icon: "safari") }
                }
                .padding(.horizontal, 16).background(Orbit.surface, in: RoundedRectangle(cornerRadius: 22))
                VStack(alignment: .leading, spacing: 8) {
                    Text("Feito para estar perto.").font(.headline)
                    Text("Órbita para iOS · versão 1.0\nComunidades, conversas e voz em uma experiência nativa.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(.horizontal, 4)
                if let error = app.error { ErrorNotice(text: error) }
                Button(role: .destructive) { logout = true } label: {
                    Label(app.isDemo ? "Sair da demonstração" : "Sair desta conta", systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.subheadline.bold()).frame(maxWidth: .infinity, minHeight: 50)
                }.disabled(app.busy)
                Text("Criadores · VallerJP").font(.caption2).foregroundStyle(.tertiary).frame(maxWidth: .infinity)
            }.padding(20)
        }
        .background(Orbit.background)
        .navigationTitle("Você")
        .sheet(isPresented: $editing) { EditProfileView() }
        .confirmationDialog("Sair da Órbita neste iPhone?", isPresented: $logout, titleVisibility: .visible) {
            Button("Sair", role: .destructive) { Task { await app.signOut() } }
            Button("Cancelar", role: .cancel) {}
        } message: { Text("Chamadas serão encerradas e rascunhos locais serão apagados.") }
    }
    private func settingsRow(_ title: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).frame(width: 24).foregroundStyle(Orbit.lilac)
            Text(title).font(.subheadline).foregroundStyle(.primary)
            Spacer()
            Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary)
        }.frame(minHeight: 58).contentShape(Rectangle())
    }
}

private struct EditProfileView: View {
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var bio = ""
    @State private var pronouns = ""
    @State private var customStatus = ""
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Como você quer aparecer") {
                    TextField("Nome", text: $name).textContentType(.nickname)
                    Text("\(name.unicodeScalars.count)/50").font(.caption).foregroundStyle(.secondary)
                }
                Section("Um pouco sobre você") {
                    TextField("Sua bio", text: $bio, axis: .vertical).lineLimit(3...6)
                    Text("\(bio.unicodeScalars.count)/320").font(.caption).foregroundStyle(.secondary)
                }
                Section("Como você quer ser encontrado") {
                    TextField("Pronomes", text: $pronouns)
                    TextField("Status personalizado", text: $customStatus)
                }
                if let error { Section { ErrorNotice(text: error) } }
            }
            .disabled(saving).scrollContentBackground(.hidden).background(Orbit.background)
            .navigationTitle("Editar perfil").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard let api = app.api, let user = app.userId else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                try await app.directory.saveProfile(name: name, bio: bio, pronouns: pronouns,
                                                                    customStatus: customStatus, api: api, user: user)
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    } label: { if saving { ProgressView() } else { Text("Salvar").bold() } }
                        .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                  || name.unicodeScalars.count > 24 || name.unicodeScalars.count < 3
                                  || bio.unicodeScalars.count > 320 || pronouns.unicodeScalars.count > 40
                                  || customStatus.unicodeScalars.count > 80)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .task {
            name = app.directory.me?.displayName ?? ""
            bio = app.directory.me?.bio ?? ""
            pronouns = app.directory.me?.pronouns ?? ""
            customStatus = app.directory.me?.customStatus ?? ""
        }
    }
}
