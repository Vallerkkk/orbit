namespace Orbita.Desktop.Services;

internal static class AppInfo
{
    public const string Version = "2.0.0";
    public const string AppUserModelId = "Orbita.Desktop.Native";
    public const string WindowTitle = "Órbita";

    public static readonly Uri AppUrl = new("https://orbita-8nwu.onrender.com/");
    public static readonly Uri ReleasesUrl = new("https://github.com/Vallerkkk/orbit/releases");
    public const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    public static Uri StartUri { get; } = ResolveStartUri();
    public static bool DevMode { get; } = ResolveDevMode();
    public static int DebugPort { get; } = ResolveDebugPort();

    private static Uri ResolveStartUri()
    {
        var raw = Environment.GetEnvironmentVariable("ORBITA_DESKTOP_URL");
        if (!string.IsNullOrWhiteSpace(raw)
            && Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri)
            && uri.IsLoopback
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
        {
            return uri;
        }

        return AppUrl;
    }

    private static bool ResolveDevMode()
    {
        if (ResolveDebugPort() > 0) return true;
        return string.Equals(Environment.GetEnvironmentVariable("ORBITA_DESKTOP_DEVTOOLS"), "1", StringComparison.Ordinal);
    }

    private static int ResolveDebugPort()
    {
        var raw = Environment.GetEnvironmentVariable("ORBITA_DESKTOP_DEBUG_PORT");
        return int.TryParse(raw, out var port) && port is >= 1024 and <= 65535 ? port : 0;
    }
}
