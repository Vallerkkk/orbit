using System.Diagnostics;
using System.Net.NetworkInformation;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Orbita.Native;

internal sealed class MainForm : Form
{
    static readonly Color Background = Color.FromArgb(0x10, 0x10, 0x1b);
#if DEBUG
    static readonly bool DevTools = true;
#else
    static readonly bool DevTools = false;
#endif

    // Atalhos nativos tratados pela janela. Só enviam um nome fixo; nenhuma API é exposta à página.
    const string KeyBridge = """
        addEventListener('keydown', e => {
          if (e.repeat) return;
          const k = e.key === 'F11' ? 'fullscreen' : e.key === 'F5' ? 'reload' : null;
          if (k) { e.preventDefault(); window.chrome.webview.postMessage('orbita:' + k); }
        }, true);
        """;

    const string InCallScript = "(() => { const d = document.getElementById('call-dock'); return !!d && !d.hidden; })()";

    readonly Task<CoreWebView2Environment> environment;
    readonly Settings settings = Settings.Load();
    readonly WebView2 web;
    readonly NotifyIcon tray;
    readonly ToolStripMenuItem trayCloseToTray, trayUpdate;
    readonly System.Windows.Forms.Timer offlineTimer = new() { Interval = 8000 };
    readonly System.Windows.Forms.Timer updateTimer = new() { Interval = 20_000 };
    CoreWebView2? core;
    bool quitting, dialogOpen, booted, offline, fullscreen, trayHintShown;
    FormWindowState stateBeforeFullscreen;
    UpdateChecker.Release? pendingUpdate;

    public MainForm(Task<CoreWebView2Environment> environment)
    {
        this.environment = environment;
        Text = "Órbita";
        Icon = LoadIcon();
        BackColor = Background;
        MinimumSize = new Size(800, 600);
        StartPosition = FormStartPosition.Manual;
        ApplySavedBounds();

        web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background, ZoomFactor = Math.Clamp(settings.Zoom, 0.5, 3) };
        Controls.Add(web);

