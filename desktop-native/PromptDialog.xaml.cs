using System.Windows;
using System.Windows.Interop;
using Orbita.Desktop.Services;

namespace Orbita.Desktop;

internal enum PromptChoice
{
    None = 0,
    Cancel = 1,
    Primary = 2,
    Secondary = 3
}

internal sealed class PromptOptions
{
    public string Title { get; init; } = AppInfo.WindowTitle;
    public required string Message { get; init; }
    public string? Detail { get; init; }
    public string PrimaryText { get; init; } = "OK";
    public string? SecondaryText { get; init; }
    public string CancelText { get; init; } = "Cancelar";
    public bool ShowCancel { get; init; } = true;
    public bool ShowRemember { get; init; }
    public bool RememberChecked { get; init; }
    public string RememberText { get; init; } = "Lembrar minha escolha";
}

public partial class PromptDialog : Window
{
    internal PromptChoice Choice { get; private set; } = PromptChoice.None;
    internal bool RememberChecked => RememberBox.IsChecked == true;

    internal PromptDialog(PromptOptions options)
    {
        InitializeComponent();

        Title = options.Title;
        HeadingText.Text = options.Message;
        BodyText.Text = options.Detail ?? string.Empty;
        BodyText.Visibility = string.IsNullOrWhiteSpace(options.Detail)
            ? Visibility.Collapsed
            : Visibility.Visible;

        PrimaryButton.Content = options.PrimaryText;
        SecondaryButton.Content = options.SecondaryText ?? string.Empty;
        SecondaryButton.Visibility = string.IsNullOrWhiteSpace(options.SecondaryText)
            ? Visibility.Collapsed
            : Visibility.Visible;
        CancelButton.Content = options.CancelText;
        CancelButton.Visibility = options.ShowCancel ? Visibility.Visible : Visibility.Collapsed;

        RememberBox.Content = options.RememberText;
        RememberBox.IsChecked = options.RememberChecked;
        RememberBox.Visibility = options.ShowRemember ? Visibility.Visible : Visibility.Collapsed;

        // O botão seguro (Cancelar) é o padrão para que Enter nunca conceda
        // permissão ou encerre o aplicativo sem uma escolha explícita.
        var defaultButton = CancelButton.Visibility == Visibility.Visible ? CancelButton : PrimaryButton;
        defaultButton.IsDefault = true;
        CancelButton.IsCancel = true;

        Loaded += OnLoaded;
        Closed += OnClosed;
    }

    internal static PromptChoice Ask(Window? owner, PromptOptions options, out bool remember)
    {
        var dialog = new PromptDialog(options);
        if (owner is { IsVisible: true })
            dialog.Owner = owner;
        else
            dialog.WindowStartupLocation = WindowStartupLocation.CenterScreen;

        dialog.ShowDialog();
        remember = dialog.RememberChecked;
        return dialog.Choice;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        NativeMethods.ApplyDarkChrome(new WindowInteropHelper(this).Handle);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (CancelButton.Visibility == Visibility.Visible)
            CancelButton.Focus();
        else
            PrimaryButton.Focus();
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        if (Choice == PromptChoice.None)
            Choice = PromptChoice.Cancel;
    }

    private void OnPrimaryClick(object sender, RoutedEventArgs e)
    {
        Choice = PromptChoice.Primary;
        Close();
    }

    private void OnSecondaryClick(object sender, RoutedEventArgs e)
    {
        Choice = PromptChoice.Secondary;
        Close();
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        Choice = PromptChoice.Cancel;
        Close();
    }
}
