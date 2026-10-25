import XCTest
@testable import Orbita

final class OrbitLogicTests: XCTestCase {
    private let destination = ChatDestination(id: UUID(), title: "geral", subtitle: "",
                                              isDirect: false, isVoice: false)

    func testChannelInsertExcludesServerAndLocalColumns() throws {
        let payload = MessageInsert(destination: destination, author: UUID(), content: "Olá")
        let data = try Wire.encoder().encode(payload)
        let row = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(row.keys), ["channel_id", "author_id", "content"])
        XCTAssertNil(row["id"])
        XCTAssertNil(row["created_at"])
        XCTAssertNil(row["conversation_id"])
    }

    func testDirectInsertUsesOnlyConversationScope() throws {
        let direct = ChatDestination(id: UUID(), title: "Lia", subtitle: "", isDirect: true, isVoice: false)
        let payload = MessageInsert(destination: direct, author: UUID(), content: "Oi", reply: UUID())
        let row = try XCTUnwrap(JSONSerialization.jsonObject(with: Wire.encoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(Set(row.keys), ["conversation_id", "author_id", "content", "reply_to"])
        XCTAssertNil(row["channel_id"])
    }

    func testWhitespaceCannotBeSent() {
        XCTAssertFalse(MessageRules.canSend(" \n\t "))
        XCTAssertTrue(MessageRules.canSend("  Oi! \n"))
        XCTAssertEqual(MessageRules.normalized("  Oi! \n"), "Oi!")
    }

    func testPostgresUnicodeLimitNotUTF16OrGraphemes() {
        XCTAssertTrue(MessageRules.canSend(String(repeating: "🚀", count: 4000)))
        XCTAssertFalse(MessageRules.canSend(String(repeating: "🚀", count: 4001)))
        // This emoji is one grapheme but multiple Unicode scalar values.
        XCTAssertFalse(MessageRules.canSend(String(repeating: "👩🏽‍💻", count: 1200)))
    }

    func testInvisiblePresenceAndSnakeCaseDecode() throws {
        let data = Data("""
        {"id":"10000000-0000-4000-8000-000000000001","display_name":"Lia","username":"lia",
         "presence_status":"invisible","avatar_url":"","avatar_color":"#B78CFF"}
        """.utf8)
        let profile = try Wire.decoder().decode(Profile.self, from: data)
        XCTAssertEqual(profile.displayName, "Lia")
        XCTAssertEqual(profile.presenceStatus, "invisible")
        XCTAssertEqual(profile.statusLabel, "Invisível")
    }

    func testNestedFeedAuthorMayContainOnlyPublicFields() throws {
        let data = Data("""
        {"id":"50000000-0000-4000-8000-000000000001","author_id":"10000000-0000-4000-8000-000000000001",
        "content":"Teste","created_at":"2026-10-24T00:00:00.123456+00:00","media":[],
        "likes":2,"replies":1,"liked":false,"saved":true,
        "author":{"id":"10000000-0000-4000-8000-000000000001","display_name":"Lia",
        "username":"lia","avatar_url":"","avatar_color":"#B78CFF"}}
        """.utf8)
        let post = try Wire.decoder().decode(FeedPost.self, from: data)
        XCTAssertEqual(post.author?.displayName, "Lia")
        XCTAssertTrue(post.saved)
        XCTAssertEqual(post.authorId, post.author?.id)
    }

    func testFractionalAndWholeServerTimestamps() {
        XCTAssertNotNil(ServerTime.date("2026-10-24T00:01:02.123456+00:00"))
        XCTAssertNotNil(ServerTime.date("2026-10-24T00:01:02Z"))
        XCTAssertNil(ServerTime.date("not-a-date"))
    }

    func testCursorKeepsAllMicrosecondsAndUUIDTieBreak() {
        let id = UUID(uuidString: "20000000-0000-4000-8000-000000000002")!
        let raw = "2026-10-24T00:01:02.123456+00:00"
        let cursor = PageCursor(timestamp: raw, id: id)
        XCTAssertTrue(cursor.filter.contains(raw))
        XCTAssertTrue(cursor.filter.contains("id.lt.\(id.uuidString.lowercased())"))
    }

    func testRealtimeAndHTTPReconcileWithoutDuplicateMessages() {
        let row = Demo.messages[0]
        let result = MessageRules.merged([row], [row, Demo.messages[1]])
        XCTAssertEqual(result.count, 2)
        XCTAssertEqual(result.map(\.id), [row.id, Demo.messages[1].id])
    }

    func testUUIDTieBreakAtIdenticalTimestamp() {
        let first = Demo.messages[0]
        let second = Message(id: Demo.messages[1].id, authorId: first.authorId,
                             content: "Mesma data", createdAt: first.createdAt,
                             replyTo: nil, attachmentId: nil, attachments: nil)
        XCTAssertEqual(MessageRules.merged([second], [first]).map(\.id), [first.id, second.id])
    }

    func testDifferentMicrosecondsSortBeforeUUIDTieBreak() {
        XCTAssertLessThan(ServerTime.orderKey("2026-10-24T00:01:02.000001+00:00"),
                          ServerTime.orderKey("2026-10-24T00:01:02.000002Z"))
        XCTAssertEqual(ServerTime.orderKey("2026-10-24T00:01:02.5Z"),
                       ServerTime.orderKey("2026-10-24T00:01:02.500000+00:00"))
    }

    func testCanonicalConversationPairMatchesPostgresUUIDOrder() {
        let high = UUID(uuidString: "FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF")!
        let low = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
        XCTAssertEqual(MessageRules.canonicalPair(high, low).0, low)
        XCTAssertEqual(MessageRules.canonicalPair(low, high).1, high)
    }

    @MainActor func testPrivateStoragePathIncludesStoragePrefix() throws {
        let url = try APIClient.resolveStorageURL("/object/sign/orbita-files/profiles/avatar.png?token=sample",
                                                  base: URL(string: "https://example.supabase.co")!)
        XCTAssertEqual(url.path, "/storage/v1/object/sign/orbita-files/profiles/avatar.png")
        XCTAssertEqual(url.query, "token=sample")
    }

    @MainActor func testPrivateStorageRejectsForeignOrInsecureOrigins() {
        let base = URL(string: "https://example.supabase.co")!
        XCTAssertThrowsError(try APIClient.resolveStorageURL("https://evil.example/object", base: base))
        XCTAssertThrowsError(try APIClient.resolveStorageURL("http://example.supabase.co/storage/v1/object/sign/x", base: base))
        XCTAssertThrowsError(try APIClient.resolveStorageURL("../admin", base: base))
    }
}
