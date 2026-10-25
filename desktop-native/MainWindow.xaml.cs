using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Orbita.Desktop.Services;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace Orbita.Desktop;

public partial class MainWindow : Window
{
    private const string BridgeScript = """
        (() => {
          try {
            const api = Object.freeze({
              isDesktop: true,
              nativeChrome: true,
              platform: 'windows',
              version: '2.0.0'
            });
            Object.defineProperty(window, 'orbitaDesktop', {
              value: api,
              configurable: false,
              writable: false
            });
          } catch (error) {
            console.warn('Órbita desktop:', error);
          }
        })();
        """;

    private const string PermissionMicrophone = "microphone";
    private const string PermissionCamera = "camera";
    private const string PermissionNotifications = "notifications";

    private readonly AppSettings _settings;
    private readonly Queue<PendingPermissionRequest> _pendingPermissions = new();

    private CoreWebView2Environment? _environment;
    private Forms.NotifyIcon? _tray;
    private Forms.ContextMenuStrip? _trayMenu;
    private Drawing.Icon? _trayIcon;
    private DispatcherTimer? _slowLoadingTimer;

    private Action? _statusPrimary;
    private Action? _statusSecondary;

    private bool _initializing;
    private bool _browserReady;
    private bool _revealPending;
    private bool _exiting;
    private bool _resourcesDisposed;
    private bool _loadingAnimationRunning;
    private bool _permissionPromptActive;
    private bool _externalPromptOpen;
    private bool _closePromptOpen;
    private bool _trayHintShown;
    private bool _htmlFullscreen;

    private WindowState _stateBeforeFullscreen;
    private WindowStyle _styleBeforeFullscreen;
    private ResizeMode _resizeBeforeFullscreen;

    public MainWindow()
    {
        InitializeComponent();

        _settings = AppSettings.Load();
        RestoreGeometry();
        Browser.DefaultBackgroundColor = Drawing.Color.FromArgb(11, 12, 15);

        Loaded += OnLoaded;
        Closing += OnClosing;
        Closed += OnClosed;
        StateChanged += OnWindowStateChanged;

        InitializeTray();
    }

    public void PrepareForExit()
    {
        if (_exiting) return;
        _exiting = true;

        SaveGeometry();
        _settings.Save();
        DisposeResources();
    }

    public void PrepareForSystemShutdown()
    {
        PrepareForExit();
    }

    public void ActivateFromSecondInstance()
    {
        if (_exiting) return;

        ShowFromTray();
        Topmost = true;
        Topmost = false;
        NativeMethods.BringToForeground(new WindowInteropHelper(this).Handle);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        NativeMethods.ApplyDarkChrome(new WindowInteropHelper(this).Handle);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        StartLoadingAnimation();
        await InitializeBrowserAsync();
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        DisposeResources();
    }

    // ---------------------------------------------------------------- janela

    private void RestoreGeometry()
    {
        var width = _settings.WindowWidth is > 0
            ? Math.Max(MinWidth, _settings.WindowWidth.Value)
            : Width;
        var height = _settings.WindowHeight is > 0
            ? Math.Max(MinHeight, _settings.WindowHeight.Value)
            : Height;

        width = Math.Min(width, SystemParameters.VirtualScreenWidth);
        height = Math.Min(height, SystemParameters.VirtualScreenHeight);

        if (_settings.WindowLeft is { } left
            && _settings.WindowTop is { } top
            && IsUsablePosition(left, top, width, height))
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = left;
            Top = top;
            Width = width;
            Height = height;
        }
        else
        {
            Width = width;
            Height = height;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }

