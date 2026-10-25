using System.Text.Json;
using System.Text.Json.Serialization;

namespace Orbita.Native;

/// <summary>Preferências locais pequenas, salvas em %LOCALAPPDATA%\Orbita\settings.json.</summary>
internal sealed class Settings
{
    public int X { get; set; } = int.MinValue;
    public int Y { get; set; } = int.MinValue;
    public int Width { get; set; } = 1360;
    public int Height { get; set; } = 900;
    public bool Maximized { get; set; } = true;
    /// <summary>null = perguntar; true = bandeja; false = encerrar.</summary>
    public bool? CloseToTray { get; set; }
    public double Zoom { get; set; } = 1.0;

    public static string Folder { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Orbita");
    static string FilePath => Path.Combine(Folder, "settings.json");

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize(File.ReadAllText(FilePath), SettingsJson.Default.Settings) ?? new();
        }
        catch { }
        return new();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, SettingsJson.Default.Settings));
            File.Move(tmp, FilePath, overwrite: true);
        }
        catch { }
    }
}

[JsonSourceGenerationOptions(WriteIndented = true)]
[JsonSerializable(typeof(Settings))]
internal sealed partial class SettingsJson : JsonSerializerContext;
