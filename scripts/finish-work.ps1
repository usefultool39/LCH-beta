# finish-work.ps1
# One-shot sync for lan-control-hub: D-drive work -> Desktop backup -> GitHub push.
#
# Usage (run from D:\项目\lan-control-hub):
#   .\scripts\finish-work.ps1 -Message "fix: ..."
#   .\scripts\finish-work.ps1 -Message "..." -IncludeUntracked   # also add untracked files
#   .\scripts\finish-work.ps1 -Message "..." -DryRun             # only print what would happen
#   .\scripts\finish-work.ps1 -Message "..." -SkipPush           # local sync only
#   .\scripts\finish-work.ps1 -Message "..." -PushOnly           # GitHub only
#   .\scripts\finish-work.ps1 -Message "..." -InitDesktop        # auto git clone if missing
#
# Flow:
#   1. git add -u  (tracked file changes only; untracked are ignored by default)
#      With -IncludeUntracked: git add -A
#   2. git commit -m $Message (skipped if nothing staged)
#   3. git push origin <current-branch>
#   4. Desktop backup: git pull --rebase origin <branch>
#      If Desktop is missing: depends on -InitDesktop
#
# Safety:
#   - No --force push, no --no-verify hooks skip.
#   - Aborts if Desktop backup has tracked changes (prevents silent overwrite).
#   - Untracked files on Desktop only warn (do not block sync).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [switch]$IncludeUntracked,
    [switch]$DryRun,
    [switch]$SkipPush,
    [switch]$PushOnly,
    [switch]$InitDesktop,

    # Optional override of default paths (rarely used)
    [string]$WorkDir    = 'D:\项目\lan-control-hub',
    [string]$DesktopDir = (Join-Path $env:USERPROFILE 'Desktop\lan-control-hub')
)

$ErrorActionPreference = 'Stop'

# --- 0. Force UTF-8 output (PS 5.1 default GBK garbles Chinese) ---
try {
    [Console]::OutputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding            = [System.Text.Encoding]::UTF8
    $PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
} catch { }

# All log strings are ASCII-only on purpose: PowerShell 5.1 parser has bugs
# parsing single-quoted strings that contain CJK characters adjacent to
# nested expressions. Keep CJK out of runtime string literals.

$LOG_DIR   = Join-Path $env:TEMP 'lan-control-hub-sync'
$LOG_FILE  = Join-Path $LOG_DIR ('sync-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null

function Write-Log {
    param([string]$Level, [string]$Text)
    $ts    = (Get-Date).ToString('HH:mm:ss')
    $line  = '[' + $ts + '] [' + $Level + '] ' + $Text
    $color = switch ($Level) {
        'OK'    { 'Green'  }
        'WARN'  { 'Yellow' }
        'ERR'   { 'Red'    }
        'STEP'  { 'Cyan'   }
        default { 'Gray'   }
    }
    Write-Host $line -ForegroundColor $color
    Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
}

function Invoke-Git {
    param(
        [string]$RepoPath,
        [string[]]$GitArgs,
        [string]$FailureHint = ''
    )
    $cmdLine = 'git -C "' + $RepoPath + '" ' + ($GitArgs -join ' ')
    if ($DryRun) {
        Write-Log 'STEP' ('  [dry-run] ' + $cmdLine)
        return
    }
    $output = git -C $RepoPath @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log 'ERR' ('git failed: ' + $cmdLine)
        Write-Log 'ERR' ('output: ' + $output)
        if ($FailureHint) { Write-Log 'ERR' ('hint: ' + $FailureHint) }
        throw ('git exit ' + $LASTEXITCODE)
    }
    return $output
}

# --- 0.5 Input validation ---
if (-not (Test-Path $WorkDir)) {
    Write-Log 'ERR' ('work dir not found: ' + $WorkDir)
    throw 'WorkDir missing'
}
if (-not (Test-Path (Join-Path $WorkDir '.git'))) {
    Write-Log 'ERR' ($WorkDir + ' is not a git repo')
    throw 'Not a git repo'
}

Write-Log 'STEP' ('==> work dir:  ' + $WorkDir)
Write-Log 'STEP' ('==> desktop:   ' + $DesktopDir)

# --- 1. Probe D-drive project state ---
$branch = (git -C $WorkDir rev-parse --abbrev-ref HEAD).Trim()
Write-Log 'STEP' ('    branch:    ' + $branch)

$porcelain = (git -C $WorkDir status --porcelain) -join "`n"
$hasTrackedChange = $false
$hasUntracked    = $false
if ($porcelain) {
    foreach ($line in ($porcelain -split "`n")) {
        if ($line.Length -lt 2) { continue }
        $x = $line[0]; $y = $line[1]
        if (($x -eq '?') -and ($y -eq '?')) {
            $hasUntracked = $true
        } else {
            $hasTrackedChange = $true
        }
    }
}

