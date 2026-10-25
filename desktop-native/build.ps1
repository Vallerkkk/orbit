[CmdletBinding()]
param(
    [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$project = Join-Path $projectDir 'Orbita.Desktop.csproj'

[xml]$xml = Get-Content -LiteralPath $project -Raw
$version = @($xml.Project.PropertyGroup |
    ForEach-Object { $_.Version } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) |
    Select-Object -First 1
if (-not $version) { throw 'Versão não encontrada em Orbita.Desktop.csproj.' }
$version = $version.Trim()

function Resolve-DotNet {
    $candidates = @()
    $command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $local = Join-Path $env:USERPROFILE '.dotnet-local\dotnet.exe'
    if (Test-Path -LiteralPath $local) { $candidates += $local }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $sdks = & $candidate --list-sdks 2>$null
        if ($LASTEXITCODE -eq 0 -and $sdks) { return $candidate }
    }

    throw 'SDK do .NET não encontrado. Instale o .NET 10 SDK (dotnet.microsoft.com) e tente novamente.'
}

$dotnet = Resolve-DotNet
$outDir = Join-Path $projectDir 'out'
$publishDir = Join-Path $outDir "Orbita-$version-win-x64"
$zipPath = Join-Path $outDir "Orbita-$version-win-x64.zip"

if (Test-Path -LiteralPath $publishDir) {
    Remove-Item -LiteralPath $publishDir -Recurse -Force
}
New-Item -ItemType Directory -Path $publishDir -Force | Out-Null

$publishArgs = @(
    'publish', $project,
    '-c', 'Release',
    '-r', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishReadyToRun=true',
    '-p:DebugType=none',
    '-p:DebugSymbols=false',
    '-o', $publishDir
)

Write-Host "Publicando Órbita $version para win-x64..." -ForegroundColor Cyan
& $dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o aplicativo.' }

Copy-Item -LiteralPath (Join-Path $projectDir 'LEIA-ME.txt') -Destination $publishDir

if (-not $NoZip) {
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $publishDir,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $zipPath)" |
        Set-Content -LiteralPath (Join-Path $outDir 'SHA256SUMS.txt') -Encoding Ascii

    Write-Host "Pacote: $zipPath" -ForegroundColor Green
    Write-Host "SHA-256: $hash" -ForegroundColor Green
}

Write-Host "Pasta publicada: $publishDir" -ForegroundColor Green
