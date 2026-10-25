import SwiftUI
import QuickLook

struct AttachmentPreview: View {
    let attachment: Attachment
    @Environment(AppSession.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var error: String?
    @State private var temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    var body: some View {
        NavigationStack {
            Group {
                if let file { QuickLookFile(url: file) }
                else if let error { ErrorNotice(text: error).padding(20) }
                else { ProgressView("Abrindo arquivo…") }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity).background(Orbit.background)
            .navigationTitle(attachment.name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Fechar") { dismiss() } }
                if let file {
                    ToolbarItem(placement: .primaryAction) { ShareLink(item: file).accessibilityLabel("Compartilhar arquivo") }
                }
            }
        }
        .task {
            var keep = false
            defer { if !keep { try? FileManager.default.removeItem(at: temp) } }
            do {
                guard let path = attachment.path, attachment.size <= 26_214_400 else {
                    throw AppFailure.message("Este arquivo não está disponível para pré-visualização.")
                }
                let url = try await app.media.url(path: path)
                let network = URLSession(configuration: .ephemeral)
                let (download, response) = try await network.download(from: url)
                guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
                    throw AppFailure.message("Não foi possível baixar o arquivo.")
                }
                try Task.checkCancellation()
                try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
                let basename = (attachment.name as NSString).lastPathComponent
                let destination = temp.appendingPathComponent(basename.isEmpty || basename == "." || basename == ".." ? "arquivo" : basename)
                try FileManager.default.moveItem(at: download, to: destination)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
                try Task.checkCancellation()
                file = destination
                keep = true
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
        }
        .onDisappear { try? FileManager.default.removeItem(at: temp) }
    }
}

private struct QuickLookFile: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
