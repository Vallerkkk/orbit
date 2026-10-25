using System.Globalization;
using System.Text;

namespace Orbita.Desktop.Services;

internal static class AppLog
{
    private const long MaxBytes = 1_000_000;
    private static readonly object Gate = new();

    public static void Install()
    {
        try
        {
            AppPaths.EnsureCreated();
            var file = new FileInfo(AppPaths.LogFile);
            if (file.Exists && file.Length > MaxBytes)
            {
                var previous = AppPaths.LogFile + ".old";
                File.Delete(previous);
                File.Move(AppPaths.LogFile, previous);
            }
        }
        catch
        {
            // Logging must never prevent the app from starting.
        }
    }

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                var line = string.Create(CultureInfo.InvariantCulture,
                    $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} {message}{Environment.NewLine}");
                File.AppendAllText(AppPaths.LogFile, line, Encoding.UTF8);
            }
        }
        catch
        {
            // Ignore disk/permission failures.
        }
    }

    public static void Error(string area, Exception exception)
    {
        Write($"ERRO {area}: {exception.GetType().Name}: {exception.Message}{Environment.NewLine}{exception}");
    }
}
