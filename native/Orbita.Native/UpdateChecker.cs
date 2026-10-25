using System.Net.Http.Headers;
using System.Text.Json;

namespace Orbita.Native;

/// <summary>
/// Consulta as versões publicadas no GitHub com tag <c>native-vX.Y.Z</c>. Apenas avisa:
/// nada é baixado ou executado automaticamente — o link abre no navegador.
/// </summary>
internal static class UpdateChecker
{
    const string ReleasesApi = "https://api.github.com/repos/Vallerkkk/orbit/releases?per_page=15";
    const string TagPrefix = "native-v";

    public static Version Current { get; } = typeof(UpdateChecker).Assembly.GetName().Version is { } v
        ? new Version(v.Major, v.Minor, Math.Max(v.Build, 0)) : new Version(0, 0, 0);

    static readonly HttpClient Http = CreateClient();

    static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("OrbitaNative", Current.ToString()));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return client;
    }

    public sealed record Release(Version Version, string Url);

    /// <summary>Retorna a versão mais nova que a atual, ou null (inclusive em erro de rede).</summary>
    public static async Task<Release?> CheckAsync(CancellationToken token = default)
    {
        try
        {
            using var response = await Http.GetAsync(ReleasesApi, token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: token).ConfigureAwait(false);
            Release? best = null;
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.GetProperty("draft").GetBoolean() || item.GetProperty("prerelease").GetBoolean()) continue;
                var tag = item.GetProperty("tag_name").GetString();
                var url = item.GetProperty("html_url").GetString();
                if (tag is null || url is null || !tag.StartsWith(TagPrefix, StringComparison.Ordinal)) continue;
                if (!Version.TryParse(tag[TagPrefix.Length..], out var version) || version <= Current) continue;
                if (AppPolicy.SafeHttps(url)?.Host is not "github.com") continue;
                if (best is null || version > best.Version) best = new Release(version, url);
            }
            return best;
        }
        catch { return null; }
    }

    /// <summary>Teste leve de alcance do servidor, usado para sair da tela offline sem piscar.</summary>
    public static async Task<bool> CanReachAppAsync()
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Head, AppPolicy.AppUrl);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            return (int)response.StatusCode < 500;
        }
        catch { return false; }
    }
}
