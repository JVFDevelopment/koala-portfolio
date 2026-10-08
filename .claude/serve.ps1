# Minimal static file server for local preview (no Node/Python needed).
$root = Split-Path $PSScriptRoot -Parent
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:5500/")
$l.Start()
Write-Host "Serving $root on http://localhost:5500"
$types = @{ ".html"="text/html"; ".css"="text/css"; ".js"="text/javascript"; ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg"; ".svg"="image/svg+xml"; ".webp"="image/webp" }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if ($p -eq "") { $p = "index.html" }
  $f = Join-Path $root $p
  if (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    $ct = $types[[IO.Path]::GetExtension($f)]
    if ($ct) { $c.Response.ContentType = $ct }
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
