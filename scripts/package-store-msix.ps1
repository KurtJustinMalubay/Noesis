param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Architecture,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^v?(?<major>[1-9]\d*)\.(?<minor>\d+)\.(?<patch>\d+)$') {
  throw "Release tag '$Version' must be a stable three-part version such as v1.2.3."
}

$versionParts = @(
  [int]$Matches.major,
  [int]$Matches.minor,
  [int]$Matches.patch,
  0
)
if ($versionParts | Where-Object { $_ -gt 65535 }) {
  throw "The MSIX package version components must not exceed 65535."
}
$packageVersion = "$($versionParts[0]).$($versionParts[1]).$($versionParts[2]).0"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestTemplate = Join-Path $repoRoot "src-tauri\windows\Package.appxmanifest.template"
$iconRoot = Join-Path $repoRoot "src-tauri\icons"
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "The Tauri executable was not found: $ExecutablePath"
}

$stagingRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$packageDirectory = Join-Path $stagingRoot "noesis-msix-$Architecture-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $packageDirectory | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory "Assets") | Out-Null

$manifest = [System.IO.File]::ReadAllText($manifestTemplate)
$manifest = $manifest.Replace("{{PACKAGE_VERSION}}", $packageVersion)
$manifest = $manifest.Replace("{{PROCESSOR_ARCHITECTURE}}", $Architecture)
[xml]$validatedManifest = $manifest
[System.IO.File]::WriteAllText(
  (Join-Path $packageDirectory "AppxManifest.xml"),
  $manifest,
  [System.Text.UTF8Encoding]::new($false)
)
Copy-Item -LiteralPath $ExecutablePath -Destination (Join-Path $packageDirectory "noesis.exe")
Copy-Item -LiteralPath (Join-Path $iconRoot "StoreLogo.png") -Destination (Join-Path $packageDirectory "Assets\StoreLogo.png")
Copy-Item -LiteralPath (Join-Path $iconRoot "Square150x150Logo.png") -Destination (Join-Path $packageDirectory "Assets\Square150x150Logo.png")
Copy-Item -LiteralPath (Join-Path $iconRoot "Square44x44Logo.png") -Destination (Join-Path $packageDirectory "Assets\Square44x44Logo.png")

$windowsKits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$makeAppx = Get-ChildItem -LiteralPath $windowsKits -Filter "MakeAppx.exe" -File -Recurse |
  Where-Object { $_.Directory.Name -eq "x64" } |
  Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
  Select-Object -First 1
if (-not $makeAppx) {
  throw "MakeAppx.exe was not found in the Windows 10 SDK."
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$absoluteOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
& $makeAppx.FullName pack /d $packageDirectory /p $absoluteOutputPath /o
if ($LASTEXITCODE -ne 0) {
  throw "MakeAppx failed to package the $Architecture MSIX (exit code $LASTEXITCODE)."
}
