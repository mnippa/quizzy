<?php
require __DIR__ . '/auth.php';
quizzyRequireAuth('admin');

$config = require __DIR__ . '/../config/config.php';

$pin = $_GET['pin'] ?? $_SESSION['current_session_pin'] ?? null;
$hostName = $_SESSION['quizzy_username'] ?? 'Host';
$wsHost = $config['ws_host'] ?? '127.0.0.1';
$wsPort = $config['ws_port'] ?? 8081;
$wsPath = $config['ws_path'] ?? '/ws';

if (!$pin) {
    echo "<h1>âŒ Keine Session-PIN gefunden!</h1>";
    echo "<p><a href='admin/quizzes.php'>Quiz auswÃ¤hlen und starten</a></p>";
    exit;
}

if (!preg_match('/^\d{6}$/', (string) $pin)) {
    http_response_code(400);
    echo '<h1>Ungueltige Session-PIN</h1>';
    exit;
}

$pdo = new PDO(
    "mysql:host={$config['db']['host']};dbname={$config['db']['dbname']};charset={$config['db']['charset']}",
    $config['db']['user'],
    $config['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);
$sessionStatement = $pdo->prepare('SELECT host_token_hash, state FROM sessions WHERE pin = ? LIMIT 1');
$sessionStatement->execute([$pin]);
$sessionRow = $sessionStatement->fetch(PDO::FETCH_ASSOC);
if (!$sessionRow) {
    http_response_code(404);
    echo '<h1>Session nicht gefunden</h1>';
    exit;
}

$hostToken = (string) ($_SESSION['quizzy_host_tokens'][$pin] ?? '');
$storedHash = strtolower((string) ($sessionRow['host_token_hash'] ?? ''));
if ($hostToken === '' || !hash_equals($storedHash, hash('sha256', $hostToken))) {
    $hostToken = bin2hex(random_bytes(32));
    $storedHash = hash('sha256', $hostToken);
    $updateToken = $pdo->prepare('UPDATE sessions SET host_token_hash = ? WHERE pin = ?');
    $updateToken->execute([$storedHash, $pin]);
    $_SESSION['quizzy_host_tokens'][$pin] = $hostToken;
}

$_SESSION['current_session_pin'] = $pin;
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quiz â€“ Steuerung</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css?v=20261031b" />
</head>
<body class="host-page">
    <div class="container">
        <div class="card host-shell">
            <div class="shell-header">
                <div>
                    <a href="admin/quizzes.php" class="brand-lockup page-brand">
                        <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                        <span class="brand-name">Quizzy</span>
                    </a>
                    <div class="small">Spielleiter Kontrollzentrum</div>
                    <div class="hero" style="font-size: 40px;">Live Session Steuerung</div>
                </div>
                <div class="host-header-actions">
                    <a href="display.php?pin=<?php echo rawurlencode((string) $pin); ?>" class="button ghost" target="_blank" rel="noopener">Praesentation oeffnen</a>
                    <a href="admin/quizzes.php" class="button ghost">Zur Quiz-Uebersicht</a>
                    <a href="logout.php" class="button danger">Abmelden</a>
                </div>
            </div>

            <div class="host-topline">
                <div class="status-pill" id="host-status" data-state="offline">Verbinde...</div>
                <div class="host-phase-line">
                    <span class="small">Phase:</span>
                    <strong id="host-state">lobby</strong>
                    <span class="small" id="host-phase-hint">Warte auf Teilnehmende.</span>
                </div>
            </div>
            <div class="connection-message hidden" data-connection-message role="status" aria-live="polite"></div>

            <div class="host-workspace">
                <section class="panel host-actions-panel">
                    <h3 style="margin-top:0;">Ablaufsteuerung</h3>
                    <div class="small">Session PIN</div>
                    <div class="hero host-pin"><?php echo htmlspecialchars($pin); ?></div>
                    <div id="host-controls" class="host-controls-grid">
                        <button id="btn-start-quiz" class="primary">Quiz starten</button>
                        <button id="btn-show-first-question" class="primary" disabled>Erste Frage zeigen</button>
                        <button id="btn-show-options" class="secondary" disabled>AntwortmÃ¶glichkeiten zeigen</button>
                        <button id="btn-start-answer" class="secondary" disabled>Antwortphase starten</button>
                        <button id="btn-end-answer" class="ghost" disabled>Antwortphase beenden</button>
                        <button id="btn-next-question" class="primary" disabled>Naechste Frage</button>
                        <button id="btn-end-quiz" class="danger">Quiz beenden</button>
                    </div>

                    <div class="host-presentation-controls">
                        <div class="small">Ergebnisregie (Beamer &amp; SpielergerÃ¤te)</div>
                        <div class="host-controls-grid">
                            <button type="button" class="ghost" data-presentation-view="solution" disabled>LÃ¶sung &amp; Runde</button>
                            <button type="button" class="ghost" data-presentation-view="top10" disabled>Top 10 zeigen</button>
                            <button type="button" class="ghost" data-presentation-view="ranking" disabled>Gesamtstand zeigen</button>
                            <button type="button" class="ghost" data-presentation-view="free_text" disabled>Freitext</button>
                        </div>
                        <p class="small host-presentation-hint">Der Gesamtstand bleibt fÃ¼r Spieler verborgen, bis du â€žTop 10â€œ oder â€žGesamtstandâ€œ zeigst. â€žLÃ¶sung &amp; Rundeâ€œ blendet ihn wieder aus.</p>
                    </div>

                    <div class="host-meta-box">
                        <label><input id="live-tracking-enabled" type="checkbox"> Live-Antworten auf Beamer zeigen</label>
                        <label>Richtig/Falsch ab
                            <input id="live-tracking-threshold" type="number" min="1" max="1000" value="1" style="width:80px;">
                            Abgaben
                        </label>
                        <button id="btn-save-live-tracking" type="button" class="ghost">Live-Anzeige speichern</button>
                    </div>

                    <div class="host-meta-box">
                        <div>Geladenes Quiz: <strong id="host-quiz-title">-</strong></div>
                        <div>Spielleiter: <strong id="host-lobby-hostname"><?php echo htmlspecialchars($hostName); ?></strong></div>
                    </div>
                </section>

                <section class="panel host-stage-panel">
                    <div class="host-tabs" role="tablist" aria-label="Fragenansicht">
                        <button type="button" class="host-tab active" data-host-tab="live">Aktuelle Frage</button>
                        <button type="button" class="host-tab" data-host-tab="preview">Fragenvorschau</button>
                    </div>
                    <div data-host-panel="live">
                        <div id="host-start-state" class="quiz-start-screen hidden">
                            <div class="small">Quiz gestartet</div>
                            <h2>Bereit fÃ¼r die erste Frage</h2>
                            <p>Die Teilnehmenden sehen noch keine Frage.</p>
                        </div>
                        <img id="host-question-image" class="question-media hidden" src="" alt="">
                        <div id="host-question-text" class="host-question-box"></div>
                        <div id="host-question-options" class="host-question-options"></div>

                        <div class="host-progress-wrap">
                            <div class="small">Antwortfortschritt</div>
                            <div class="host-progress-header">
                                <span><strong id="host-answers">0</strong>/<strong id="host-total">0</strong> abgegeben</span>
                                <span id="host-progress-percent">0%</span>
                            </div>
                            <div class="host-progress-track">
                                <div class="host-progress-fill" id="host-progress-fill"></div>
                            </div>
                            <div id="host-live-answer-stats" class="small">0 richtig Â· 0 falsch Â· 0 offen</div>
                        </div>
                        <div id="host-question-stats" class="small hidden"></div>
                        <div id="host-round-summary" class="host-round-summary hidden" aria-live="polite"></div>
                    </div>
                    <div id="host-question-preview" class="host-question-preview hidden" data-host-panel="preview"></div>
                </section>

                <aside class="panel host-side-panel">
                    <div class="host-tabs" role="tablist" aria-label="Teilnehmerverwaltung">
                        <button type="button" class="host-tab active" data-side-tab="players">Spieler <span id="host-player-count">0</span></button>
                        <button type="button" class="host-tab" data-side-tab="blocked">Gesperrt <span id="host-blocked-count">0</span></button>
                    </div>
                    <div data-side-panel="players">
                        <label class="small participant-search-label" for="host-player-search">Spieler suchen</label>
                        <input type="search" id="host-player-search" maxlength="100" autocomplete="off" placeholder="Name eingeben">
                        <div id="host-player-search-count" class="small participant-search-count"></div>
                        <div class="participant-table-wrap" tabindex="0" role="region" aria-label="Teilnehmerverwaltung">
                            <table class="participant-table participant-table-actions">
                                <tbody id="host-player-list"></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="participant-table-wrap hidden" data-side-panel="blocked">
                        <table class="participant-table participant-table-actions">
                            <tbody id="host-blocked-list"></tbody>
                        </table>
                    </div>
                </aside>
            </div>

            <div class="host-results-grid">
                <section id="host-ranking" class="panel hidden">
                    <h3 style="margin-top:0;">Ranking</h3>
                    <div id="ranking-list" class="ranking-scroll" tabindex="0" role="region" aria-label="Ranking"></div>
                </section>
                <section id="host-results" class="panel hidden">
                    <h3 style="margin-top:0;">Ergebnisse</h3>
                    <div id="results-list" class="ranking-scroll" tabindex="0" role="region" aria-label="Ergebnisse"></div>
                </section>
                <section id="review-panel" class="panel hidden">
                    <h3 style="margin-top:0;">Freitext Review</h3>
                    <p id="review-error" class="hidden" role="alert"></p>
                    <div id="review-list" class="ranking-scroll" tabindex="0" role="region" aria-label="Freitextbewertungen"></div>
                </section>
            </div>
            <section class="join-activity" aria-live="polite">
                <div class="small">Neue Beitritte</div>
                <div id="host-join-activity" class="join-activity-list"></div>
            </section>
        </div>
    </div>

    <script>
        window.WS_HOST = <?php echo json_encode($wsHost); ?>;
        window.WS_PORT = <?php echo json_encode($wsPort); ?>;
        window.WS_PATH = <?php echo json_encode($wsPath); ?>;
        window.SESSION_PIN = "<?php echo htmlspecialchars($pin); ?>";
        window.HOST_NAME = <?php echo json_encode($hostName); ?>;
        window.HOST_TOKEN = <?php echo json_encode($hostToken); ?>;
    </script>
    <script src="js/status-utils.js?v=20260831b"></script>
    <script src="js/websocket-url.js?v=20261030b"></script>
    <script src="js/group-view.js?v=20261030f"></script>
    <script src="js/result-visuals.js?v=20261031a"></script>
    <script src="js/app.js?v=20261031a"></script>
    <script>
        window.addEventListener('load', function () {
            QuizApp.initHost(SESSION_PIN, HOST_NAME, HOST_TOKEN);
        });
    </script>
</body>
</html>
