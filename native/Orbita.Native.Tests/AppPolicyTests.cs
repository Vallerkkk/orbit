using Orbita.Native;
using Xunit;

public class AppPolicyTests
{
    [Theory]
    [InlineData("https://orbita-8nwu.onrender.com/")]
    [InlineData("https://orbita-8nwu.onrender.com/#/canal/1")]
    [InlineData("https://ORBITA-8NWU.onrender.com/api/version")]
    [InlineData("https://orbita-8nwu.onrender.com:443/")]
    public void AcceptsAppOrigin(string url) => Assert.True(AppPolicy.IsAppUrl(url));

    [Theory]
    [InlineData("http://orbita-8nwu.onrender.com/")]
    [InlineData("https://orbita-8nwu.onrender.com:8443/")]
    [InlineData("https://user:pass@orbita-8nwu.onrender.com/")]
    [InlineData("https://orbita-8nwu.onrender.com.evil.com/")]
    [InlineData("https://evil.com/?https://orbita-8nwu.onrender.com/")]
    [InlineData("https://orbita-8nwu.onrender.com/\\evil")]
    [InlineData("https://orbita-8nwu.onrender.com/ x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///C:/Windows/System32/cmd.exe")]
    [InlineData("")]
    [InlineData(null)]
    public void RejectsOtherOrigins(string? url) => Assert.False(AppPolicy.IsAppUrl(url));

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=abc")]
    [InlineData("https://github.com/Vallerkkk/orbit")]
    public void ExternalHttpsIsSafe(string url) => Assert.NotNull(AppPolicy.SafeHttps(url));

    [Theory]
    [InlineData("http://example.com/")]
    [InlineData("ms-settings:privacy")]
    [InlineData("https://example.com/\u0000")]
    public void UnsafeExternalIsRejected(string url) => Assert.Null(AppPolicy.SafeHttps(url));

    [Fact]
    public void RejectsVeryLongUrls() => Assert.Null(AppPolicy.SafeHttps("https://example.com/" + new string('a', 5000)));

    [Theory]
    [InlineData("about:blank", true)]
    [InlineData("data:text/html;charset=utf-8;base64,PGh0bWw+", true)]
    [InlineData("data:image/svg+xml,<svg/>", false)]
    [InlineData("https://example.com/", false)]
    public void InternalPages(string url, bool expected) => Assert.Equal(expected, AppPolicy.IsInternal(url));
}
