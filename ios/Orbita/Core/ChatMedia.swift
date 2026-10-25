import Foundation

/// GIFs e figurinhas no chat, no mesmo formato do site (static/chat-media.js).
/// A mensagem guarda só um marcador em texto: [gif:título](url) ou [figurinha](url).
/// Assim não é preciso coluna nova e as regras atuais do banco continuam valendo.
enum ChatMedia {
    struct Parsed: Equatable {
        let isGif: Bool
        let title: String
        let url: URL
    }

    private static let pattern = try! NSRegularExpression(
        pattern: #"^\[(gif|figurinha)(?::([^\]\n]{0,120}))?\]\((https://[^\s)]+)\)$"#)

    static func parse(_ content: String) -> Parsed? {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let whole = NSRange(text.startIndex..., in: text)
        guard let match = pattern.firstMatch(in: text, range: whole),
              let kindRange = Range(match.range(at: 1), in: text),
              let urlRange = Range(match.range(at: 3), in: text),
              let url = URL(string: String(text[urlRange])),
              isGiphyHost(url) else { return nil }
        let title = Range(match.range(at: 2), in: text).map { String(text[$0]) } ?? ""
        return Parsed(isGif: text[kindRange] == "gif", title: title, url: url)
    }

    /// Mesma regra do site: só os hosts de mídia do GIPHY.
    static func isGiphyHost(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host else { return false }
        return host.range(of: #"^(media\d*|i)\.giphy\.com$"#, options: .regularExpression) != nil
    }

    /// Marcador que vai para o banco. Título sem os caracteres que quebrariam o marcador.
    static func token(isGif: Bool, title: String, url: URL) -> String {
        let clean = String(title.filter { !"]\n()".contains($0) }
            .trimmingCharacters(in: .whitespaces)
            .prefix(80))
        let label = isGif ? "gif" : "figurinha"
        return clean.isEmpty ? "[\(label)](\(url.absoluteString))" : "[\(label):\(clean)](\(url.absoluteString))"
    }
}
