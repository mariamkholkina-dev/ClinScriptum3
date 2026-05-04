# deploy/upload-local-data.ps1
#
# Snapshots local dev data and ships it to the dev server, ready for
# bootstrap-dev-server.sh to auto-restore.
#
# What it does:
#   1. pg_dump local Postgres (clinscriptum3 DB) -> ./clinscriptum.dump
#   2. tar.gz local ./uploads dir              -> ./uploads.tar.gz   (if present)
#   3. scp both to root@<server>:/root/
#
# Usage (from project root, in PowerShell 5.1 or 7+):
#   .\deploy\upload-local-data.ps1
#
# If blocked by execution policy:
#   powershell -ExecutionPolicy Bypass -File .\deploy\upload-local-data.ps1
#
# Customize:
#   .\deploy\upload-local-data.ps1 -Server root@141.105.71.244 -DbContainer clinscriptum3-postgres-1
#
# Requires: Docker Desktop running, ssh + scp on PATH (Windows OpenSSH).

[CmdletBinding()]
param(
  [string]$Server         = "root@141.105.71.244",
  [string]$RemoteDir      = "/root",
  [string]$DbContainer    = "clinscriptum3-postgres-1",
  [string]$DbUser         = "clinscriptum",
  [string]$DbName         = "clinscriptum3",
  [string]$DumpFile       = "clinscriptum.dump",
  [string]$UploadsDir     = "uploads",
  [string]$UploadsArchive = "uploads.tar.gz",
  [switch]$SkipDb,
  [switch]$SkipFiles,
  [switch]$KeepLocal
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host ("==> " + $msg) -ForegroundColor Cyan }
function Write-Warn2([string]$msg) { Write-Host ("!!  " + $msg) -ForegroundColor Yellow }

# ---- Sanity checks --------------------------------------------------------
foreach ($cmd in @("docker", "scp", "ssh", "tar")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw ($cmd + " not found on PATH")
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
Write-Step ("Working in " + $projectRoot)

# ---- 1. Postgres dump -----------------------------------------------------
if (-not $SkipDb) {
  Write-Step ("Dumping Postgres " + $DbName + " from " + $DbContainer + " -> " + $DumpFile)
  $running = docker ps --filter ("name=^" + $DbContainer + "$") --format "{{.Names}}"
  if (-not $running) {
    throw ("Container " + $DbContainer + " is not running. Start it: docker compose up -d postgres")
  }

  docker exec $DbContainer pg_dump -U $DbUser -d $DbName -F c -Z 9 -f /tmp/clinscriptum.dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

  if (Test-Path $DumpFile) { Remove-Item $DumpFile -Force }
  docker cp ($DbContainer + ":/tmp/clinscriptum.dump") $DumpFile
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed" }
  docker exec $DbContainer rm -f /tmp/clinscriptum.dump | Out-Null

  $sizeMb = [math]::Round((Get-Item $DumpFile).Length / 1MB, 2)
  Write-Step ("  dump size: " + $sizeMb + " MB")
} else {
  Write-Warn2 "Skipping DB dump (-SkipDb)"
}

# ---- 2. Uploads archive ---------------------------------------------------
$haveUploads = $false
if (-not $SkipFiles) {
  if (Test-Path $UploadsDir) {
    $count = (Get-ChildItem $UploadsDir -Recurse -File | Measure-Object).Count
    if ($count -eq 0) {
      Write-Warn2 ($UploadsDir + " is empty - nothing to archive")
    } else {
      Write-Step ("Archiving " + $UploadsDir + " - " + $count + " files - to " + $UploadsArchive)
      if (Test-Path $UploadsArchive) { Remove-Item $UploadsArchive -Force }
      tar -czf $UploadsArchive -C $UploadsDir .
      if ($LASTEXITCODE -ne 0) { throw "tar failed" }
      $sizeMb = [math]::Round((Get-Item $UploadsArchive).Length / 1MB, 2)
      Write-Step ("  archive size: " + $sizeMb + " MB")
      $haveUploads = $true
    }
  } else {
    Write-Warn2 ($UploadsDir + " not found. If your local files are in MinIO, export the bucket separately and scp it as /root/minio-backup.tar.gz.")
  }
} else {
  Write-Warn2 "Skipping uploads archive (-SkipFiles)"
}

# ---- 3. scp to server -----------------------------------------------------
Write-Step ("Uploading to " + $Server + ":" + $RemoteDir + "/")
$toUpload = New-Object System.Collections.ArrayList
if (-not $SkipDb -and (Test-Path $DumpFile))       { [void]$toUpload.Add($DumpFile) }
if ($haveUploads -and (Test-Path $UploadsArchive)) { [void]$toUpload.Add($UploadsArchive) }

if ($toUpload.Count -eq 0) {
  Write-Warn2 "Nothing to upload"
} else {
  foreach ($f in $toUpload) {
    Write-Step ("  scp " + $f)
    scp $f ($Server + ":" + $RemoteDir + "/")
    if ($LASTEXITCODE -ne 0) { throw ("scp failed for " + $f) }
  }
}

# ---- 4. Cleanup -----------------------------------------------------------
if (-not $KeepLocal) {
  foreach ($f in $toUpload) {
    Remove-Item $f -Force -ErrorAction SilentlyContinue
  }
  Write-Step "Cleaned up local artifacts (use -KeepLocal to preserve)"
}

Write-Host ""
Write-Step "Done. Now on the server run:"
Write-Host ("  ssh " + $Server)
Write-Host "  LE_EMAIL=ops@example.com bash /root/bootstrap.sh"
Write-Host ""
Write-Host "(scp the bootstrap script first if you have not yet:" -ForegroundColor DarkGray
Write-Host ("   scp deploy/bootstrap-dev-server.sh " + $Server + ":/root/bootstrap.sh )") -ForegroundColor DarkGray
