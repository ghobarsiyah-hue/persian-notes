# Polls a local dev port until it answers, then opens the app in the
# default browser — used by START-WINDOWS.bat so a non-technical user
# never has to read the vite/server console output.
#
# Connects to the loopback stacks EXPLICITLY, v6 first: vite on modern
# Node binds the IPv6 loopback ::1 (sometimes ONLY ::1). A hard-coded
# 127.0.0.1 probe would poll forever while the app is actually up — and
# a plain TcpClient.Connect('localhost',…) resolves to 127.0.0.1 first
# on this machine and gives up. So: try ::1 (v6 socket), then 127.0.0.1.
# The browser opens 'localhost' and does its own happy-eyeballs — same
# semantics as the user's tab.
#
# Bounded by MaxTries × IntervalSec (default ≈10 min) so a failed boot
# cannot leave a hidden PowerShell running forever.

param(
  [int]$Port = 5173,
  [string]$Url = "http://localhost:$Port",
  [int]$MaxTries = 300,
  [int]$IntervalSec = 2
)

for ($i = 0; $i -lt $MaxTries; $i++) {
  $open = $false
  $targets = @(
    @([System.Net.Sockets.AddressFamily]::InterNetworkV6, '::1'),
    @([System.Net.Sockets.AddressFamily]::InterNetwork, '127.0.0.1')
  )
  foreach ($t in $targets) {
    try {
      $c = New-Object Net.Sockets.TcpClient($t[0])
      $c.Connect($t[1], $Port)
      $c.Close()
      $open = $true
      break
    } catch { }
  }
  if ($open) {
    Start-Sleep -Seconds 2   # let vite settle before opening the tab
    Start-Process $Url
    exit 0
  }
  Start-Sleep -Seconds $IntervalSec
}
exit 1
