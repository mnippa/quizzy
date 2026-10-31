<?php
$config = require __DIR__ . '/../config/config.php';
$wsHost = $config['ws_host'] ?? 'localhost';
$wsPort = $config['ws_port'] ?? 8080;
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>WS Debug</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="hero">🔎 WebSocket Debug</div>
            <p>Host: <?php echo htmlspecialchars($wsHost); ?> | Port: <?php echo (int) $wsPort; ?></p>
            <button onclick="testSocket()">Verbindung testen</button>
            <pre id="output" style="white-space: pre-wrap; background:#0f172a; color:#e2e8f0; padding:16px; border-radius:12px;"></pre>
        </div>
    </div>
    <script>
        function log(message) {
            const output = document.getElementById('output');
            output.textContent += message + '\n';
        }

        function testSocket() {
            const ws = new WebSocket('ws://localhost:8080');
            ws.onopen = () => {
                log('open');
                ws.close();
            };
            ws.onerror = (error) => {
                log('error: ' + JSON.stringify(error));
            };
            ws.onclose = () => {
                log('closed');
            };
        }
    </script>
</body>
</html>
