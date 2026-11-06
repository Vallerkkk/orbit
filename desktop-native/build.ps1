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

# A receita abaixo reproduz byte a byte o Orbita.exe publicado na release v2.0.0
# (SHA-256 eff59588…). ReadyToRun deixa o pacote ~8 MB maior e muda o hash.
$publishArgs = @(
    'publish', $project,
    '-c', 'Release',
    '-r', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableCompressionInSingleFile=true',
    '-p:DebugType=none',
    '-p:DebugSymbols=false',
    '-o', $publishDir
)

Write-Host "Publicando Órbita $version para win-x64..." -ForegroundColor Cyan
& $dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o aplicativo.' }

$exePath = Join-Path $publishDir 'Orbita.exe'
if (-not (Test-Path -LiteralPath $exePath)) { throw "Orbita.exe não foi gerado em $publishDir." }
Copy-Item -LiteralPath (Join-Path $projectDir 'LEIA-ME.txt') -Destination $publishDir -Force

if (-not $NoZip) {
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    # O ZIP publicado leva exatamente dois arquivos, o executável primeiro e o LEIA-ME depois. A
    # pasta de publish também guarda os XMLs de documentação dos pacotes, que não vão para o pacote.
    # ZipFile e ZipArchiveMode moram em assemblies diferentes no .NET Framework carregado pelo
    # Windows PowerShell; sem as duas linhas acima o tipo do modo não é encontrado.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $optimal = [System.IO.Compression.CompressionLevel]::Optimal
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $exePath, 'Orbita.exe', $optimal)
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $projectDir 'LEIA-ME.txt'), 'LEIA-ME.txt', $optimal)
    } finally { $archive.Dispose() }

    # Os dois arquivos publicados: o executável único que a página /instalar oferece e o ZIP que o
    # embrulha com o LEIA-ME. São os anexos versionados da release no GitHub.
    $entries = @($exePath, $zipPath)
    $lines = foreach ($entry in $entries) {
        $hash = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash.ToLowerInvariant()
        '{0}  {1}' -f $hash, (Split-Path -Leaf $entry)
    }
    $lines | Set-Content -LiteralPath (Join-Path $outDir 'SHA256SUMS.txt') -Encoding Ascii

    Write-Host "Pacote: $zipPath" -ForegroundColor Green
    $lines | ForEach-Object { Write-Host $_ }
}

Write-Host "Pasta publicada: $publishDir" -ForegroundColor Green
