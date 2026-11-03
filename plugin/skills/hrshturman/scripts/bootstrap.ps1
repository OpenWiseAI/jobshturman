# JobShturman installer for Windows.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 [SOURCE]
#
# SOURCE (or $env:HRS_SOURCE) is where hrs comes from:
#   - a URL or path to the release zip with wheels (hrshturman-<version>-wheels.zip);
#   - a folder with those wheels;
#   - a checkout of the project (a folder with hrs\pyproject.toml), installed editable.
# Without SOURCE the latest release from GitHub is installed, unless the installed hrs is already
# that version or newer (or GitHub cannot be asked: then the installed hrs is kept).
#
# Steps: install uv if missing, install hrs with its own Python 3.12, then `hrs setup`
# connects it to Claude Code and Codex and copies this skill next to them.
param([string]$Source = $env:HRS_SOURCE)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 redraws its progress bar for every downloaded block, which makes downloads
# many times slower; older Windows does not offer TLS 1.2 by default.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$SkillDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$FromPlugin = @()
if ($SkillDir -match '[\\/]\.claude[\\/]plugins[\\/]') { $FromPlugin = @('--from-plugin') }

$LogFile = Join-Path ([IO.Path]::GetTempPath()) 'jobshturman-install.log'
Set-Content -Path $LogFile -Value "JobShturman install $(Get-Date -Format s)" -ErrorAction SilentlyContinue
function Log($msg) { try { [IO.File]::AppendAllText($LogFile, "$msg`r`n", [Text.Encoding]::UTF8) } catch {} }
function Say($msg) { [Console]::Error.WriteLine("JobShturman: $msg"); Log $msg }
function Fail($msg) { Say $msg; Say "подробности в файле $LogFile"; exit 1 }
function Quote-Arg([string]$a) {
    if ($a -and $a -notmatch '[\s"]') { return $a }
    return '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
function Format-Time($span) { '{0} мин {1:d2} с' -f [int][math]::Floor($span.TotalMinutes), $span.Seconds }
function Invoke-Watched {
    # Runs a program and shows that it is alive: its output line by line and, in a silence, a timer every
    # 20 seconds. Without a console for its output uv prints plain lines instead of a redrawn bar. A program
    # silent for $StallMinutes is stopped: a person must never face an endless blank window. Returns nothing;
    # sets $script:WatchedExit and, with -KeepStdout, keeps stdout for the caller in $script:WatchedStdout.
    param([string]$Exe, [string[]]$Arguments, [switch]$KeepStdout, [int]$StallMinutes = 15)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command $Exe -ErrorAction Stop | Select-Object -First 1).Source
    $psi.Arguments = (($Arguments | ForEach-Object { Quote-Arg $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $psi.EnvironmentVariables['PYTHONUTF8'] = '1'
    $psi.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    Log "> $($psi.FileName) $($psi.Arguments)"
    $p = [Diagnostics.Process]::Start($psi)
    $p.StandardInput.Close()  # nothing may wait for an answer the person cannot see
    $streams = @(@{ Reader = $p.StandardOutput; Out = $true }, @{ Reader = $p.StandardError; Out = $false })
    foreach ($s in $streams) { $s.Task = $s.Reader.ReadLineAsync() }
    $started = Get-Date; $heard = $started; $beat = $started; $exited = $null
    $kept = New-Object Collections.Generic.List[string]
    while ($streams | Where-Object { $_.Task }) {
        $any = $false
        foreach ($s in $streams) {
            if (-not $s.Task -or -not $s.Task.IsCompleted) { continue }
            $any = $true
            $line = $null
            if (-not $s.Task.IsFaulted) { $line = $s.Task.Result }
            if ($null -eq $line) { $s.Task = $null; continue }
            $s.Task = $s.Reader.ReadLineAsync()
            if ($s.Out -and $KeepStdout) { $kept.Add($line); continue }
            if ($line.Trim()) { [Console]::Error.WriteLine("  $line"); Log $line; $heard = Get-Date }
        }
        if ($any) { continue }
        Start-Sleep -Milliseconds 200
        $now = Get-Date
        if ($p.HasExited) {
            # A leftover child can hold the pipes open for ever: do not wait for it.
            if (-not $exited) { $exited = $now }
            if (($now - $exited).TotalSeconds -gt 5) { break }
            continue
        }
        if (($now - $heard).TotalMinutes -ge $StallMinutes) {
            Log "stalled: no output for $StallMinutes min"
            if (-not ($IsLinux -or $IsMacOS)) { try { & taskkill /T /F /PID $p.Id *> $null } catch {} }
            try { $p.Kill() } catch {}
            Fail "$StallMinutes минут нет никакого движения, остановил установку. Проверьте интернет и антивирус и запустите команду ещё раз."
        }
        if (($now - $heard).TotalSeconds -ge 20 -and ($now - $beat).TotalSeconds -ge 20) {
            $beat = $now
            $msg = "всё ещё работаю, не закрывайте окно. Прошло $(Format-Time ($now - $started))"
            if (($now - $heard).TotalMinutes -ge 5) { $msg += '. Так долго бывает, когда антивирус проверяет новые файлы' }
            Say $msg
        }
    }
    $p.WaitForExit()
    $script:WatchedExit = $p.ExitCode
    $script:WatchedStdout = $kept
    Log "exit $($p.ExitCode) after $(Format-Time ((Get-Date) - $started))"
}
function Run {
    $exe, $rest = $args
    Invoke-Watched -Exe $exe -Arguments $rest
    if ($script:WatchedExit -ne 0) { Fail "$exe завершился с кодом $($script:WatchedExit)" }
}

$LocalBin = Join-Path $HOME '.local\bin'
$env:Path = "$LocalBin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Say 'шаг 1 из 3: ставлю uv, установщик программ на Python (https://astral.sh/uv)'
    Invoke-Watched -Exe powershell -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex')
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Fail 'uv не установился' }
} else {
    Say 'шаг 1 из 3: uv уже установлен'
}

function Install-Wheels($dir) {
    if (-not (Get-ChildItem -Path $dir -Filter 'hrshturman-*.whl' -ErrorAction SilentlyContinue)) {
        Fail "в $dir нет hrshturman-*.whl"
    }
    Say 'шаг 2 из 3: ставлю программу. Python 3.12 и библиотеки, около 100 МБ. В первый раз это занимает несколько минут.'
    Run uv tool install --force --python 3.12 --find-links $dir hrshturman
}

$Bin = (& uv tool dir --bin).Trim()
$Hrs = Join-Path $Bin $(if ($IsLinux -or $IsMacOS) { 'hrs' } else { 'hrs.exe' })
$Latest = 'https://github.com/ZhdanDesign/jobshturman/releases/latest/download/jobshturman-wheels.zip'
function Version-Of($text) { ([regex]'\d+(\.\d+){2,3}').Match("$text").Value }
if (-not $Source) {
    if (-not (Test-Path $Hrs)) {
        $Source = $Latest
    } else {
        $have = ''; $newest = ''
        try { $have = Version-Of (& $Hrs --version 2>$null) } catch {}
        try { $newest = Version-Of (Invoke-RestMethod -TimeoutSec 30 -Uri 'https://api.github.com/repos/ZhdanDesign/jobshturman/releases/latest').tag_name } catch {}
        if (-not $have -or ($newest -and [version]$have -lt [version]$newest)) {
            Say "обновляю программу с версии $have до $newest"
            $Source = $Latest
        }
    }
}
$Work = $null
try {
    if ($Source) {
        $Work = Join-Path ([IO.Path]::GetTempPath()) ("hrs-" + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $Work | Out-Null
        if ($Source -match '^https?://') {
            Say "скачиваю $Source"
            $zip = Join-Path $Work 'hrs.zip'
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri $Source -OutFile $zip
            $Source = $zip
        }
        if (Test-Path (Join-Path $Source 'hrs\pyproject.toml')) {
            Say "шаг 2 из 3: ставлю программу из папки проекта $Source"
            Run uv tool install --force --python 3.12 --editable (Join-Path $Source 'hrs')
        } elseif (Test-Path $Source -PathType Container) {
            Install-Wheels $Source
        } elseif (Test-Path $Source -PathType Leaf) {
            $wheels = Join-Path $Work 'wheels'
            Expand-Archive -Path $Source -DestinationPath $wheels
            Install-Wheels $wheels
        } else {
            Fail "не нашёл источник $Source"
        }
    } else {
        Say 'шаг 2 из 3: программа уже последней версии'
    }
} finally {
    if ($Work) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
}

& uv tool update-shell 2>&1 | Out-Null
Say 'шаг 3 из 3: подключаю программу к агентам и включаю расписание'
Invoke-Watched -Exe $Hrs -Arguments (@('setup', '--skill-dir', $SkillDir) + $FromPlugin) -KeepStdout
foreach ($line in $script:WatchedStdout) { [Console]::Out.WriteLine($line); Log $line }
exit $script:WatchedExit
