import SwiftUI
import UIKit
import Observation
import ImageIO

@MainActor @Observable
final class MediaStore {
    @ObservationIgnored var api: APIClient?
    @ObservationIgnored private let cache = NSCache<NSString, UIImage>()
    @ObservationIgnored private var pending: [String: Task<UIImage?, Never>] = [:]
    @ObservationIgnored private var urls: [String: (URL, Date)] = [:]
    @ObservationIgnored private let network = URLSession(configuration: .ephemeral)
    @ObservationIgnored private var generation = UUID()

    init() {
        cache.totalCostLimit = 48 * 1024 * 1024
        cache.countLimit = 160
    }

    func image(path: String, pixels: Int, bucket: String = "orbita-files") async -> UIImage? {
        guard !path.isEmpty, let api else { return nil }
        let key = "\(bucket):\(path):\(pixels)"
        if let cached = cache.object(forKey: key as NSString) { return cached }
        if let task = pending[key] { return await task.value }
        let stamp = generation
        let task = Task<UIImage?, Never> {
            do {
                let url = try await signedURL(path: path, api: api, bucket: bucket)
                let (data, response) = try await network.data(from: url)
                guard let response = response as? HTTPURLResponse,
                      response.statusCode == 200, data.count <= 26_214_400 else { return nil }
                try Task.checkCancellation()
                let image = await Task.detached(priority: .utility) { () -> UIImage? in
                    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
                    let options: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceThumbnailMaxPixelSize: pixels,
                        kCGImageSourceShouldCacheImmediately: true
                    ]
                    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
                    return UIImage(cgImage: cg)
                }.value
                guard !Task.isCancelled, generation == stamp, let image else { return nil }
                cache.setObject(image, forKey: key as NSString,
                                cost: Int(image.size.width * image.size.height * 4))
                return image
            } catch { return nil }
        }
        pending[key] = task
        let result = await task.value
        if generation == stamp { pending[key] = nil }
        return result
    }

    func url(path: String, bucket: String = "orbita-files") async throws -> URL {
        guard let api else { throw AppFailure.message("Entre para acessar o arquivo.") }
        return try await signedURL(path: path, api: api, bucket: bucket)
    }

    private func signedURL(path: String, api: APIClient, bucket: String) async throws -> URL {
        let cacheKey = "\(bucket):\(path)"
        if let (url, expiry) = urls[cacheKey], expiry > Date() { return url }
        // Do not blindly open externally supplied http/file/javascript URLs.
        guard !path.contains("://"), !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else {
            throw AppFailure.message("Referência de mídia inválida.")
        }
        let stamp = generation
        let url = try await api.signedMediaURL(path: path, bucket: bucket)
        guard generation == stamp else { throw CancellationError() }
        if urls.count >= 200 { urls.removeAll(keepingCapacity: true) }
        urls[cacheKey] = (url, Date().addingTimeInterval(1500))
        return url
    }

    func clear() {
        generation = UUID()
        pending.values.forEach { $0.cancel() }
        pending.removeAll()
        urls.removeAll()
        cache.removeAllObjects()
    }
}

struct Avatar: View {
    let profile: Profile?
    var size: CGFloat = 44
    @Environment(AppSession.self) private var app
    @State private var bitmap: UIImage?
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.36, style: .continuous)
                .fill(Color(hex: profile?.avatarColor ?? "B78CFF").opacity(0.24))
            if let bitmap {
                Image(uiImage: bitmap).resizable().scaledToFill()
            } else {
                Text(profile?.initials ?? "Ó").font(.system(size: size * 0.34, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hex: profile?.avatarColor ?? "B78CFF"))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.36, style: .continuous))
        .accessibilityHidden(true)
        .task(id: profile?.avatarUrl) {
            bitmap = nil
            guard let path = profile?.avatarUrl, !path.isEmpty else { return }
            bitmap = await app.media.image(path: path, pixels: Int(size * 3))
        }
    }
}

struct PrivateImage: View {
    let path: String
    let label: String
    var bucket = "orbita-files"
    @Environment(AppSession.self) private var app
    @State private var bitmap: UIImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let bitmap {
                Image(uiImage: bitmap).resizable().scaledToFit()
            } else if failed {
                Label("Não foi possível carregar a imagem", systemImage: "photo")
                    .font(.caption).padding(20).frame(maxWidth: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 130)
            }
        }
        .background(Orbit.raised)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityLabel(label)
        .task(id: path) {
            bitmap = nil
            failed = false
            bitmap = await app.media.image(path: path, pixels: 1000, bucket: bucket)
            failed = bitmap == nil
        }
    }
}
