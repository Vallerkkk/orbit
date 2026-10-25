import Foundation
import Supabase

struct BackendConfig: Decodable {
    let supabaseUrl: URL
    let supabaseKey: String
    let configured: Bool
    let videochamadaConfigured: Bool?
}

// All data requests use the signed-in user's JWT. The server's RLS remains the
// source of truth; no service_role key, secret, password or JWT is shipped here.
@MainActor
final class APIClient {
    static let origin = URL(string: "https://orbita-8nwu.onrender.com")!
    let supabase: SupabaseClient
    let config: BackendConfig
    private let network: URLSession
    private var cachedSession: Session?

    init(config: BackendConfig, session: URLSession = URLSession(configuration: .ephemeral)) {
        self.config = config
        network = session
        supabase = SupabaseClient(supabaseURL: config.supabaseUrl, supabaseKey: config.supabaseKey,
                                  options: .init(global: .init(session: session),
                                                 // Sessão salva expirada não é entregue como válida (comportamento do próximo SDK).
                                                 auth: .init(emitLocalSessionAsInitialSession: true)))
    }

    static func bootstrap(session: URLSession = URLSession(configuration: .ephemeral)) async throws -> APIClient {
        var request = URLRequest(url: origin.appendingPathComponent("api/config"))
        request.timeoutInterval = 40
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        try check(response)
        let config = try JSONDecoder().decode(BackendConfig.self, from: data)
        guard config.configured, config.supabaseUrl.scheme == "https",
              config.supabaseUrl.host != nil, !config.supabaseKey.isEmpty else {
            throw AppFailure.message("O backend ainda não está configurado.")
        }
        return APIClient(config: config, session: session)
    }

    func read<T: Decodable>(_ table: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await request(path: "rest/v1/\(table)", query: query)
        return try Wire.decoder().decode(T.self, from: data)
    }

    func write<T: Encodable, R: Decodable>(_ table: String, body: T,
                                          method: String = "POST",
                                          query: [URLQueryItem] = []) async throws -> R {
        let data = try await request(path: "rest/v1/\(table)", method: method, query: query,
                                     body: Wire.encoder().encode(body), representation: true)
        return try Wire.decoder().decode(R.self, from: data)
    }

    func mutate<T: Encodable>(_ table: String, body: T, method: String = "POST",
                              query: [URLQueryItem] = []) async throws {
        _ = try await request(path: "rest/v1/\(table)", method: method, query: query,
                              body: Wire.encoder().encode(body))
    }

    func delete(_ table: String, query: [URLQueryItem]) async throws {
        _ = try await request(path: "rest/v1/\(table)", method: "DELETE", query: query)
    }

    /// Keeps the session returned by sign-in available while the Auth client
    /// finishes persisting/restoring its local state. This avoids a transient
    /// `Auth session missing` during the first directory load after login.
    func cache(session: Session) {
        cachedSession = session
    }

    /// Returns the managed session, falling back to the last authenticated
    /// session during the short window in which the Auth store is restoring it.
    func currentSession() async throws -> Session {
        do {
            let session = try await supabase.auth.session
            cachedSession = session
            return session
        } catch {
            guard let cachedSession else { throw error }
            return cachedSession
        }
    }

    /// Uploads a user-selected file to the private Orbita bucket using the
    /// current Supabase session. The publishable key is never replaced by a
    /// service key and Storage policies remain the authority for access.
    func uploadFile(data: Data, path: String, mimeType: String) async throws {
        try await upload(data: data, path: path, mimeType: mimeType, bucket: "orbita-files")
    }

    func upload(data: Data, path: String, mimeType: String, bucket: String) async throws {
        guard !path.contains(".."), !path.hasPrefix("/"), !path.contains("://") else {
            throw AppFailure.message("Nome de arquivo inválido.")
        }
        let session = try await currentSession()
        guard ["orbita-files", "orbita-feed"].contains(bucket) else {
            throw AppFailure.message("Armazenamento inválido.")
        }
        let url = config.supabaseUrl.appendingPathComponent("storage/v1/object/\(bucket)/\(path)")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.timeoutInterval = 60
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(config.supabaseKey, forHTTPHeaderField: "apikey")
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue("true", forHTTPHeaderField: "x-upsert")
        let (_, response) = try await network.data(for: request)
        try Self.check(response)
    }

    func createAttachment(owner: UUID, scope: ChatDestination, name: String,
                          mimeType: String, size: Int64, path: String) async throws -> Attachment {
        struct Payload: Encodable {
            let ownerId: UUID
            let channelId: UUID?
            let conversationId: UUID?
            let name: String
            let mimeType: String
            let size: Int64
            let storagePath: String
        }
        let payload = Payload(ownerId: owner, channelId: scope.isDirect ? nil : scope.id,
                              conversationId: scope.isDirect ? scope.id : nil, name: name,
                              mimeType: mimeType, size: size, storagePath: path)
        let rows: [Attachment] = try await write("attachments", body: payload)
        guard let row = rows.first else { throw AppFailure.message("O arquivo não foi registrado.") }
        return row
    }

