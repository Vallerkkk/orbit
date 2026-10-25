using System.Text.Json;

namespace Orbita.Desktop.Services;

internal sealed class AppSettings
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public double? WindowLeft { get; set; }
    public double? WindowTop { get; set; }
    public double? WindowWidth { get; set; }
    public double? WindowHeight { get; set; }
    public bool Maximized { get; set; }

    // "ask" | "tray" | "exit"
    public string CloseBehavior { get; set; } = "ask";
    public List<string> AllowedPermissions { get; set; } = [];

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(AppPaths.SettingsFile))
            {
                var loaded = JsonSerializer.Deserialize<AppSettings>(
                    File.ReadAllText(AppPaths.SettingsFile), JsonOptions);
                if (loaded is not null)
                {
                    loaded.AllowedPermissions ??= [];
                    if (loaded.CloseBehavior is not ("ask" or "tray" or "exit"))
                        loaded.CloseBehavior = "ask";
                    return loaded;
                }
            }
        }
        catch (Exception exception)
        {
            AppLog.Error("Ler configurações", exception);
        }

        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            var temporary = AppPaths.SettingsFile + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(this, JsonOptions));
            File.Move(temporary, AppPaths.SettingsFile, true);
        }
        catch (Exception exception)
        {
            AppLog.Error("Salvar configurações", exception);
        }
    }

    public bool Allows(string permission) =>
        AllowedPermissions.Contains(permission, StringComparer.OrdinalIgnoreCase);

    public void Allow(string permission)
    {
        if (Allows(permission)) return;
        AllowedPermissions.Add(permission);
        Save();
    }

    public void ResetPermissions()
    {
        AllowedPermissions.Clear();
        Save();
    }
}
