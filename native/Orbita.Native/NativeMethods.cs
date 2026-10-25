using System.Runtime.InteropServices;

namespace Orbita.Native;

internal static partial class NativeMethods
{
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
    const int DWMWA_CAPTION_COLOR = 35;

    [LibraryImport("dwmapi.dll")]
    private static partial int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    /// <summary>Barra de título escura combinando com a interface (Windows 10 20H1+ / 11).</summary>
    public static void ApplyDarkTitleBar(IntPtr hwnd, int bgr)
    {
        int on = 1;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref bgr, sizeof(int));
        int none = 1; // DWMSBT_NONE: sem Mica, o conteúdo cobre a janela toda
        DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref none, sizeof(int));
    }

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetForegroundWindow(IntPtr hwnd);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetProcessWorkingSetSize(IntPtr process, nint min, nint max);

    /// <summary>Devolve ao Windows páginas de memória ociosas do processo host (não afeta o WebView2).</summary>
    public static void TrimWorkingSet()
    {
        try { SetProcessWorkingSetSize(System.Diagnostics.Process.GetCurrentProcess().Handle, -1, -1); } catch { }
    }
}
