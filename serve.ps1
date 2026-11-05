# Minimal static file server for this folder.
# Default: this computer only. Add -Lan so a tablet on the same home network can connect.
param(
  [int]$Port = 8765,
  [switch]$Lan
)

$root = [IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd('\') + '\'
$contentTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
}

function Send-Response($stream, [string]$status, [string]$type, [byte[]]$body) {
  $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

$address = if ($Lan) { [Net.IPAddress]::Any } else { [Net.IPAddress]::Loopback }
$listener = New-Object Net.Sockets.TcpListener($address, $Port)
$listener.Start()
Write-Output "Serving $root on http://localhost:$Port/"
if ($Lan) {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Write-Output "On the tablet, open http://$($_.IPAddress):$Port/" }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      # Browsers open idle spare connections; without a timeout one would block this single-threaded loop.
      $client.ReceiveTimeout = 300
      $stream = $client.GetStream()
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      while ($true) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) { break }
      }
      $parts = "$requestLine" -split ' '
      $notFound = [Text.Encoding]::UTF8.GetBytes('Not found')
      if ($parts.Count -lt 2 -or $parts[0] -ne 'GET') {
        Send-Response $stream '405 Method Not Allowed' 'text/plain' $notFound
        continue
      }
      $relative = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0]).TrimStart('/')
      if ($relative -eq '') { $relative = 'index.html' }
      $fullPath = [IO.Path]::GetFullPath((Join-Path $root $relative))
      $extension = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $isInside = $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
      if ($isInside -and $contentTypes.ContainsKey($extension) -and [IO.File]::Exists($fullPath)) {
        Send-Response $stream '200 OK' $contentTypes[$extension] ([IO.File]::ReadAllBytes($fullPath))
      } else {
        Send-Response $stream '404 Not Found' 'text/plain' $notFound
      }
    } catch {
      Write-Output "Request failed: $($_.Exception.Message)"
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
