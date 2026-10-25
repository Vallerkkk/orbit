import Foundation

// Wire models deliberately keep server timestamps as strings. A Date round-trip
// loses Postgres microseconds and can skip rows at a pagination boundary.
struct Profile: Codable, Identifiable, Hashable {
    let id: UUID
    var displayName: String
    var username: String?
    var bio: String?
    var avatarColor: String?
    var avatarUrl: String?
    var bannerUrl: String? = nil
    var pronouns: String? = nil
    var presenceStatus: String?
    var customStatus: String?
    var presenceActivity: String? = nil

    var initials: String {
        let words = displayName.split(separator: " ")
        return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
    // A preference in the profile is NOT proof of a live connection.
    var statusLabel: String {
        switch presenceStatus {
        case "idle": return "Ausente"
        case "dnd": return "Não perturbe"
        case "invisible": return "Invisível"
        default: return "Disponível"
        }
    }
}

struct Community: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let description: String
    let isDefault: Bool
}

struct Channel: Codable, Identifiable, Hashable {
    let id: UUID
    let communityId: UUID
    let name: String
    let kind: String
    let description: String
    let position: Int
    var isVoice: Bool { kind == "voice" }
    var destination: ChatDestination {
        .init(id: id, title: name, subtitle: description, isDirect: false, isVoice: isVoice)
    }
}

struct Conversation: Codable, Identifiable, Hashable {
    let id: UUID
    let userA: UUID
    let userB: UUID
    let createdAt: String
    func peerId(for current: UUID) -> UUID { userA == current ? userB : userA }
}

struct Friendship: Decodable, Identifiable {
    let id: UUID
    let requesterId: UUID
    let recipientId: UUID
    var status: String
    func peerId(for current: UUID) -> UUID { requesterId == current ? recipientId : requesterId }
}

struct ChatDestination: Identifiable, Hashable {
    let id: UUID
    let title: String
    let subtitle: String
    let isDirect: Bool
    let isVoice: Bool
    var table: String { isDirect ? "direct_messages" : "messages" }
    var scopeKey: String { isDirect ? "conversation_id" : "channel_id" }
    var storageScope: String { isDirect ? "conversations" : "channels" }
    var draftKey: String { "\(table):\(id.uuidString.lowercased())" }
}

struct Attachment: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let mimeType: String
    let size: Int64
    let storagePath: String?
    let fileId: String?
    var path: String? { storagePath ?? fileId }
    var isImage: Bool { mimeType.hasPrefix("image/") }
    var sizeLabel: String { ByteCountFormatter.string(fromByteCount: size, countStyle: .file) }
}

struct Message: Codable, Identifiable, Hashable {
    let id: UUID
    let authorId: UUID
    let content: String
    let createdAt: String
    let replyTo: UUID?
    let attachmentId: UUID?
    let attachments: Attachment?
    var editedAt: String? = nil
    var pinned: Bool = false
    var reactions: [MessageReaction]? = nil
    var poll: MessagePoll? = nil
    var pollVotes: [PollVote]? = nil
    var date: Date { ServerTime.date(createdAt) ?? .distantPast }
}

struct MessageReaction: Codable, Hashable, Identifiable {
    let id: UUID
    let emoji: String
    let userId: UUID
}

struct MessagePoll: Codable, Hashable {
    let question: String
    let options: [String]
}

struct PollVote: Codable, Hashable, Identifiable {
    let id: UUID
    let userId: UUID
    let optionIndex: Int
}

// These payloads encode ONLY columns granted by the supplied migrations.
// Never send a Message record (id/created_at) back as an INSERT.
struct MessageInsert: Encodable {
    let channelId: UUID?
    let conversationId: UUID?
    let authorId: UUID
    let content: String
    let attachmentId: UUID?
    let replyTo: UUID?
    let poll: MessagePoll?
    init(destination: ChatDestination, author: UUID, content: String,
         attachment: UUID? = nil, reply: UUID? = nil, poll: MessagePoll? = nil) {
        channelId = destination.isDirect ? nil : destination.id
        conversationId = destination.isDirect ? destination.id : nil
        authorId = author
        self.content = content
        attachmentId = attachment
        replyTo = reply
        self.poll = poll
    }
}

