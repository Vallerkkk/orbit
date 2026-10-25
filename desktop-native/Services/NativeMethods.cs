using System.Runtime.InteropServices;

namespace Orbita.Desktop.Services;

internal static class NativeMethods
{
    private const int DwmwaUseImmersiveDarkMode = 20;
    private const int DwmwaWindowCornerPreference = 33;
    private const int DwmwaBorderColor = 34;
    private const int DwmwaCaptionColor = 35;
    private const int DwmwaTextColor = 36;
    private const int DwmwcpRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID(string appId);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    public static void ApplyAppUserModelId()
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID(AppInfo.AppUserModelId);
        }
        catch
        {
            // Not fatal: only affects taskbar grouping and notifications.
        }
    }

    public static void ApplyDarkChrome(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;

        var enabled = 1;
        DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkMode, ref enabled, sizeof(int));

        var rounded = DwmwcpRound;
        DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref rounded, sizeof(int));

        var caption = ColorRef(0x0B, 0x0C, 0x0F);
        var text = ColorRef(0xF2, 0xF3, 0xF5);
        var border = ColorRef(0x1C, 0x1F, 0x27);
        DwmSetWindowAttribute(hwnd, DwmwaCaptionColor, ref caption, sizeof(int));
        DwmSetWindowAttribute(hwnd, DwmwaTextColor, ref text, sizeof(int));
        DwmSetWindowAttribute(hwnd, DwmwaBorderColor, ref border, sizeof(int));
    }

    public static bool BringToForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        return SetForegroundWindow(hwnd);
    }

    public static void AllowAnyForegroundWindow() => AllowSetForegroundWindow(-1);

    private static int ColorRef(byte red, byte green, byte blue) =>
        red | (green << 8) | (blue << 16);
}
