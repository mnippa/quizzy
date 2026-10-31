<?php
$config = require __DIR__ . '/../config/config.php';
$baseUrl = 'http://127.0.0.1:8000';
$pin = '123456';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Quizzy Demo-Setup</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="hero">🧪 Quizzy Demo-Setup</div>
            <p>Diese Demo ist für ein lokales Testspiel gedacht. Die Daten sind bewusst simpel und plausibel.</p>

            <div class="panel" style="margin-top: 16px;">
                <h3>Demo PIN</h3>
                <div class="hero" style="font-size: 42px;">123456</div>
            </div>

            <div class="grid two" style="margin-top: 16px;">
                <div class="panel">
                    <h3>Spieler (Handy)</h3>
                    <p><a href="<?php echo $baseUrl; ?>/lobby.php?pin=123456&nickname=DemoSpieler">Öffnen</a></p>
                    <p>Beispielname: DemoSpieler</p>
                </div>
                <div class="panel">
                    <h3>Host / Steuerung</h3>
                    <p><a href="<?php echo $baseUrl; ?>/host_control.php?pin=123456">Öffnen</a></p>
                    <p>Login: keine Anmeldung nötig in der Demo</p>
                </div>
            </div>

            <div class="panel" style="margin-top: 16px;">
                <h3>Präsentationsansicht</h3>
                <p><a href="<?php echo $baseUrl; ?>/display.php">Öffnen</a></p>
                <p>Diese Seite ist für den Beamer gedacht.</p>
            </div>

            <div class="panel" style="margin-top: 16px;">
                <h3>Beispiel-Fragen</h3>
                <ul>
                    <li>Was ist die Hauptstadt von Frankreich?</li>
                    <li>Wie viele Planeten hat unser Sonnensystem?</li>
                    <li>Welche Farbe entsteht aus Blau und Gelb?</li>
                </ul>
            </div>
        </div>
    </div>
</body>
</html>
