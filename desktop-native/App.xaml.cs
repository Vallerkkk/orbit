using System.Windows;
using System.Windows.Threading;
using Orbita.Desktop.Services;

namespace Orbita.Desktop;

public partial class App : Application
{
    private const string InstanceMutexName = @"Local\Orbita.Desktop.Native.Instance";
    private const string ActivateEventName = @"Local\Orbita.Desktop.Native.Activate";

    private Mutex? _instanceMutex;
    private bool _holdsMutex;
    private EventWaitHandle? _activateEvent;
    private MainWindow? _window;

    protected override void OnStartup(StartupEventArgs e)
    {
        AppLog.Install();
        NativeMethods.ApplyAppUserModelId();
        AppLog.Write($"Iniciando Órbita {AppInfo.Version}.");

        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;

        _instanceMutex = new Mutex(false, InstanceMutexName);
        try
        {
            _holdsMutex = _instanceMutex.WaitOne(0);
        }
        catch (AbandonedMutexException)
        {
            _holdsMutex = true;
        }

        if (!_holdsMutex)
        {
            SignalExistingInstance();
            Shutdown();
            return;
        }

        _activateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName);
        var listener = new Thread(ListenForActivation)
        {
            IsBackground = true,
            Name = "Orbita.Activation"
        };
        listener.Start();

        base.OnStartup(e);

        _window = new MainWindow();
        MainWindow = _window;
        _window.Show();
    }

    public void RequestExit()
    {
        _window?.PrepareForExit();
        Shutdown();
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        _window?.PrepareForSystemShutdown();
        base.OnSessionEnding(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _activateEvent?.Set();
        }
        catch
        {
            // Ignore teardown races.
        }

        _activateEvent?.Dispose();

        if (_holdsMutex)
        {
            try
            {
                _instanceMutex?.ReleaseMutex();
            }
            catch
            {
                // The process is ending anyway.
            }
        }

        _instanceMutex?.Dispose();
        AppLog.Write("Aplicativo encerrado.");
        base.OnExit(e);
    }

    private void ListenForActivation()
    {
        var wait = _activateEvent;
        if (wait is null) return;

        while (true)
        {
            try
            {
                if (!wait.WaitOne()) return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }

            Dispatcher.BeginInvoke(() => _window?.ActivateFromSecondInstance());
        }
    }

    private static void SignalExistingInstance()
    {
        NativeMethods.AllowAnyForegroundWindow();
        for (var attempt = 0; attempt < 25; attempt++)
        {
            try
            {
                if (EventWaitHandle.TryOpenExisting(ActivateEventName, out var handle))
                {
                    using (handle)
                    {
                        handle.Set();
                    }

                    return;
                }
            }
            catch
            {
                // The first instance may still be creating the event.
            }

            Thread.Sleep(40);
        }
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        AppLog.Error("Interface", e.Exception);
        e.Handled = true;

        try
        {
            MessageBox.Show(
                "Ocorreu um erro inesperado no Órbita. O aplicativo continuará aberto; se a janela ficar instável, feche e abra novamente.",
                "Órbita", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        catch
        {
            // Never let reporting crash the app.
        }
    }

    private void OnDomainUnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        if (e.ExceptionObject is Exception exception)
            AppLog.Error("Processo", exception);
        else
            AppLog.Write("ERRO de processo sem exceção gerenciada.");
    }

    private void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        AppLog.Error("Tarefa", e.Exception);
        e.SetObserved();
    }
}
