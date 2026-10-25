namespace Orbita.Desktop.Services;

internal static class DesktopPolicy
{
    public static bool IsAppUri(Uri? uri)
    {
        if (uri is null) return false;

        if (uri.Scheme == Uri.UriSchemeHttps
            && (SameOrigin(uri, AppInfo.AppUrl) || SameOrigin(uri, AppInfo.StartUri)))
        {
            return true;
        }

        return AppInfo.StartUri.Scheme == Uri.UriSchemeHttp
               && uri.Scheme == Uri.UriSchemeHttp
               && uri.IsLoopback
               && SameOrigin(uri, AppInfo.StartUri);
    }

    public static bool IsAppUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && IsAppUri(uri);

    public static bool IsSafeExternal(Uri? uri) =>
        uri is not null
        && uri.Scheme == Uri.UriSchemeHttps
        && !string.IsNullOrEmpty(uri.Host)
        && string.IsNullOrEmpty(uri.UserInfo);

    public static Uri? TryParse(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) ? uri : null;

    private static bool SameOrigin(Uri left, Uri right) =>
        left.Scheme == right.Scheme
        && string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase)
        && left.Port == right.Port;
}
