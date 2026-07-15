$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$defaultReleaseBaseUrl = 'https://github.com/rawback-app/cli/releases/latest/download'
$releaseBaseUrl = if ([string]::IsNullOrWhiteSpace($env:RAWBACK_RELEASE_BASE_URL)) {
  $defaultReleaseBaseUrl
} else {
  $env:RAWBACK_RELEASE_BASE_URL.TrimEnd('/')
}
$installDirectory = if ([string]::IsNullOrWhiteSpace($env:RAWBACK_INSTALL_DIR)) {
  Join-Path $HOME '.local\bin'
} else {
  $env:RAWBACK_INSTALL_DIR
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "rawback installer: unsupported operating system; install.ps1 requires Windows"
}

$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$assetArchitecture = switch ($architecture) {
  'X64' { 'x86_64' }
  'Arm64' { 'arm64' }
  default { throw "rawback installer: unsupported architecture: $architecture" }
}

$archive = "rawback_Windows_$assetArchitecture.zip"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "rawback-install-$([Guid]::NewGuid())"
$archivePath = Join-Path $temporaryDirectory $archive
$checksumsPath = Join-Path $temporaryDirectory 'checksums.txt'
$stagedBinary = $null

try {
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

  Write-Host "Downloading $archive..."
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseBaseUrl/$archive" -OutFile $archivePath
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseBaseUrl/checksums.txt" -OutFile $checksumsPath

  $expectedChecksum = $null
  foreach ($line in Get-Content $checksumsPath) {
    if ($line -match '^(?<hash>[0-9A-Fa-f]{64})\s+\*?(?<name>.+)$' -and $Matches.name -eq $archive) {
      $expectedChecksum = $Matches.hash.ToLowerInvariant()
      break
    }
  }
  if ($null -eq $expectedChecksum) {
    throw "rawback installer: checksums.txt does not contain $archive"
  }

  $actualChecksum = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $expectedChecksum) {
    throw "rawback installer: checksum mismatch for $archive"
  }

  Expand-Archive -Path $archivePath -DestinationPath $temporaryDirectory -Force
  $sourceBinary = Join-Path $temporaryDirectory 'rawback.exe'
  if (-not (Test-Path -LiteralPath $sourceBinary -PathType Leaf)) {
    throw 'rawback installer: archive does not contain rawback.exe'
  }

  New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
  $targetBinary = Join-Path $installDirectory 'rawback.exe'
  $stagedBinary = Join-Path $installDirectory ".rawback.$PID.tmp"
  Copy-Item -LiteralPath $sourceBinary -Destination $stagedBinary -Force

  if (Test-Path -LiteralPath $targetBinary -PathType Leaf) {
    [IO.File]::Replace($stagedBinary, $targetBinary, $null)
  } else {
    Move-Item -LiteralPath $stagedBinary -Destination $targetBinary
  }
  $stagedBinary = $null

  Write-Host "Installed rawback to $targetBinary"
  & $targetBinary --version

  $pathEntries = @($env:PATH -split [IO.Path]::PathSeparator)
  if ($pathEntries -notcontains $installDirectory) {
    Write-Warning "$installDirectory is not on PATH; add it before running rawback."
  }
} finally {
  if ($null -ne $stagedBinary -and (Test-Path -LiteralPath $stagedBinary)) {
    Remove-Item -LiteralPath $stagedBinary -Force
  }
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
