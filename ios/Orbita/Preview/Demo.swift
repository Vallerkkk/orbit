import SwiftUI

// Fictitious, deterministic fixtures. No account credentials or production data.
enum Demo {
    static let me = person("10000000-0000-4000-8000-000000000001", "Você", "seuusuario", "E07AD6",
                           "Um lugar para boas conversas e novas ideias.")
    static let lia = person("10000000-0000-4000-8000-000000000002", "Lia Costa", "lia", "B78CFF",
                            "Design, música e um pouco de tudo.")
    static let rafa = person("10000000-0000-4000-8000-000000000003", "Rafa Lima", "rafa", "63CDBE", "")
    static let people = [me, lia, rafa]
    static let communities = [
        Community(id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!, name: "Órbita",
                  description: "Voz, vídeo e sua comunidade. Um espaço para estar perto.", isDefault: true),
        Community(id: UUID(uuidString: "00000000-0000-4000-8000-000000000002")!, name: "Estúdio criativo",
                  description: "Ideias que encontram companhia.", isDefault: false)
    ]
    static let channels: [Channel] = [
        channel("20000000-0000-4000-8000-000000000001", "geral", "text", "O começo de boas conversas.", 0),
        channel("20000000-0000-4000-8000-000000000002", "projetos", "text", "Mostre o que você está criando.", 1),
        channel("20000000-0000-4000-8000-000000000003", "aleatório", "text", "Um pouco de tudo que conecta.", 2),
        channel("20000000-0000-4000-8000-000000000004", "Sala de estar", "voice", "Chegue para conversar.", 3),
        channel("20000000-0000-4000-8000-000000000005", "Foco & trabalho", "voice", "Companhia para fazer acontecer.", 4)
    ]
    static let conversations = [
        Conversation(id: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
                     userA: me.id, userB: lia.id, createdAt: "2026-10-24T01:10:00.000001Z"),
        Conversation(id: UUID(uuidString: "30000000-0000-4000-8000-000000000002")!,
                     userA: me.id, userB: rafa.id, createdAt: "2026-10-24T00:20:00.000001Z")
    ]
    static let messages: [Message] = [
        message(1, author: lia.id, text: "Boa noite, pessoal! Como estão os projetos de vocês?", time: "01:02:00"),
        message(2, author: rafa.id, text: "Acabei de terminar uma ilustração. Vou compartilhar em #projetos ✨", time: "01:03:00"),
        message(3, author: me.id, text: "Quero ver! Estou montando uma playlist para nossa sala de estar.", time: "01:04:00"),
        message(4, author: lia.id, text: "Uma boa conversa com a trilha certa. Já gostei 💜", time: "01:05:00"),
        message(5, author: rafa.id, text: "Mais tarde a gente se encontra na voz?", time: "01:06:00"),
        message(6, author: me.id, text: "Combinado. Até daqui a pouco!", time: "01:07:00")
    ]
    static let posts: [FeedPost] = [
        FeedPost(id: UUID(uuidString: "50000000-0000-4000-8000-000000000001")!, authorId: lia.id,
                 content: "Às vezes a melhor ideia aparece no meio de uma conversa sem pressa.\n\nQue bom ter um lugar para isso. ✨",
                 createdAt: "2026-10-24T01:02:00.000001Z", media: [], author: lia,
                 likes: 18, replies: 0, liked: false, saved: false, quote: nil),
        FeedPost(id: UUID(uuidString: "50000000-0000-4000-8000-000000000002")!, authorId: rafa.id,
                 content: "Pequenos projetos também merecem ser compartilhados.\nQual foi a coisa mais legal que você criou nesta semana?",
                 createdAt: "2026-10-24T00:25:00.000001Z", media: [], author: rafa,
                 likes: 9, replies: 0, liked: true, saved: true, quote: nil)
    ]
    private static func person(_ id: String, _ name: String, _ handle: String, _ color: String, _ bio: String) -> Profile {
        Profile(id: UUID(uuidString: id)!, displayName: name, username: handle, bio: bio,
                avatarColor: "#\(color)", avatarUrl: "", presenceStatus: "online", customStatus: "")
    }
    private static func channel(_ id: String, _ name: String, _ kind: String, _ description: String, _ position: Int) -> Channel {
        Channel(id: UUID(uuidString: id)!, communityId: communities[0].id, name: name, kind: kind,
                description: description, position: position)
    }
    private static func message(_ number: Int, author: UUID, text: String, time: String) -> Message {
        Message(id: UUID(uuidString: String(format: "40000000-0000-4000-8000-%012d", number))!,
                authorId: author, content: text, createdAt: "2026-10-24T\(time).000001Z",
                replyTo: nil, attachmentId: nil, attachments: nil)
    }
}

@MainActor private struct DemoPreview: View {
    @State private var session: AppSession
    init() {
        let value = AppSession()
        value.startDemo()
        _session = State(initialValue: value)
    }
    var body: some View {
        MainTabs().environment(session).tint(Orbit.pink)
    }
}

#Preview("Órbita · escuro") { DemoPreview().preferredColorScheme(.dark) }
#Preview("Órbita · claro") { DemoPreview().preferredColorScheme(.light) }
#Preview("Texto acessível") {
    DemoPreview().preferredColorScheme(.dark).environment(\.dynamicTypeSize, .accessibility3)
}
