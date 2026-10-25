namespace Orbita.Desktop.Services;

internal static class AppPaths
{
    public static string Root { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OrbitaNative");

    public static string WebView2Data { get; } = Path.Combine(Root, "WebView2");
    public static string SettingsFile { get; } = Path.Combine(Root, "settings.json");
    public static string LogFile { get; } = Path.Combine(Root, "logs", "app.log");

    public static void EnsureCreated()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
    }
}
