namespace Orbita.Native;

/// <summary>Páginas internas leves, sem rede e sem scripts externos.</summary>
internal static class Pages
{
    const string Style = """
        <style>
        :root{color-scheme:dark}
        html,body{margin:0;height:100%;background:#10101b;color:#e7e7f5;font:15px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}
        main{height:100%;display:grid;place-content:center;text-align:center;gap:6px;padding:24px;box-sizing:border-box}
        h1{margin:0 0 8px;font-size:28px;font-weight:600;letter-spacing:.5px}
        h2{margin:0;font-size:19px;font-weight:600}
        p{margin:0;color:#a3a3c2}
        .orb{width:44px;height:44px;margin:0 auto 14px;border-radius:50%;border:3px solid #2b2b45;border-top-color:#8b7cff;animation:spin .9s linear infinite}
        a{display:inline-block;margin:14px auto 6px;padding:9px 22px;border-radius:10px;background:#6c5cff;color:#fff;text-decoration:none;font-weight:600}
        a:hover{background:#7d6fff}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){.orb{animation:none}}
        </style>
        """;

    public static string Loading => $"""
        <!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Órbita</title>{Style}</head>
        <body><main><div class="orb" aria-hidden="true"></div><h1>◉ Órbita</h1>
        <p role="status">Conectando à sua comunidade…</p><p>A primeira conexão pode levar alguns instantes.</p></main></body></html>
        """;

    public static string Offline => $"""
        <!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Reconectar — Órbita</title>{Style}</head>
        <body><main><h1>◉ Órbita</h1><h2>Vamos reconectar?</h2>
        <p>Não foi possível acessar a comunidade. Confira sua conexão e tente novamente.</p>
        <a href="{AppPolicy.AppUrl}">Tentar novamente</a>
        <p>A Órbita reconecta sozinha quando a internet voltar. Sua sessão fica no aplicativo.</p></main></body></html>
        """;
}
