<?php
session_start();
$config = require __DIR__ . '/../config/config.php';

$pin = $_GET['pin'] ?? $_SESSION['current_session_pin'] ?? null;

if (!$pin) {
    echo "<h1>❌ Keine Session-PIN gefunden!</h1>";
    echo "<p><a href='../admin/quizzes.php'>Quiz auswählen und starten</a></p>";
    exit;
}

$_SESSION['current_session_pin'] = $pin;
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8" />
    <title>Quiz – Steuerung</title>
    <link rel="stylesheet" href="css/style.css" />
</head>
<body>
    <h1>Quiz – Spielleiter</h1>
    <p><strong>Session PIN:</strong> <span style="color:#4caf50; font-size:24px;"><?php echo htmlspecialchars($pin); ?></span></p>

    <div id="host-status">Verbinde...</div>

    <div id="host-controls">
        <button id="btn-start-quiz">Quiz starten</button>
        <button id="btn-start-answer" disabled>Antwortphase starten</button>
        <button id="btn-end-answer" disabled>Antwortphase beenden</button>
        <button id="btn-next-question" disabled style="background:#2196F3; color:white;">Nächste Frage</button>
    </div>

    <div id="host-info">
        <p>Aktueller Zustand: <span id="host-state">lobby</span></p>
        <p>Antworten: <span id="host-answers">0</span>/<span id="host-total">0</span></p>

        <div id="host-ranking" style="display:none; margin:20px 0; padding:20px; background:#e3f2fd; border-radius:10px; border-left:5px solid #2196F3;">
            <h3 style="margin-top:0;">🏆 Ranking</h3>
            <div id="ranking-list" style="font-size:16px;"></div>
        </div>

        <h2>Aktuelle Frage</h2>
        <div id="host-question-text" style="min-height:100px; padding:15px; background:#f5f5f5; border-radius:5px;"></div>
    </div>

    <script>
        const WS_HOST = "<?php echo $config['ws_host']; ?>";
        const WS_PORT = "<?php echo $config['ws_port']; ?>";
        const SESSION_PIN = "<?php echo htmlspecialchars($pin); ?>";
    </script>
    <script src="js/app.js"></script>
    <script>
        window.addEventListener('load', function () {
            QuizApp.initHost(SESSION_PIN);
        });
    </script>
</body>
</html>
