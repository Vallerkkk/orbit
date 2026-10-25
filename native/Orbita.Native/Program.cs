using Microsoft.Web.WebView2.Core;

namespace Orbita.Native;

internal static class Program
{
    const string MutexName = @"Local\Orbita.Native.Instance";
    internal const string ShowEventName = @"Local\Orbita.Native.Show";

    [STAThread]
    static int Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first && args.Contains("--restarted"))
        {
            // Reinício após falha do motor web: espera a instância anterior terminar.
            try { first = mutex.WaitOne(TimeSpan.FromSeconds(10)); }
            catch (AbandonedMutexException) { first = true; }
        }
        if (!first)
        {
            try { using var show = EventWaitHandle.OpenExisting(ShowEventName); show.Set(); } catch { }
            return 0;
        }

        ApplicationConfiguration.Initialize();
#pragma warning disable WFO5001
        Application.SetColorMode(SystemColorMode.Dark);
#pragma warning restore WFO5001

        // O ambiente do WebView2 (processo do navegador) começa a subir enquanto a janela é criada.
        var environment = CreateEnvironmentAsync();
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var form = new MainForm(environment);
        var waiter = ThreadPool.RegisterWaitForSingleObject(showEvent, (_, _) =>
        {
            try { form.BeginInvoke(form.ShowMain); } catch { }
        }, null, Timeout.Infinite, false);

        Application.Run(form);
        waiter.Unregister(null);
        return 0;
    }

    static Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        var options = new CoreWebView2EnvironmentOptions
        {
            Language = "pt-BR",
            // Chamadas e presença continuam em tempo real com a janela na bandeja (igual ao desktop Electron).
            AdditionalBrowserArguments = string.Join(' ',
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--autoplay-policy=no-user-gesture-required"),
        };
        var dataFolder = Path.Combine(Settings.Folder, "WebView2");
        return CoreWebView2Environment.CreateAsync(null, dataFolder, options);
    }
}
