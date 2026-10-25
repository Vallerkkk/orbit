namespace Orbita.Native;

/// <summary>Mesmas regras de navegação do desktop Electron (desktop/policy.cjs).</summary>
public static class AppPolicy
{
    public const string AppUrl = "https://orbita-8nwu.onrender.com/";
    static readonly Uri AppUri = new(AppUrl);

    /// <summary>Aceita somente HTTPS sem credenciais, sem porta não padrão e sem caracteres de controle.</summary>
    public static Uri? SafeHttps(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 4096) return null;
        foreach (var c in value) if (c <= ' ' || c == '\\') return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0 || uri.Port != 443) return null;
        return uri;
    }

    public static bool IsAppUrl(string? value)
    {
        var uri = SafeHttps(value);
        return uri is not null && string.Equals(uri.Host, AppUri.Host, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Páginas internas (carregando/offline) são carregadas por NavigateToString.</summary>
    public static bool IsInternal(string? value) =>
        value is "about:blank" || (value?.StartsWith("data:text/html", StringComparison.Ordinal) ?? false);
}