if ((-not $hasTrackedChange) -and (-not $hasUntracked)) {
    Write-Log 'WARN' 'working tree clean, nothing to add'
} else {
    if ($hasTrackedChange) {
        if ($IncludeUntracked) {
            Invoke-Git $WorkDir @('add','-A') 'check for files that should not be committed'
        } else {
            Invoke-Git $WorkDir @('add','-u') 'check file permissions or path issues'
        }
        Write-Log 'OK' '  staged tracked files'
    } else {
        Write-Log 'WARN' '  only untracked changes; not auto-added (use -IncludeUntracked)'
    }
    if (($hasUntracked) -and (-not $IncludeUntracked)) {
        Write-Log 'WARN' '  untracked files (will NOT be committed):'
        ($porcelain -split "`n") | Where-Object { $_.StartsWith('??') } | ForEach-Object {
            Write-Log 'WARN' ('    ' + $_)
        }
    }
}

# Re-check staged state to decide whether to commit
$stagedPorcelain = if ($DryRun) { '' } else { (git -C $WorkDir diff --cached --name-only) }
$hasStaged = [bool]$stagedPorcelain

if ($hasStaged) {
    Write-Log 'STEP' ('==> git commit -m "' + $Message + '"')
    if (-not $DryRun) {
        git -C $WorkDir commit -m $Message
        if ($LASTEXITCODE -ne 0) {
            Write-Log 'ERR' 'git commit failed'
            throw 'commit failed'
        }
    }
    Write-Log 'OK' '  commit done'
} else {
    Write-Log 'WARN' '  nothing staged, skipping commit'
}

# --- 2. Push to GitHub ---
if (-not $SkipPush) {
    Write-Log 'STEP' ('==> git push origin ' + $branch)
    Invoke-Git $WorkDir @('push','origin',$branch) 'check network / ssh key / branch protection'
    Write-Log 'OK' '  GitHub push done'
} else {
    Write-Log 'WARN' 'skip git push (SkipPush)'
}

# --- 3. Sync desktop backup ---
if (-not $PushOnly) {
    if (-not (Test-Path $DesktopDir)) {
        if ($InitDesktop) {
            Write-Log 'STEP' '==> desktop missing, auto clone'
            $originUrl = (git -C $WorkDir remote get-url origin)
            Invoke-Git (Split-Path $DesktopDir -Parent) @('clone', $originUrl, $DesktopDir) 'check ssh key / GitHub access'
            Write-Log 'OK' ('  clone done: ' + $DesktopDir)
        } else {
            Write-Log 'WARN' ('desktop missing: ' + $DesktopDir + ' (pass -InitDesktop to auto clone)')
        }
    } else {
        Write-Log 'STEP' ('==> desktop sync: ' + $DesktopDir)
        $desktopBranch = (git -C $DesktopDir rev-parse --abbrev-ref HEAD).Trim()
        if ($desktopBranch -ne $branch) {
            Write-Log 'WARN' ('  desktop branch (' + $desktopBranch + ') != work branch (' + $branch + '), still syncing origin/' + $branch)
        }

        # Tracked changes on desktop -> abort (avoid overwriting user work)
        $desktopPorcelain = if ($DryRun) { '' } else { (git -C $DesktopDir status --porcelain) -join "`n" }
        $desktopHasTracked  = $false
        $desktopHasUntracked = $false
        if ($desktopPorcelain) {
            foreach ($line in ($desktopPorcelain -split "`n")) {
                if ($line.Length -lt 2) { continue }
                $x = $line[0]; $y = $line[1]
                if (($x -eq '?') -and ($y -eq '?')) {
                    $desktopHasUntracked = $true
                } else {
                    $desktopHasTracked = $true
                }
            }
        }
        if ($desktopHasTracked) {
            Write-Log 'ERR' 'desktop backup has tracked changes, refusing to overwrite:'
            ($desktopPorcelain -split "`n") | Where-Object { -not $_.StartsWith('??') } | ForEach-Object {
                Write-Log 'ERR' ('    ' + $_)
            }
            throw 'desktop has uncommitted changes'
        }
        if ($desktopHasUntracked) {
            Write-Log 'WARN' '  desktop has untracked files (does not block sync):'
            ($desktopPorcelain -split "`n") | Where-Object { $_.StartsWith('??') } | ForEach-Object {
                Write-Log 'WARN' ('    ' + $_)
            }
        }

        Invoke-Git $DesktopDir @('fetch','origin') 'check network / ssh key'
        Invoke-Git $DesktopDir @('pull','--rebase','origin',$branch) 'git status for conflicts, then add + rebase --continue or rebase --abort'
        Write-Log 'OK' '  desktop sync done'
    }
} else {
    Write-Log 'WARN' 'skip desktop sync (PushOnly)'
}

# --- 4. Wrap up ---
$finalHead = if ($DryRun) { '(dry-run)' } else { (git -C $WorkDir rev-parse --short HEAD) }
Write-Log 'OK' ''
Write-Log 'OK' '============================================='
Write-Log 'OK' '  OK - D drive / Desktop / GitHub all in sync'
Write-Log 'OK' ('  HEAD: ' + $finalHead)
Write-Log 'OK' ('  log:  ' + $LOG_FILE)
Write-Log 'OK' '============================================='