$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8081
$localUrl = "http://127.0.0.1:$port"

function Test-LocalServer {
  try {
    $response = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-PublicUrl([string]$url) {
  foreach ($attempt in 1..3) {
    try {
      Start-Sleep -Seconds 2
      $headers = @{ 'X-Pinggy-No-Screen' = '1' }
      $response = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 12
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $response.Content -match 'LiftLog') {
        return $true
      }
    } catch {}
  }
  return $false
}

function Find-Ssh {
  $candidates = @(
    'C:\Program Files\Git\usr\bin\ssh.exe',
    'C:\Windows\System32\OpenSSH\ssh.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  $command = Get-Command ssh.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

if (-not (Test-LocalServer)) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  $python = if ($pythonCommand) { $pythonCommand.Source } else { $null }
  if (-not $python) { throw 'Python was not found. Cannot start LiftLog.' }

  Write-Host 'Starting LiftLog local server...' -ForegroundColor Cyan
  Start-Process -FilePath $python -ArgumentList @('-m', 'http.server', "$port", '--bind', '0.0.0.0') -WorkingDirectory $projectRoot -WindowStyle Minimized | Out-Null

  $ready = $false
  foreach ($i in 1..20) {
    Start-Sleep -Milliseconds 300
    if (Test-LocalServer) { $ready = $true; break }
  }
  if (-not $ready) { throw 'LiftLog local server failed to start on port 8081.' }
}

$ssh = Find-Ssh
if (-not $ssh) { throw 'OpenSSH was not found.' }

# Stop previous LiftLog remote tunnels.
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*127.0.0.1:8081*' -and
    ($_.CommandLine -like '*localhost.run*' -or $_.CommandLine -like '*pinggy.io*')
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host 'Creating mobile-friendly HTTPS tunnel with Pinggy...' -ForegroundColor Cyan
Write-Host 'Keep this window open. Free tunnels expire after about 60 minutes.' -ForegroundColor DarkGray
Write-Host ''

$publicUrl = $null
$verified = $false

$sshArgs = @(
  '-p', '443',
  '-T',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=NUL',
  '-o', 'LogLevel=ERROR',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ExitOnForwardFailure=yes',
  '-R0:127.0.0.1:8081',
  'free.pinggy.io'
)

& $ssh @sshArgs 2>&1 | ForEach-Object {
  $line = [string]$_

  if (-not $publicUrl -and $line -match 'https://[a-zA-Z0-9-]+\.run\.pinggy-free\.link') {
    $publicUrl = $matches[0]
    Write-Host "Candidate URL: $publicUrl" -ForegroundColor DarkGray

    if (Test-PublicUrl $publicUrl) {
      $verified = $true
      try { Set-Clipboard -Value $publicUrl } catch {}
      Write-Host ''
      Write-Host 'Remote access is ON and verified:' -ForegroundColor Green
      Write-Host $publicUrl -ForegroundColor Yellow
      Write-Host ''
      Write-Host 'The URL was copied to the clipboard.' -ForegroundColor Green
      Write-Host 'On iPhone, the first visit shows a Pinggy safety screen. Tap Continue once.' -ForegroundColor DarkYellow
      Write-Host 'Free Pinggy URLs expire after about 60 minutes and change after restart.' -ForegroundColor DarkYellow
      Write-Host ''
    } else {
      Write-Host 'The tunnel URL was created but public verification failed.' -ForegroundColor Red
    }
  }
}

if (-not $verified) {
  throw 'Pinggy tunnel stopped before a verified LiftLog URL became available. Run START_REMOTE_ACCESS.cmd again.'
}

throw 'The Pinggy tunnel stopped. Run START_REMOTE_ACCESS.cmd again.'
