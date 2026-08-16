# Added by claude-code on 10thAug2026 at 12:54pm GMT+3. purpose: BrainwaveLab launcher —
# starts the local static server if not already listening, then opens the app in an
# Edge app-window (falls back to default browser).
$port = 8763
$root = 'C:\OneDrive\Personal\BrainwaveLab'
$url  = "http://localhost:$port"

$listening = $null
try { $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop } catch {}
if (-not $listening) {
    Start-Process -FilePath 'python' `
        -ArgumentList '-m', 'http.server', "$port", '--directory', $root, '--bind', '127.0.0.1' `
        -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
}

try {
    Start-Process 'msedge' "--app=$url"
} catch {
    Start-Process $url
}
