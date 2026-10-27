# Native Windows installation (PowerShell). Linux/WSL: use install.sh.
# Directories become junctions and files hardlinks, so the installed config points
# back to this repository. Use -Copy for a standalone copy instead.
param([switch]$Copy)

$ErrorActionPreference = "Stop"

$Kit  = Split-Path -Parent $PSScriptRoot
$Src  = Join-Path $Kit "config"
$Dest = Join-Path $HOME ".config\opencode"

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# V1's plugin SDK is not used by V2 local plugins. Retire only that known legacy
# dependency set; leave every other package/plugin installation untouched.
$PackageJson = Join-Path $Dest "package.json"
if ((Test-Path $PackageJson) -and
    (Get-Content -Raw $PackageJson).Contains("@opencode-ai/plugin")) {
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    foreach ($name in @("package.json", "package-lock.json", "node_modules")) {
        $path = Join-Path $Dest $name
        if (Test-Path $path) {
            $backup = "$path.bak.$stamp"
            Move-Item $path $backup
            Write-Host "legacy V1 backup: $backup"
        }
    }
}

$Files       = @("opencode.jsonc", "AGENTS.md")
$Directories = @("agents", "commands", "skills", "plugins")

foreach ($item in @($Files + $Directories)) {
    $source = Join-Path $Src $item
    $target = Join-Path $Dest $item
    $isDirectory = $Directories -contains $item

    if (Test-Path $target) {
        $existing = Get-Item -Force $target
        if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # Remove only the link, never the repository it points to.
            if ($isDirectory) {
                [IO.Directory]::Delete($target)
            } else {
                Remove-Item -LiteralPath $target -Force
            }
        } else {
            $backup = "$target.bak." + (Get-Date -Format "yyyyMMddHHmmss")
            Move-Item $target $backup
            Write-Host "backup: $backup"
        }
    }

    if ($isDirectory) {
        if ($Copy) {
            Copy-Item -Recurse -Force $source $target
        } else {
            New-Item -ItemType Junction -Path $target -Target $source | Out-Null
        }
    } else {
        if ($Copy) {
            Copy-Item -Force $source $target
        } else {
            try {
                New-Item -ItemType HardLink -Path $target -Target $source | Out-Null
            } catch {
                # Hardlinks require one NTFS volume. Copying is the safe fallback.
                Copy-Item -Force $source $target
                Write-Host "hardlink unavailable; copied: $target"
            }
        }
    }
    Write-Host "installed: $target"
}

# This file is deliberately per-machine. The shared config refers to the same
# installed path on both operating systems.
$Instructions = Join-Path $Dest "instructions"
New-Item -ItemType Directory -Force -Path $Instructions | Out-Null
$LocalFacts = Join-Path $Src "instructions\windows.local.md"
if (-not (Test-Path $LocalFacts)) {
    $LocalFacts = Join-Path $Src "instructions\windows.example.md"
    Write-Host "no windows.local.md: installing the template; fill in this machine's facts"
}
Copy-Item -Force $LocalFacts (Join-Path $Instructions "machine.md")
Write-Host "installed: $(Join-Path $Instructions 'machine.md')"

Write-Host ""
Write-Host "OpenCode V2 is required. Check with: opencode --version"
Write-Host "Connect the provider in the TUI: /connect -> OpenCode Go"
Write-Host "Verify with: opencode debug config; opencode debug agents; opencode plugin list"
Write-Host "If an editor replaces a hardlinked file on save, re-run this installer."
Write-Host "Optional flair (sound + sticker): python $Kit\scripts\flair.py setup --sticker <file>"
