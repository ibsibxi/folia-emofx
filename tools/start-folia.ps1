# 启动 Folia，并确保它【不在 DSH 的 Job Object 里】
#
# 背景：DSH 会把子进程放进一个带 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的 Job，
#       句柄一关（DSH 退出/重启）内核就杀掉整个 Job。
#       所以这里通过 explorer.exe 间接启动 —— 父进程变成 explorer，脱离 Job。
#
# 用法：
#   .\start-folia.ps1              已有实例就只报告，没有就启动
#   .\start-folia.ps1 -Restart     先关掉再重新启动
#   .\start-folia.ps1 -Restart -Wait 3   重启后等 3 秒再确认

param(
    [string]$Path = 'E:\Folia\Folia.exe',
    [switch]$Restart,
    [int]$Wait = 8
)

$ErrorActionPreference = 'Stop'

function Get-FoliaProcesses {
    Get-Process -Name 'Folia' -ErrorAction SilentlyContinue
}

function Show-State {
    param($procs)
    $main = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    $ppid = $null
    if ($main) {
        $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$($main.Id)" -ErrorAction SilentlyContinue
        $ppid = $ci.ParentProcessId
    }
    $parentName = if ($ppid) { (Get-Process -Id $ppid -ErrorAction SilentlyContinue).Name } else { '?' }
    Write-Host ("  进程数: {0}" -f ($procs | Measure-Object).Count)
    if ($main) {
        Write-Host ("  主窗口: PID {0} / 父进程 {1} ({2})" -f $main.Id, $parentName, $ppid)
        if ($parentName -eq 'explorer') {
            Write-Host '  状态: 安全（不在 DSH 的 Job 里，重启 DSH 不会关掉它）'
        } else {
            Write-Host '  状态: 注意 —— 父进程不是 explorer，可能会被 DSH 带走' -ForegroundColor Yellow
        }
    }
}

if (-not (Test-Path $Path)) {
    Write-Host "找不到 Folia: $Path" -ForegroundColor Red
    exit 1
}

$procs = Get-FoliaProcesses

if ($Restart -and $procs) {
    Write-Host '关闭现有 Folia …'
    $main = $procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($main) { $null = $main.CloseMainWindow() }

    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-FoliaProcesses)) { break }
    }
    $left = Get-FoliaProcesses
    if ($left) {
        Write-Host '  未完全退出，强制结束 …'
        $left | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    }
    $procs = $null
}

if ($procs) {
    Write-Host 'Folia 已在运行：'
    Show-State $procs
    Write-Host ''
    Write-Host '如果要重启，用: .\start-folia.ps1 -Restart'
    exit 0
}

Write-Host "通过 Explorer 启动: $Path"
# 关键：交给 explorer.exe，让 Folia 的父进程变成 explorer，从而脱离 DSH 的 Job
$null = Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$Path`"" -PassThru

# explorer 只是转发，等窗口出现
$deadline = (Get-Date).AddSeconds([Math]::Max(3, $Wait))
$main = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    $main = Get-Process -Name 'Folia' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($main) { break }
}

if ($main) {
    Start-Sleep -Milliseconds 600
    Write-Host '启动成功：'
    Show-State (Get-FoliaProcesses)
} else {
    Write-Host '进程起来了，但还没看到主窗口（可能仍在加载）。' -ForegroundColor Yellow
    Show-State (Get-FoliaProcesses)
}