    func rpc<T: Encodable, R: Decodable>(_ function: String, body: T) async throws -> R {
        let data = try await request(path: "rest/v1/rpc/\(function)", method: "POST",
                                     body: Wire.encoder().encode(body))
        return try Wire.decoder().decode(R.self, from: data)
    }

    func join(_ target: ChatDestination) async throws -> JoinTicket {
        let data = try await request(path: "api/\(target.storageScope)/\(target.id)/join",
                                     method: "POST", origin: Self.origin)
        // This API intentionally uses camelCase, unlike the PostgREST schema.
        return try JSONDecoder().decode(JoinTicket.self, from: data)
    }

    /// Busca de GIFs e figurinhas pelo mesmo endpoint do site. Sem texto, mostra os em alta.
    func mediaSearch(kind: String, query: String) async throws -> MediaSearchReply {
        var items = [URLQueryItem(name: "type", value: kind)]
        let path: String
        if query.isEmpty {
            path = "api/media/trending"
        } else {
            path = "api/media/search"
            items.append(.init(name: "q", value: String(query.prefix(50))))
        }
        let data = try await request(path: path, query: items, origin: Self.origin)
        return try JSONDecoder().decode(MediaSearchReply.self, from: data)
    }

    func registerIOSPushToken(_ token: String) async throws {
        struct Body: Encodable { let deviceToken: String }
        try await mutateAPI("api/ios/push/subscribe", body: Body(deviceToken: token), method: "POST")
    }

    func unregisterIOSPushToken(_ token: String) async throws {
        struct Body: Encodable { let deviceToken: String }
        try await mutateAPI("api/ios/push/subscribe", body: Body(deviceToken: token), method: "DELETE")
    }

    // Signed URLs are scoped by the existing private bucket policies.
    func signedMediaURL(path: String, bucket: String = "orbita-files") async throws -> URL {
        struct Body: Encodable { let expiresIn = 1800 }
        struct Reply: Decodable { let signedURL: String }
        guard ["orbita-files", "orbita-feed"].contains(bucket) else {
            throw AppFailure.message("Armazenamento inválido.")
        }
        let data = try await request(path: "storage/v1/object/sign/\(bucket)/\(path)",
                                     method: "POST", body: JSONEncoder().encode(Body()))
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        return try Self.resolveStorageURL(reply.signedURL, base: config.supabaseUrl)
    }

    static func resolveStorageURL(_ signedPath: String, base: URL) throws -> URL {
        let root = base.appendingPathComponent("storage/v1", isDirectory: true)
        // Storage returns "/object/sign/…", relative to /storage/v1, not the host root.
        let reference = signedPath.hasPrefix("/") ? String(signedPath.dropFirst()) : signedPath
        guard let url = URL(string: reference, relativeTo: root)?.absoluteURL,
              url.scheme == "https", url.host == base.host,
              url.path.hasPrefix("/storage/v1/object/sign/") else {
            throw AppFailure.message("O armazenamento retornou um endereço inválido.")
        }
        return url
    }

    private func request(path: String, method: String = "GET", query: [URLQueryItem] = [],
                         body: Data? = nil, representation: Bool = false,
                         origin: URL? = nil) async throws -> Data {
        let session: Session
        do {
            session = try await currentSession()
        } catch {
            guard let cachedSession else { throw error }
            session = cachedSession
        }
        try Task.checkCancellation()
        let base = origin ?? config.supabaseUrl
        var parts = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query }
        // URLComponents otherwise leaves "+" literal; form-query decoders can
        // turn a timestamp's timezone into a space.
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = parts.url else { throw AppFailure.message("Endereço inválido.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        if origin == nil { request.setValue(config.supabaseKey, forHTTPHeaderField: "apikey") }
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if representation { request.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        let (data, response) = try await network.data(for: request)
        try Self.check(response)
        try Task.checkCancellation()
        return data
    }

    private func mutateAPI<T: Encodable>(_ path: String, body: T, method: String) async throws {
        _ = try await request(path: path, method: method, body: Wire.encoder().encode(body), origin: Self.origin)
    }

    private static func check(_ response: URLResponse) throws {
        guard let response = response as? HTTPURLResponse else { throw AppFailure.http(0) }
        guard (200..<300).contains(response.statusCode) else { throw AppFailure.http(response.statusCode) }
    }
}

extension URLQueryItem {
    static func eq(_ name: String, _ value: UUID) -> Self {
        .init(name: name, value: "eq.\(value.uuidString.lowercased())")
    }

    static func eq(_ name: String, _ value: String) -> Self {
        .init(name: name, value: "eq.\(value)")
    }
}
