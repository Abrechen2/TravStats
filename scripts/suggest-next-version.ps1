# Suggest next version for TravStats based on git history (Conventional Commits).
# Run from repo root. Reads backend/VERSION; outputs suggested patch/minor/major.
# Usage: .\scripts\suggest-next-version.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$VersionFile = Join-Path (Join-Path $RepoRoot "backend") "VERSION"

if (-not (Test-Path $VersionFile)) {
    Write-Host "Aktuell: (VERSION-Datei nicht gefunden)"
    Write-Host "Vorschlaege: Bitte backend/VERSION anlegen (z.B. 1.0.0)"
    exit 0
}

$Current = (Get-Content $VersionFile -Raw).Trim()
$Base = $Current
$Suffix = ""
if ($Current -match "^(.*)-(.+)$") {
    $Base = $Matches[1]
    $Suffix = "-" + $Matches[2]
}

$Major = 0
$Minor = 0
$Patch = 0
if ($Base -match "^(\d+)\.(\d+)\.(\d+)$") {
    $Major = [int]$Matches[1]
    $Minor = [int]$Matches[2]
    $Patch = [int]$Matches[3]
}

$Bump = "patch"
$GitDir = Join-Path $RepoRoot ".git"
if (Test-Path $GitDir) {
    Push-Location $RepoRoot
    try {
        $Commits = git log --oneline -50 2>$null
        if ($Commits) {
            if ($Commits | Select-String -Pattern "BREAKING|breaking|!:" -Quiet) { $Bump = "major" }
            elseif ($Commits | Select-String -Pattern "feat!?|feature!?" -Quiet) { $Bump = "minor" }
            elseif ($Commits | Select-String -Pattern "feat:|feature:" -Quiet) { $Bump = "minor" }
        }
    } finally {
        Pop-Location
    }
}

$PatchNext = "$Major.$Minor.$($Patch + 1)$Suffix"
$MinorNext = "$Major.$($Minor + 1).0$Suffix"
$MajorNext = "$($Major + 1).0.0"

Write-Host "Aktuell: $Current"
Write-Host "Vorschlaege (passend zu Aenderungen):"
Write-Host "  Patch: $PatchNext"
Write-Host "  Minor: $MinorNext"
Write-Host "  Major: $MajorNext"
Write-Host ""
Write-Host "Naechste Version in backend/VERSION eintragen, dann Docker-Build ausfuehren."