        trayCloseToTray = new ToolStripMenuItem("Fechar janela para a bandeja") { CheckOnClick = true, Checked = settings.CloseToTray == true };
        trayCloseToTray.CheckedChanged += (_, _) => { settings.CloseToTray = trayCloseToTray.Checked ? true : null; settings.Save(); };
        trayUpdate = new ToolStripMenuItem("Verificar atualizações", null, (_, _) => OnUpdateMenu());
        var menu = new ContextMenuStrip();
        menu.Items.AddRange([
            new ToolStripMenuItem("Abrir Órbita", null, (_, _) => ShowMain()) { Font = new Font(menu.Font, FontStyle.Bold) },
            new ToolStripMenuItem("Recarregar", null, (_, _) => Reload()),
            new ToolStripSeparator(),
            trayCloseToTray,
            new ToolStripMenuItem("Redefinir permissões de câmera, microfone e notificações", null, async (_, _) => await ResetPermissionsAsync()),
            trayUpdate,
            new ToolStripSeparator(),
            new ToolStripMenuItem("Encerrar aplicativo", null, (_, _) => Quit()),
        ]);
        tray = new NotifyIcon { Icon = Icon, Text = "Órbita", ContextMenuStrip = menu, Visible = true };
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowMain(); };
        tray.BalloonTipClicked += (_, _) => { if (pendingUpdate is not null) OpenInBrowser(pendingUpdate.Url); else ShowMain(); };

        offlineTimer.Tick += async (_, _) => await TryReconnectAsync();
        NetworkChange.NetworkAvailabilityChanged += (_, e) => { if (e.IsAvailable) BeginInvoke(async () => await TryReconnectAsync()); };
        updateTimer.Tick += async (_, _) => { updateTimer.Interval = 6 * 60 * 60 * 1000; await CheckUpdatesAsync(false); };
    }

    static Icon LoadIcon()
    {
        using var stream = typeof(MainForm).Assembly.GetManifestResourceStream("icon.ico");
        return stream is null ? SystemIcons.Application : new Icon(stream);
    }

    void ApplySavedBounds()
    {
        var bounds = new Rectangle(settings.X, settings.Y, Math.Max(800, settings.Width), Math.Max(600, settings.Height));
        var visible = settings.X != int.MinValue && Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(bounds));
        if (!visible)
        {
            var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1366, 768);
            bounds.Width = Math.Min(bounds.Width, area.Width);
            bounds.Height = Math.Min(bounds.Height, area.Height);
            bounds.X = area.X + (area.Width - bounds.Width) / 2;
            bounds.Y = area.Y + (area.Height - bounds.Height) / 2;
        }
        Bounds = bounds;
        if (settings.Maximized) WindowState = FormWindowState.Maximized;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        NativeMethods.ApplyDarkTitleBar(Handle, 0x1b1010); // COLORREF é BGR
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await web.EnsureCoreWebView2Async(await environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var download = new TaskDialogButton("Baixar o WebView2");
            var page = new TaskDialogPage
            {
                Caption = "Órbita", Icon = TaskDialogIcon.Error,
                Heading = "O Microsoft Edge WebView2 Runtime não está instalado.",
                Text = "Ele já vem no Windows 11 e na maioria dos Windows 10. Instale o Runtime e abra a Órbita novamente.",
                Buttons = { download, TaskDialogButton.Close },
            };
            if (TaskDialog.ShowDialog(this, page) == download) OpenInBrowser("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Quit();
            return;
        }
        catch (Exception ex)
        {
            TaskDialog.ShowDialog(this, new TaskDialogPage { Caption = "Órbita", Icon = TaskDialogIcon.Error, Heading = "Não foi possível iniciar o aplicativo.", Text = ex.Message });
            Quit();
            return;
        }
        ConfigureWebView(web.CoreWebView2);
        updateTimer.Start();
    }

    void ConfigureWebView(CoreWebView2 c)
    {
        core = c;
        var s = c.Settings;
        s.AreDevToolsEnabled = DevTools;
        s.AreBrowserAcceleratorKeysEnabled = DevTools;
        s.IsStatusBarEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsZoomControlEnabled = true;
        s.IsBuiltInErrorPageEnabled = false;
        s.UserAgent += $" OrbitaNative/{UpdateChecker.Current}";

        c.NavigationStarting += OnNavigationStarting;
        c.NavigationCompleted += OnNavigationCompleted;
        c.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        c.PermissionRequested += OnPermissionRequested;
        c.ScreenCaptureStarting += (_, e) => { if (!AppPolicy.IsAppUrl(c.Source) || e.OriginalSourceFrameInfo is not null) e.Cancel = true; };
        c.ProcessFailed += OnProcessFailed;
        c.DocumentTitleChanged += (_, _) => UpdateTitle(c.DocumentTitle);
        c.ContainsFullScreenElementChanged += (_, _) => SetFullscreen(c.ContainsFullScreenElement);
        c.WebMessageReceived += OnWebMessage;
        c.ContextMenuRequested += (_, e) =>
        {
            if (DevTools) return;
            for (var i = e.MenuItems.Count - 1; i >= 0; i--)
                if (e.MenuItems[i].Name is "inspectElement" or "print" or "saveAs" or "webCapture" or "share") e.MenuItems.RemoveAt(i);
        };
        web.ZoomFactorChanged += (_, _) => { settings.Zoom = web.ZoomFactor; };

        _ = c.AddScriptToExecuteOnDocumentCreatedAsync(KeyBridge);
        c.NavigateToString(Pages.Loading);
    }

    void UpdateTitle(string title)
    {
        Text = string.IsNullOrWhiteSpace(title) || !AppPolicy.IsAppUrl(core?.Source) ? "Órbita" : title;
        tray.Text = Text.Length > 127 ? Text[..127] : Text;
    }

    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (AppPolicy.IsAppUrl(e.Uri) || AppPolicy.IsInternal(e.Uri)) return;
        e.Cancel = true;
        if (!e.IsRedirected) OpenExternal(e.Uri);
    }

    void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (core is null) return;
        if (!booted)
        {
            // A tela "Conectando…" fica visível até a primeira página real ser pintada.
            booted = true;
            core.Navigate(AppPolicy.AppUrl);
            return;
        }
        if (e.IsSuccess)
        {
            if (AppPolicy.IsAppUrl(core.Source)) { offline = false; offlineTimer.Stop(); }
            return;
        }
        if (e.WebErrorStatus is CoreWebView2WebErrorStatus.OperationCanceled or CoreWebView2WebErrorStatus.ValidAuthenticationCredentialsRequired) return;
        ShowOffline();
    }

    void ShowOffline()
    {
        if (core is null) return;
        offline = true;
        core.NavigateToString(Pages.Offline);
        offlineTimer.Start();
    }

    async Task TryReconnectAsync()
    {
        if (!offline || core is null || !NetworkInterface.GetIsNetworkAvailable()) return;
        if (!await UpdateChecker.CanReachAppAsync() || !offline) return;
        offline = false;
        offlineTimer.Stop();
        core.Navigate(AppPolicy.AppUrl);
    }

    void Reload()
    {
        if (core is null) return;
        if (offline || !AppPolicy.IsAppUrl(core.Source)) core.Navigate(AppPolicy.AppUrl);
        else core.Reload();
    }

    void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!AppPolicy.IsAppUrl(e.Source) && !AppPolicy.IsInternal(e.Source)) return;
        string? message;
        try { message = e.TryGetWebMessageAsString(); } catch { return; }
        if (message == "orbita:fullscreen") SetFullscreen(!fullscreen);
        else if (message == "orbita:reload") Reload();
    }

    async void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        var deferral = e.GetDeferral();
        try
        {
            e.State = CoreWebView2PermissionState.Deny;
            e.SavesInProfile = false;
            if (!AppPolicy.IsAppUrl(e.Uri) || core is null || !AppPolicy.IsAppUrl(core.Source)) return;
            var label = e.PermissionKind switch
            {
                CoreWebView2PermissionKind.Microphone => "usar o microfone",
                CoreWebView2PermissionKind.Camera => "usar a câmera",
                CoreWebView2PermissionKind.Notifications => "mostrar notificações",
                _ => null,
            };
            if (e.PermissionKind == CoreWebView2PermissionKind.Autoplay) { e.State = CoreWebView2PermissionState.Allow; return; }
            if (label is null || dialogOpen) return;
            await Task.Yield(); // sai do evento do WebView2 antes de abrir o diálogo modal
            var allow = new TaskDialogButton("Permitir");
            var choice = Ask(new TaskDialogPage
            {
                Caption = "Permissão da Órbita", Icon = TaskDialogIcon.Information,
                Heading = $"Permitir que a Órbita possa {label}?",
                Text = "A escolha fica salva neste computador. Para desfazer, use o ícone da Órbita na bandeja → Redefinir permissões.",
                Buttons = { new TaskDialogButton("Não permitir"), allow },
                DefaultButton = allow,
            });
            if (choice == allow && AppPolicy.IsAppUrl(core.Source))
            {
                e.State = CoreWebView2PermissionState.Allow;
                e.SavesInProfile = true;
            }
        }
        catch { e.State = CoreWebView2PermissionState.Deny; }
        finally { deferral.Complete(); }
    }

    async Task ResetPermissionsAsync()
    {
        if (core is null) return;
        var origin = new Uri(AppPolicy.AppUrl).GetLeftPart(UriPartial.Authority);
        foreach (var kind in new[] { CoreWebView2PermissionKind.Microphone, CoreWebView2PermissionKind.Camera, CoreWebView2PermissionKind.Notifications })
            try { await core.Profile.SetPermissionStateAsync(kind, origin, CoreWebView2PermissionState.Default); } catch { }
        tray.ShowBalloonTip(3000, "Órbita", "As permissões serão solicitadas novamente quando necessário.", ToolTipIcon.Info);
    }

    void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            // O processo do navegador saiu: reabre o aplicativo limpo em vez de deixar a janela vazia.
            try { Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--restarted") { UseShellExecute = false }); } catch { }
            Quit();
        }
        else if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            Reload();
        }
    }

    void OpenExternal(string? value)
    {
        var uri = AppPolicy.SafeHttps(value);
        if (uri is null || dialogOpen) return;
        if (AppPolicy.IsAppUrl(uri.AbsoluteUri)) { OpenInBrowser(uri.AbsoluteUri); return; }
        BeginInvoke(() =>
        {
            var open = new TaskDialogButton("Abrir no navegador");
            var choice = Ask(new TaskDialogPage
            {
                Caption = "Abrir link externo", Icon = TaskDialogIcon.None,
                Heading = "Abrir este endereço no navegador?", Text = uri.AbsoluteUri,
                Buttons = { TaskDialogButton.Cancel, open }, DefaultButton = TaskDialogButton.Cancel,
            });
            if (choice == open) OpenInBrowser(uri.AbsoluteUri);
        });
    }

    static void OpenInBrowser(string url)
    {
        if (AppPolicy.SafeHttps(url) is null) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    TaskDialogButton? Ask(TaskDialogPage page)
    {
        if (dialogOpen) return null;
        dialogOpen = true;
        try
        {
            if (!Visible) ShowMain();
            return TaskDialog.ShowDialog(this, page, TaskDialogStartupLocation.CenterOwner);
        }
        finally { dialogOpen = false; }
    }

    // ---------- Janela, tela cheia e bandeja ----------

    void SetFullscreen(bool on)
    {
        if (on == fullscreen) return;
        fullscreen = on;
        SuspendLayout();
        if (on)
        {
            stateBeforeFullscreen = WindowState;
            FormBorderStyle = FormBorderStyle.None;
            if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal; // força cobrir a barra de tarefas
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = stateBeforeFullscreen;
        }
        ResumeLayout();
    }

    public void ShowMain()
    {
        if (IsDisposed) return;
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = settings.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        Activate();
        NativeMethods.SetForegroundWindow(Handle);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (core is null) return;
        if (WindowState == FormWindowState.Minimized) _ = EnterBackgroundAsync();
        else LeaveBackground();
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (core is null) return;
        if (Visible) LeaveBackground(); else _ = EnterBackgroundAsync();
    }

    /// <summary>Minimizado ou na bandeja: para de pintar e, fora de chamada, pede ao WebView2 para liberar memória.</summary>
    async Task EnterBackgroundAsync()
    {
        if (core is null) return;
        if (WindowState == FormWindowState.Minimized) web.Visible = false; // o WebView2 para de compor quadros
        if (!await InCallAsync()) core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
        GC.Collect(GC.MaxGeneration, GCCollectionMode.Optimized, false);
        NativeMethods.TrimWorkingSet();
    }

    void LeaveBackground()
    {
        if (core is null) return;
        core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
        web.Visible = true;
    }

    async Task<bool> InCallAsync()
    {
        if (core is null || !AppPolicy.IsAppUrl(core.Source)) return false;
        try { return await core.ExecuteScriptAsync(InCallScript) == "true"; } catch { return true; }
    }

    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        if (quitting || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing or CloseReason.ApplicationExitCall)
        {
            SaveWindowState();
            base.OnFormClosing(e);
            return;
        }
        e.Cancel = true;
        if (dialogOpen) return;
        if (settings.CloseToTray == true) { HideToTray(); return; }
        if (settings.CloseToTray == false && !await InCallAsync()) { Quit(); return; }

        var trayButton = new TaskDialogButton("Continuar na bandeja");
        var quitButton = new TaskDialogButton("Encerrar aplicativo");
        var page = new TaskDialogPage
        {
            Caption = "Fechar Órbita", Icon = TaskDialogIcon.None,
            Heading = "Continuar na bandeja do Windows?",
            Text = "As chamadas continuam na bandeja. Para sair e encerrar as chamadas, escolha Encerrar aplicativo.",
            Buttons = { trayButton, quitButton, TaskDialogButton.Cancel }, DefaultButton = trayButton,
            Verification = new TaskDialogVerificationCheckBox("Lembrar minha escolha"),
        };
        var choice = Ask(page);
        if (choice == trayButton || choice == quitButton)
        {
            if (page.Verification.Checked) { settings.CloseToTray = choice == trayButton; trayCloseToTray.Checked = choice == trayButton; settings.Save(); }
            if (choice == trayButton) HideToTray(); else Quit();
        }
    }

    void HideToTray()
    {
        if (fullscreen) SetFullscreen(false);
        SaveWindowState();
        Hide();
        if (!trayHintShown)
        {
            trayHintShown = true;
            tray.ShowBalloonTip(3000, "Órbita continua aberta", "Clique no ícone da bandeja para voltar.", ToolTipIcon.None);
        }
    }

    void Quit()
    {
        quitting = true;
        SaveWindowState();
        tray.Visible = false;
        Application.Exit();
    }

    void SaveWindowState()
    {
        if (fullscreen || WindowState == FormWindowState.Minimized || !Visible) { settings.Save(); return; }
        var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        (settings.X, settings.Y, settings.Width, settings.Height) = (b.X, b.Y, b.Width, b.Height);
        settings.Maximized = WindowState == FormWindowState.Maximized;
        settings.Save();
    }

    // ---------- Atualizações ----------

    async Task CheckUpdatesAsync(bool manual)
    {
        var release = await UpdateChecker.CheckAsync();
        if (IsDisposed) return;
        if (release is null)
        {
            if (manual) tray.ShowBalloonTip(3000, "Órbita", $"Você está na versão mais recente ({UpdateChecker.Current}).", ToolTipIcon.Info);
            return;
        }
        var isNew = pendingUpdate?.Version != release.Version;
        pendingUpdate = release;
        trayUpdate.Text = $"Baixar Órbita {release.Version}";
        if (isNew || manual) tray.ShowBalloonTip(5000, "Nova versão da Órbita", $"A versão {release.Version} está disponível. Clique para baixar.", ToolTipIcon.Info);
    }

    async void OnUpdateMenu()
    {
        if (pendingUpdate is not null) OpenInBrowser(pendingUpdate.Url);
        else await CheckUpdatesAsync(true);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            offlineTimer.Dispose();
            updateTimer.Dispose();
            tray.Dispose();
            web.Dispose();
        }
        base.Dispose(disposing);
    }
}
