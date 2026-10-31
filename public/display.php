<?php
$config = require __DIR__ . '/../config/config.php';
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}
$pin = trim((string) ($_GET['pin'] ?? $_SESSION['current_session_pin'] ?? ''));
$wsHost = $config['ws_host'] ?? '127.0.0.1';
$wsPort = $config['ws_port'] ?? 8081;
$wsPath = $config['ws_path'] ?? '/ws';
$phaseTimersEnabled = (bool) ($config['gameplay']['use_phase_timers'] ?? false);

if ($pin === '') {
    echo '<h1>Keine Session-PIN gefunden.</h1>';
    echo '<p><a href="admin/quizzes.php">Zur Quiz-Uebersicht</a></p>';
    exit;
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quiz â€“ PrÃ¤sentationsansicht</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css?v=20261031b">
</head>
<body class="presenter presenter-light">
    <div class="container">
        <div class="card presenter-shell">
            <a href="index.php" class="brand-lockup page-brand">
                <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                <span class="brand-name">Quizzy</span>
            </a>
            <div class="connection-message hidden" data-connection-message role="status" aria-live="polite"></div>

            <div id="display-lobby" class="panel display-lobby-panel">
                <img id="displayLobbyImage" class="quiz-lobby-image hidden" src="" alt="">
                <div class="quiz-lobby-heading">
                    <div>
                        <div class="small">Quiz</div>
                        <h1 id="displayLobbyTitle">-</h1>
                    </div>
                    <div class="status-pill" data-state="ready">Lobby</div>
                </div>
                <p id="displayLobbyDescription" class="quiz-lobby-description">Beschreibung wird geladen...</p>
                <div class="quiz-lobby-facts">
                    <div><span>PIN</span><strong><?php echo htmlspecialchars($pin); ?></strong></div>
                    <div><span>Fragen</span><strong id="displayLobbyQuestionCount">-</strong></div>
                    <div><span>Spieler</span><strong id="displayLobbyPlayerCount">0</strong></div>
                    <div><span>Spielleiter</span><strong id="displayLobbyHostName">-</strong></div>
                </div>
                <div class="quiz-waiting-notice">Bitte warten Sie, bis der Spielleiter das Quiz startet.</div>
            </div>

            <div id="display-start" class="panel quiz-start-screen hidden">
                <div class="small">Das Quiz beginnt</div>
                <h1 id="displayStartTitle">Quiz</h1>
                <p>Bereit fÃ¼r die erste Frage?</p>
            </div>

            <div id="display-question" class="hidden" style="margin-top: 16px;">
                <img id="display-question-image" class="question-media hidden" src="" alt="">
                <h2 id="display-question-text"></h2>
                <div class="small" id="display-question-type"></div>
                <div id="display-info-timer" class="timer <?php echo $phaseTimersEnabled ? '' : 'hidden'; ?>"></div>
            </div>

            <div id="display-live-tracking" class="panel hidden" aria-live="polite">
                <div class="small">Live-Antworten</div>
                <h2><span id="display-live-answered">0</span>/<span id="display-live-total">0</span> abgegeben</h2>
                <div id="display-live-correctness" class="hidden">
                    <strong id="display-live-correct">0</strong> richtig Â·
                    <strong id="display-live-incorrect">0</strong> falsch Â·
                    <strong id="display-live-pending">0</strong> offen
                </div>
                <div id="display-live-threshold" class="small"></div>
            </div>

            <div id="display-presentation" class="panel hidden">
                <div class="small">Ergebnisansicht</div>
                <h2 id="display-presentation-title"></h2>
                <div id="display-presentation-stats" class="small hidden"></div>
                <div id="display-presentation-content"></div>
            </div>

            <div id="display-result" class="hidden" style="margin-top: 16px;">
                <h2 id="display-finished-title">Richtige Antwort</h2>
                <div id="display-solution-content">
                    <div class="display-solution-grid">
                        <div class="display-solution-main">
                            <img id="display-answer-question-image" class="question-media hidden" src="" alt="">
                            <h3 id="display-answer-question-text"></h3>
                            <div class="small" id="display-answer-type"></div>
                            <ul id="display-options"></ul>
                            <div id="display-answer-timer" class="timer"></div>
                            <p id="display-correct"></p>
                            <div id="display-question-stats" class="small hidden"></div>
                        </div>
                        <aside id="display-round-summary" class="display-round-summary hidden" aria-live="polite"></aside>
                    </div>
                </div>
                <div id="display-finished-ranking" style="margin-top: 12px;"></div>
            </div>
            <section class="join-activity" aria-live="polite">
                <div class="small">Neue Beitritte</div>
                <div id="display-join-activity" class="join-activity-list"></div>
            </section>
        </div>
    </div>

    <script>
        window.WS_HOST = <?php echo json_encode($wsHost); ?>;
        window.WS_PORT = <?php echo json_encode($wsPort); ?>;
        window.WS_PATH = <?php echo json_encode($wsPath); ?>;
        window.SESSION_PIN = "<?php echo htmlspecialchars($pin); ?>";
        window.PHASE_TIMERS_ENABLED = <?php echo json_encode($phaseTimersEnabled); ?>;
    </script>
    <script src="js/status-utils.js?v=20260831b"></script>
    <script src="js/websocket-url.js?v=20261030b"></script>
    <script src="js/group-view.js?v=20261030f"></script>
    <script src="js/result-visuals.js?v=20261031a"></script>
    <script src="js/app.js?v=20261031a"></script>
    <script>
        window.addEventListener('load', function () {
            QuizApp.initDisplay(SESSION_PIN);
        });
    </script>
</body>
</html>