        if (_settings.Maximized)
            WindowState = WindowState.Maximized;
    }

    private static bool IsUsablePosition(double left, double top, double width, double height)
    {
        var window = new Rect(left, top, width, height);
        var virtualScreen = new Rect(
            SystemParameters.VirtualScreenLeft,
            SystemParameters.VirtualScreenTop,
            SystemParameters.VirtualScreenWidth,
            SystemParameters.VirtualScreenHeight);
        var visible = Rect.Intersect(window, virtualScreen);
        return !visible.IsEmpty && visible.Width >= 140 && visible.Height >= 90;
    }

    private void SaveGeometry()
    {
        try
        {
            var bounds = WindowState == WindowState.Normal
                ? new Rect(Left, Top, Width, Height)
                : RestoreBounds;

            if (bounds.Width > 0 && bounds.Height > 0 && !bounds.IsEmpty)
            {
                _settings.WindowLeft = bounds.Left;
                _settings.WindowTop = bounds.Top;
                _settings.WindowWidth = bounds.Width;
                _settings.WindowHeight = bounds.Height;
            }

            _settings.Maximized = WindowState == WindowState.Maximized;
        }
        catch (Exception exception)
        {
            AppLog.Error("Salvar posição da janela", exception);
        }
    }

    private void OnWindowStateChanged(object? sender, EventArgs e)
    {
        if (WindowState == WindowState.Minimized)
            SetMemoryTarget(low: true);
        else if (IsVisible)
            SetMemoryTarget(low: false);
    }

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_exiting)
        {
            SaveGeometry();
            return;
        }

        e.Cancel = true;

        if (_closePromptOpen) return;

        if (_settings.CloseBehavior == "tray")
        {
            HideToTray();
            return;
        }

        if (_settings.CloseBehavior == "exit")
        {
            Dispatcher.BeginInvoke(new Action(RequestExit));
            return;
        }

        _closePromptOpen = true;
        try
        {
            var choice = PromptDialog.Ask(this, new PromptOptions
            {
                Title = "Fechar o Órbita",
                Message = "Continuar na bandeja do Windows?",
                Detail = "As chamadas, o compartilhamento e as notificações continuam funcionando na bandeja. "
                         + "Para encerrar tudo, escolha Encerrar o aplicativo.",
                PrimaryText = "Continuar na bandeja",
                SecondaryText = "Encerrar o aplicativo",
                CancelText = "Cancelar",
                ShowRemember = true,
                RememberChecked = false
            }, out var remember);

            if (choice is PromptChoice.Cancel or PromptChoice.None)
                return;

            var behavior = choice == PromptChoice.Primary ? "tray" : "exit";
            if (remember)
            {
                _settings.CloseBehavior = behavior;
                _settings.Save();
            }

            if (choice == PromptChoice.Primary)
                HideToTray();
            else
                Dispatcher.BeginInvoke(new Action(RequestExit));
        }
        finally
        {
            _closePromptOpen = false;
        }
    }

    private void HideToTray()
    {
        if (_exiting) return;

        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;

        Hide();
        SetMemoryTarget(low: true);

        if (!_trayHintShown)
        {
            _trayHintShown = true;
            ShowBalloon("O Órbita continua na bandeja do Windows. Clique no ícone para abrir.");
        }
    }

    private void ShowFromTray()
    {
        if (_exiting) return;

        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;

        Activate();
        SetMemoryTarget(low: false);
        NativeMethods.BringToForeground(new WindowInteropHelper(this).Handle);
    }

    private void RequestExit()
    {
        PrepareForExit();
        Application.Current.Shutdown();
    }

    private void DisposeResources()
    {
        if (_resourcesDisposed) return;
        _resourcesDisposed = true;

        DisposeTray();
        StopLoadingAnimation();
        DrainPendingPermissions();

        try
        {
            Browser.Dispose();
        }
        catch (Exception exception)
        {
            AppLog.Error("Encerrar WebView2", exception);
        }
    }

    // ---------------------------------------------------------------- bandeja

    private void InitializeTray()
    {
        try
        {
            var executable = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(executable))
                _trayIcon = Drawing.Icon.ExtractAssociatedIcon(executable);

            _trayMenu = new Forms.ContextMenuStrip
            {
                ShowImageMargin = false,
                ShowCheckMargin = false,
                BackColor = Drawing.Color.FromArgb(20, 22, 27),
                ForeColor = Drawing.Color.FromArgb(242, 243, 245),
                Font = new Drawing.Font("Segoe UI", 9f),
                Renderer = new Forms.ToolStripProfessionalRenderer(new DarkMenuColors())
                {
                    RoundedEdges = false
                }
            };

            AddTrayItem("Abrir Órbita", ShowFromTray, bold: true);
            AddTrayItem("Recarregar", ReloadFromTray);
            _trayMenu.Items.Add(new Forms.ToolStripSeparator());
            AddTrayItem("Redefinir permissões", ResetPermissions);
            AddTrayItem("Abrir pasta de dados", OpenDataFolder);
            AddTrayItem("Ver atualizações no GitHub", () => OpenExternal(AppInfo.ReleasesUrl));
            _trayMenu.Items.Add(new Forms.ToolStripSeparator());
            AddTrayItem("Encerrar o Órbita", RequestExit);

            _tray = new Forms.NotifyIcon
            {
                Icon = _trayIcon,
                Text = "Órbita",
                Visible = true,
                ContextMenuStrip = _trayMenu
            };
            _tray.DoubleClick += (_, _) => Dispatcher.BeginInvoke(new Action(ShowFromTray));
            _tray.BalloonTipClicked += (_, _) => Dispatcher.BeginInvoke(new Action(ShowFromTray));
        }
        catch (Exception exception)
        {
            AppLog.Error("Criar bandeja", exception);
        }
    }

    private void AddTrayItem(string text, Action action, bool bold = false)
    {
        if (_trayMenu is null) return;

        var item = new Forms.ToolStripMenuItem(text)
        {
            ForeColor = Drawing.Color.FromArgb(242, 243, 245),
            Padding = new Forms.Padding(8, 4, 8, 4)
        };

        if (bold)
            item.Font = new Drawing.Font(item.Font, Drawing.FontStyle.Bold);

        item.Click += (_, _) => Dispatcher.BeginInvoke(action);
        _trayMenu.Items.Add(item);
    }

    private void DisposeTray()
    {
        try
        {
            if (_tray is not null)
            {
                _tray.Visible = false;
                _tray.Dispose();
                _tray = null;
            }

            _trayMenu?.Dispose();
            _trayMenu = null;
            _trayIcon?.Dispose();
            _trayIcon = null;
        }
        catch (Exception exception)
        {
            AppLog.Error("Encerrar bandeja", exception);
        }
    }

    private void ShowBalloon(string message, string title = "Órbita")
    {
        try
        {
            _tray?.ShowBalloonTip(5000, title, message, Forms.ToolTipIcon.Info);
        }
        catch (Exception exception)
        {
            AppLog.Error("Balão da bandeja", exception);
        }
    }

    private void ReloadFromTray()
    {
        ShowFromTray();
        var choice = PromptDialog.Ask(this, new PromptOptions
        {
            Title = "Recarregar o Órbita",
            Message = "Recarregar o aplicativo?",
            Detail = "Chamadas, compartilhamentos e mensagens não enviadas em andamento serão encerrados.",
            PrimaryText = "Recarregar"
        }, out _);

        if (choice == PromptChoice.Primary)
            ReloadBrowser();
    }

    private void ResetPermissions()
    {
        ShowFromTray();
        var choice = PromptDialog.Ask(this, new PromptOptions
        {
            Title = "Permissões do Órbita",
            Message = "Redefinir as permissões salvas?",
            Detail = "O aplicativo voltará a pedir acesso ao microfone, à câmera e às notificações quando forem usados. "
                     + "As permissões do Windows não são alteradas.",
            PrimaryText = "Redefinir"
        }, out _);

        if (choice != PromptChoice.Primary) return;

        _settings.ResetPermissions();
        ShowBalloon("Permissões redefinidas. O Órbita vai perguntar novamente quando precisar.");
    }

    private void OpenDataFolder()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            Process.Start(new ProcessStartInfo(AppPaths.Root) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            AppLog.Error("Abrir pasta de dados", exception);
        }
    }

    // ---------------------------------------------------------------- navegador

    private async Task InitializeBrowserAsync()
    {
        if (_initializing) return;
        _initializing = true;

        try
        {
            ShowSplash("Conectando à sua comunidade…");
            StartSlowHint();

            _environment ??= await CreateEnvironmentAsync();
            await Browser.EnsureCoreWebView2Async(_environment);

            var core = Browser.CoreWebView2
                       ?? throw new InvalidOperationException("O WebView2 não iniciou.");

            AttachBrowserEvents(core);

            _browserReady = true;
            _revealPending = true;

            await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript);
            core.Navigate(AppInfo.StartUri.AbsoluteUri);
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            AppLog.Error("WebView2 ausente", exception);
            ShowStatus(
                "O WebView2 não está instalado",
                "O Órbita usa o WebView2, componente gratuito da Microsoft que também acompanha o Microsoft Edge. "
                + "Instale o componente e tente novamente.",
                "Instalar o WebView2", OpenWebView2Download,
                "Tentar novamente", () => _ = InitializeBrowserAsync());
            StatusSiteButton.Visibility = Visibility.Visible;
        }
        catch (Exception exception)
        {
            AppLog.Error("Iniciar WebView2", exception);
            ShowStatus(
                "Não foi possível abrir o Órbita",
                "O componente interno não iniciou. Tente novamente; se o problema continuar, feche e abra o aplicativo.",
                "Tentar novamente", () => _ = InitializeBrowserAsync(),
                "Abrir pasta de dados", OpenDataFolder);
            StatusSiteButton.Visibility = Visibility.Visible;
        }
        finally
        {
            _initializing = false;
        }
    }

    private static async Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        Directory.CreateDirectory(AppPaths.WebView2Data);

        var options = new CoreWebView2EnvironmentOptions
        {
            Language = "pt-BR"
        };

        if (AppInfo.DebugPort > 0)
        {
            options.AdditionalBrowserArguments =
                $"--remote-debugging-port={AppInfo.DebugPort} --remote-allow-origins=*";
        }

        return await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: AppPaths.WebView2Data,
            options: options);
    }

    private void AttachBrowserEvents(CoreWebView2 core)
    {
        core.Settings.AreDevToolsEnabled = AppInfo.DevMode;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPinchZoomEnabled = false;
        // Evita que Ctrl+R/F5 recarregue e derrube uma chamada em andamento.
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;

        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.PermissionRequested += OnPermissionRequested;
        core.ScreenCaptureStarting += OnScreenCaptureStarting;
        core.DownloadStarting += OnDownloadStarting;
        core.ProcessFailed += OnProcessFailed;
        core.DOMContentLoaded += OnDomContentLoaded;
        core.NavigationCompleted += OnNavigationCompleted;
        core.ContainsFullScreenElementChanged += OnContainsFullScreenElementChanged;
        core.SourceChanged += OnSourceChanged;

        // NotificationReceived intentionally has no handler: WebView2 shows its own notification UI.
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var uri = DesktopPolicy.TryParse(e.Uri);
        if (DesktopPolicy.IsAppUri(uri)) return;

        e.Cancel = true;

        if (DesktopPolicy.IsSafeExternal(uri))
            ScheduleExternalPrompt(uri!);
        else
            AppLog.Write($"Navegação bloqueada: {e.Uri}");
    }

    private void OnSourceChanged(object? sender, CoreWebView2SourceChangedEventArgs e)
    {
        if (!e.IsNewDocument) return;

        var source = DesktopPolicy.TryParse(Browser.CoreWebView2?.Source);
        if (source is null) return;
        if (source.Scheme is "about" or "data" or "blob") return;
        if (DesktopPolicy.IsAppUri(source)) return;

        AppLog.Write($"Documento externo inesperado, voltando ao Órbita: {source}");
        Browser.CoreWebView2?.Navigate(AppInfo.StartUri.AbsoluteUri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;

        var uri = DesktopPolicy.TryParse(e.Uri);
        if (uri is null) return;

        if (DesktopPolicy.IsAppUri(uri))
        {
            Browser.CoreWebView2?.Navigate(uri.AbsoluteUri);
            return;
        }

        if (DesktopPolicy.IsSafeExternal(uri))
            ScheduleExternalPrompt(uri);
    }

    private void ScheduleExternalPrompt(Uri uri)
    {
        Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() => ConfirmOpenExternal(uri)));
    }

    private void ConfirmOpenExternal(Uri uri)
    {
        if (_externalPromptOpen) return;
        if (!DesktopPolicy.IsSafeExternal(uri)) return;

        if (!IsVisible || WindowState == WindowState.Minimized)
            ShowFromTray();

        _externalPromptOpen = true;
        try
        {
            var address = uri.GetLeftPart(UriPartial.Path);
            if (address.Length > 120)
                address = address[..117] + "…";

            var choice = PromptDialog.Ask(this, new PromptOptions
            {
                Title = "Abrir link externo",
                Message = "Abrir este link no navegador?",
                Detail = $"{uri.Host}\n{address}",
                PrimaryText = "Abrir no navegador"
            }, out _);

            if (choice == PromptChoice.Primary)
                OpenExternal(uri);
        }
        finally
        {
            _externalPromptOpen = false;
        }
    }

    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        try
        {
            e.SavesInProfile = false;

            if (e.PermissionKind == CoreWebView2PermissionKind.Autoplay)
            {
                AllowPermission(e);
                return;
            }

            var permission = PermissionKey(e.PermissionKind);
            var source = DesktopPolicy.TryParse(e.Uri)
                         ?? DesktopPolicy.TryParse(Browser.CoreWebView2?.Source);

            if (permission is null || !DesktopPolicy.IsAppUri(source) || _exiting)
            {
                DenyPermission(e);
                AppLog.Write($"Permissão negada: {e.PermissionKind} de {e.Uri}");
                return;
            }

            if (_settings.Allows(permission))
            {
                AllowPermission(e);
                return;
            }

            // Requests de microfone e câmera podem chegar juntos: enfileira com
            // deferral para mostrar um diálogo por vez sem negar o segundo.
            _pendingPermissions.Enqueue(new PendingPermissionRequest(e, permission, e.GetDeferral()));

            if (!_permissionPromptActive)
            {
                _permissionPromptActive = true;
                Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(ShowNextPermissionPrompt));
            }
        }
        catch (Exception exception)
        {
            AppLog.Error("Permissão", exception);
            DenyPermission(e);
        }
    }

    private void ShowNextPermissionPrompt()
    {
        if (_exiting)
        {
            DrainPendingPermissions();
            _permissionPromptActive = false;
            return;
        }

        while (_pendingPermissions.Count > 0)
        {
            var request = _pendingPermissions.Dequeue();
            try
            {
                if (_settings.Allows(request.Permission))
                {
                    AllowPermission(request.Arguments);
                    continue;
                }

                if (!IsVisible || WindowState == WindowState.Minimized)
                    ShowFromTray();

                var (message, detail) = PermissionText(request.Permission);
                var choice = PromptDialog.Ask(this, new PromptOptions
                {
                    Title = "Permissão do Órbita",
                    Message = message,
                    Detail = detail,
                    PrimaryText = "Permitir",
                    CancelText = "Não permitir"
                }, out _);

                var allowed = choice == PromptChoice.Primary;
                if (allowed)
                {
                    _settings.Allow(request.Permission);
                    AllowPermission(request.Arguments);
                }
                else
                {
                    DenyPermission(request.Arguments);
                }
            }
            catch (Exception exception)
            {
                AppLog.Error("Permissão", exception);
                DenyPermission(request.Arguments);
            }
            finally
            {
                request.Deferral.Complete();
            }
        }

        _permissionPromptActive = false;
    }

    private void DrainPendingPermissions()
    {
        while (_pendingPermissions.Count > 0)
        {
            var request = _pendingPermissions.Dequeue();
            try
            {
                DenyPermission(request.Arguments);
            }
            catch (Exception exception)
            {
                AppLog.Error("Permissão durante o encerramento", exception);
            }
            finally
            {
                request.Deferral.Complete();
            }
        }
    }

    private static void AllowPermission(CoreWebView2PermissionRequestedEventArgs e)
    {
        e.State = CoreWebView2PermissionState.Allow;
        e.Handled = true;
    }

    private static void DenyPermission(CoreWebView2PermissionRequestedEventArgs e)
    {
        e.State = CoreWebView2PermissionState.Deny;
        e.Handled = true;
    }

    private sealed record PendingPermissionRequest(
        CoreWebView2PermissionRequestedEventArgs Arguments,
        string Permission,
        CoreWebView2Deferral Deferral);


    private static string? PermissionKey(CoreWebView2PermissionKind kind) => kind switch
    {
        CoreWebView2PermissionKind.Microphone => PermissionMicrophone,
        CoreWebView2PermissionKind.Camera => PermissionCamera,
        CoreWebView2PermissionKind.Notifications => PermissionNotifications,
        _ => null
    };

    private static (string Message, string Detail) PermissionText(string permission) => permission switch
    {
        PermissionMicrophone => (
            "Permitir o microfone?",
            "O microfone é usado nas chamadas e no compartilhamento que você iniciar. "
            + "O Órbita não grava o áudio. Você pode redefinir esta escolha pela bandeja do Windows."),
        PermissionCamera => (
            "Permitir a câmera?",
            "A câmera só é ativada quando você liga o vídeo em uma chamada ou abre a prévia. "
            + "Você pode redefinir esta escolha pela bandeja do Windows."),
        _ => (
            "Mostrar notificações?",
            "O Órbita poderá avisar sobre novas mensagens e chamadas quando a janela estiver na bandeja. "
            + "O Windows também pode pedir permissão nas configurações de notificações.")
    };

    private void OnScreenCaptureStarting(object? sender, CoreWebView2ScreenCaptureStartingEventArgs e)
    {
        try
        {
            var source = e.OriginalSourceFrameInfo?.Source;
            if (DesktopPolicy.IsAppUrl(source))
                return; // Leaving the event unhandled shows the WebView2 screen picker.

            e.Cancel = true;
            e.Handled = true;
            AppLog.Write($"Captura de tela bloqueada para origem não confiável: {source}");
        }
        catch (Exception exception)
        {
            AppLog.Error("Captura de tela", exception);
            e.Cancel = true;
            e.Handled = true;
        }
    }

    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        try
        {
            var operation = e.DownloadOperation;
            operation.StateChanged += (_, _) =>
                Dispatcher.BeginInvoke(new Action(() => AnnounceDownload(operation)));
        }
        catch (Exception exception)
        {
            AppLog.Error("Iniciar download", exception);
        }
    }

    private void AnnounceDownload(CoreWebView2DownloadOperation operation)
    {
        try
        {
            switch (operation.State)
            {
                case CoreWebView2DownloadState.Completed:
                    ShowBalloon($"Download concluído: {Path.GetFileName(operation.ResultFilePath)}");
                    break;
                case CoreWebView2DownloadState.Interrupted:
                    ShowBalloon("Um download foi interrompido.");
                    break;
            }
        }
        catch (Exception exception)
        {
            AppLog.Error("Acompanhar download", exception);
        }
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        AppLog.Write($"Falha de processo do WebView2: {e.ProcessFailedKind}.");
        if (_exiting) return;

        var kind = e.ProcessFailedKind;
        if (kind is CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                ShowStatus(
                    "A página interna foi encerrada",
                    "O componente que mostra o Órbita foi fechado. Encerre o aplicativo e abra novamente para continuar.",
                    "Fechar o Órbita", RequestExit,
                    "Abrir no navegador", OpenInBrowser);
                StatusSiteButton.Visibility = Visibility.Visible;
            }));
            return;
        }

        if (kind is CoreWebView2ProcessFailedKind.RenderProcessExited
            or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                ShowStatus(
                    "A página parou de responder",
                    "O conteúdo do Órbita foi interrompido. Recarregue para continuar; chamadas em andamento serão encerradas.",
                    "Recarregar", ReloadBrowser,
                    "Abrir no navegador", OpenInBrowser);
                StatusSiteButton.Visibility = Visibility.Visible;
            }));
        }
    }

    private void OnDomContentLoaded(object? sender, CoreWebView2DOMContentLoadedEventArgs e)
    {
        if (!_revealPending) return;

        _revealPending = false;
        StopSlowHint();
        RevealBrowser();
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            if (!_revealPending) return;

            _revealPending = false;
            StopSlowHint();
            RevealBrowser();
            return;
        }

        if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled)
            return;

        AppLog.Write($"Falha de navegação: {e.WebErrorStatus}.");
        _revealPending = false;
        StopSlowHint();
        ShowStatus(
            "Não foi possível conectar ao Órbita",
            "Verifique sua conexão com a internet. O servidor também pode estar iniciando; "
            + "aguarde alguns segundos e tente novamente.",
            "Tentar novamente", RetryNavigation,
            "Abrir no navegador", OpenInBrowser);
        StatusSiteButton.Visibility = Visibility.Visible;
    }

    private void OnContainsFullScreenElementChanged(object? sender, object e)
    {
        var fullscreen = Browser.CoreWebView2?.ContainsFullScreenElement == true;
        Dispatcher.BeginInvoke(new Action(() => SetHtmlFullscreen(fullscreen)));
    }

    private void SetHtmlFullscreen(bool fullscreen)
    {
        if (_htmlFullscreen == fullscreen) return;

        if (fullscreen)
        {
            _stateBeforeFullscreen = WindowState;
            _styleBeforeFullscreen = WindowStyle;
            _resizeBeforeFullscreen = ResizeMode;

            if (WindowState == WindowState.Maximized)
                WindowState = WindowState.Normal;

            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            _htmlFullscreen = true;
        }
        else
        {
            WindowState = WindowState.Normal;
            WindowStyle = _styleBeforeFullscreen;
            ResizeMode = _resizeBeforeFullscreen;
            if (_stateBeforeFullscreen == WindowState.Maximized)
                WindowState = WindowState.Maximized;
            _htmlFullscreen = false;
        }
    }

    private void RetryNavigation()
    {
        if (!_browserReady || Browser.CoreWebView2 is null)
        {
            _ = InitializeBrowserAsync();
            return;
        }

        ShowSplash("Conectando à sua comunidade…");
        StartSlowHint();
        _revealPending = true;
        Browser.CoreWebView2.Navigate(AppInfo.StartUri.AbsoluteUri);
    }

    private void ReloadBrowser()
    {
        if (!_browserReady || Browser.CoreWebView2 is null)
        {
            _ = InitializeBrowserAsync();
            return;
        }

        ShowSplash("Recarregando o Órbita…");
        _revealPending = true;
        Browser.CoreWebView2.Reload();
    }

    private void SetMemoryTarget(bool low)
    {
        var core = Browser.CoreWebView2;
        if (core is null) return;

        try
        {
            core.MemoryUsageTargetLevel = low
                ? CoreWebView2MemoryUsageTargetLevel.Low
                : CoreWebView2MemoryUsageTargetLevel.Normal;
        }
        catch (Exception exception)
        {
            AppLog.Error("Ajustar memória do WebView2", exception);
        }
    }

    // ---------------------------------------------------------------- camadas

    private void ShowSplash(string message)
    {
        LoadingText.Text = message;
        LoadingHint.Text = "A primeira abertura pode levar alguns segundos.";
        LoadingLayer.Visibility = Visibility.Visible;
        StatusLayer.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Collapsed;
        StartLoadingAnimation();
    }

    private void RevealBrowser()
    {
        if (!_browserReady) return;

        Browser.Visibility = Visibility.Visible;
        LoadingLayer.Visibility = Visibility.Collapsed;
        StatusLayer.Visibility = Visibility.Collapsed;
        StopLoadingAnimation();
        Browser.Focus();
    }

    private void ShowStatus(
        string title,
        string message,
        string primaryText,
        Action primary,
        string? secondaryText = null,
        Action? secondary = null)
    {
        StopSlowHint();
        StopLoadingAnimation();

        StatusTitle.Text = title;
        StatusMessage.Text = message;

        _statusPrimary = primary;
        StatusPrimaryButton.Content = primaryText;
        StatusPrimaryButton.Visibility = Visibility.Visible;

        _statusSecondary = secondary;
        StatusSecondaryButton.Content = secondaryText ?? string.Empty;
        StatusSecondaryButton.Visibility = secondaryText is null
            ? Visibility.Collapsed
            : Visibility.Visible;

        StatusSiteButton.Visibility = Visibility.Collapsed;
        LoadingLayer.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Collapsed;
        StatusLayer.Visibility = Visibility.Visible;
    }

    private void OnStatusPrimaryClick(object sender, RoutedEventArgs e) => RunStatusAction(ref _statusPrimary);

    private void OnStatusSecondaryClick(object sender, RoutedEventArgs e) => RunStatusAction(ref _statusSecondary);

    private void OnStatusSiteClick(object sender, RoutedEventArgs e) => OpenInBrowser();

    private static void RunStatusAction(ref Action? action)
    {
        var run = action;
        action = null;
        run?.Invoke();
    }

    private void StartLoadingAnimation()
    {
        if (_loadingAnimationRunning) return;

        if (!SystemParameters.ClientAreaAnimation)
        {
            LoadingPulseTransform.X = 79;
            LoadingPulse.Opacity = 0.35;
            _loadingAnimationRunning = true;
            return;
        }

        LoadingPulse.Opacity = 0.85;
        var animation = new DoubleAnimation(-90, 240, TimeSpan.FromSeconds(1.4))
        {
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseInOut }
        };
        LoadingPulseTransform.BeginAnimation(
            System.Windows.Media.TranslateTransform.XProperty, animation);
        _loadingAnimationRunning = true;
    }

    private void StopLoadingAnimation()
    {
        if (!_loadingAnimationRunning) return;

        LoadingPulseTransform.BeginAnimation(
            System.Windows.Media.TranslateTransform.XProperty, null);
        _loadingAnimationRunning = false;
    }

    private void StartSlowHint()
    {
        StopSlowHint();
        if (AppInfo.StartUri.IsLoopback) return;

        _slowLoadingTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(7)
        };
        _slowLoadingTimer.Tick += (_, _) =>
        {
            LoadingHint.Text = "O servidor gratuito pode levar até um minuto para iniciar.";
            StopSlowHint();
        };
        _slowLoadingTimer.Start();
    }

    private void StopSlowHint()
    {
        _slowLoadingTimer?.Stop();
        _slowLoadingTimer = null;
    }

    // ---------------------------------------------------------------- ações

    private void OpenWebView2Download() => OpenExternal(new Uri(AppInfo.WebView2DownloadUrl));

    private void OpenInBrowser() => OpenExternal(AppInfo.StartUri);

    private static void OpenExternal(Uri uri)
    {
        if (!DesktopPolicy.IsSafeExternal(uri))
        {
            AppLog.Write($"Link externo recusado: {uri}");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            AppLog.Error("Abrir link externo", exception);
        }
    }

    private sealed class DarkMenuColors : Forms.ProfessionalColorTable
    {
        private static readonly Drawing.Color Background = Drawing.Color.FromArgb(20, 22, 27);
        private static readonly Drawing.Color Hover = Drawing.Color.FromArgb(40, 45, 56);
        private static readonly Drawing.Color Line = Drawing.Color.FromArgb(45, 48, 58);

        public override Drawing.Color ToolStripDropDownBackground => Background;
        public override Drawing.Color ImageMarginGradientBegin => Background;
        public override Drawing.Color ImageMarginGradientMiddle => Background;
        public override Drawing.Color ImageMarginGradientEnd => Background;
        public override Drawing.Color MenuItemSelected => Hover;
        public override Drawing.Color MenuItemSelectedGradientBegin => Hover;
        public override Drawing.Color MenuItemSelectedGradientEnd => Hover;
        public override Drawing.Color MenuItemBorder => Hover;
        public override Drawing.Color MenuBorder => Line;
        public override Drawing.Color SeparatorDark => Line;
        public override Drawing.Color SeparatorLight => Background;
        public override Drawing.Color ToolStripBorder => Background;
        public override Drawing.Color ToolStripGradientBegin => Background;
        public override Drawing.Color ToolStripGradientMiddle => Background;
        public override Drawing.Color ToolStripGradientEnd => Background;
    }
}