struct FeedPost: Codable, Identifiable {
    let id: UUID
    let authorId: UUID
    let content: String
    let createdAt: String
    let media: [String]?
    let author: Profile?
    var likes: Int
    let replies: Int
    var liked: Bool
    var saved: Bool
    let quote: FeedQuote?
    var date: Date { ServerTime.date(createdAt) ?? .distantPast }
}

struct FeedQuote: Codable {
    let id: UUID
    let content: String
    let author: String
}

struct FeedQuery: Encodable {
    let scope: String
    var beforeAt: String?
    var beforeId: UUID?
    var searchText: String = ""
}

struct PageCursor: Equatable {
    let timestamp: String
    let id: UUID
    // PostgREST receives the untouched timestamp and a deterministic UUID tie-break.
    var filter: String {
        "(created_at.lt.\(timestamp),and(created_at.eq.\(timestamp),id.lt.\(id.uuidString.lowercased())))"
    }
}

enum Wire {
    static func decoder() -> JSONDecoder {
        let result = JSONDecoder()
        result.keyDecodingStrategy = .convertFromSnakeCase
        return result
    }
    static func encoder() -> JSONEncoder {
        let result = JSONEncoder()
        result.keyEncodingStrategy = .convertToSnakeCase
        return result
    }
}

enum ServerTime {
    // Formatter creation inside every SwiftUI row is expensive during scrolling.
    // Access is serialized because formatters are shared across background decodes.
    private static let lock = NSLock()
    private static let fractional: ISO8601DateFormatter = {
        let value = ISO8601DateFormatter()
        value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return value
    }()
    private static let whole = ISO8601DateFormatter()
    static func date(_ value: String) -> Date? {
        lock.lock()
        defer { lock.unlock() }
        if let date = fractional.date(from: value) { return date }
        return whole.date(from: value)
    }
    static func orderKey(_ value: String) -> Int64 {
        lock.lock()
        defer { lock.unlock() }
        var seconds = value
        var microseconds: Int64 = 0
        if let dot = value.firstIndex(of: ".") {
            let suffix = value[value.index(after: dot)...]
            let digits = suffix.prefix(while: \.isNumber)
            let padded = String((String(digits) + "000000").prefix(6))
            microseconds = Int64(padded) ?? 0
            seconds = String(value[..<dot]) + String(suffix.dropFirst(digits.count))
        }
        guard let date = whole.date(from: seconds) else { return Int64.min }
        return Int64(date.timeIntervalSince1970.rounded()) * 1_000_000 + microseconds
    }
}

enum MessageRules {
    static func normalized(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    // PostgreSQL char_length counts Unicode scalars, not UTF-16 code units or graphemes.
    static func canSend(_ text: String) -> Bool {
        let count = normalized(text).unicodeScalars.count
        return (1...4000).contains(count)
    }
    static func canonicalPair(_ first: UUID, _ second: UUID) -> (UUID, UUID) {
        first.uuidString < second.uuidString ? (first, second) : (second, first)
    }
    static func merged(_ current: [Message], _ incoming: [Message]) -> [Message] {
        var byId = Dictionary(current.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        for row in incoming { byId[row.id] = row }
        let times = byId.mapValues { ServerTime.orderKey($0.createdAt) }
        return byId.values.sorted {
            let first = times[$0.id]!, second = times[$1.id]!
            if first == second { return $0.id.uuidString < $1.id.uuidString }
            return first < second
        }
    }
}

enum AppFailure: LocalizedError {
    case message(String)
    case expired
    case http(Int)
    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        case .expired: return "Sua sessão expirou. Entre novamente."
        case .http(401): return "Sua sessão não foi aceita. Entre novamente."
        case .http(403): return "Você não tem permissão para esta ação."
        case .http(429): return "Muitas tentativas. Aguarde um pouco antes de tentar novamente."
        case .http: return "O serviço não respondeu como esperado. Tente novamente."
        }
    }
}
