<?php
$config = require __DIR__ . '/../config/config.php';
$wsHost = $config['ws_host'] ?? '127.0.0.1';
$wsPort = $config['ws_port'] ?? 8081;
$wsPath = $config['ws_path'] ?? '/ws';
$phaseTimersEnabled = (bool) ($config['gameplay']['use_phase_timers'] ?? false);
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quizzy - Spieler</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css?v=20261031b">
</head>
<body class="player-page">
    <div class="container">
        <div class="card player-shell">
            <div class="player-head">
                <div>
                    <a href="index.php" class="brand-lockup page-brand">
                        <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                        <span class="brand-name">Quizzy</span>
                    </a>
                    <div class="small">Spielerbereich</div>
                    <div class="hero">Live-Quiz</div>
                </div>
                <div class="status-pill" id="playerHeaderStatus">Verbinde...</div>
            </div>
            <div class="connection-message hidden" data-connection-message role="status" aria-live="polite"></div>

            <div id="lobbyView" class="player-stage">
                <div class="player-lobby-grid">
                    <div id="playerJoinCard" class="panel player-main-panel">
                        <div class="small">Session PIN</div>
                        <div class="hero" id="sessionPin"><?php echo htmlspecialchars($_GET['pin'] ?? ''); ?></div>
                        <div class="meta-line">Quiz: <strong id="lobbyQuizTitle">-</strong></div>
                        <div class="meta-line">Spielleiter: <strong id="lobbyHostName">-</strong></div>
                        <div class="small" style="margin-top:10px;">Bitte Nickname eingeben und der Lobby beitreten.</div>

                        <label for="nicknameInput" style="margin-top:14px;">Nickname</label>
                        <input type="text" id="nicknameInput" placeholder="Deinen Namen eingeben..." maxlength="20">
                        <button id="joinBtn" class="primary" style="width:100%;">Lobby beitreten</button>
                    </div>

                    <div id="playerLobbyCard" class="panel player-main-panel hidden">
                        <img id="playerLobbyImage" class="quiz-lobby-image hidden" src="" alt="">
                        <div class="quiz-lobby-heading">
                            <div>
                                <div class="small">Quiz</div>
                                <h1 id="lobbyQuizTitleJoined">-</h1>
                            </div>
                            <div class="status-pill" id="playerLobbyStatus">Lobby</div>
                        </div>
                        <p id="playerLobbyDescription" class="quiz-lobby-description">Beschreibung wird geladen...</p>
                        <div class="quiz-lobby-facts">
                            <div><span>PIN</span><strong id="sessionPinJoined"><?php echo htmlspecialchars($_GET['pin'] ?? ''); ?></strong></div>
                            <div><span>Fragen</span><strong id="playerLobbyQuestionCount">-</strong></div>
                            <div><span>Spieler</span><strong id="playerLobbyPlayerCount">0</strong></div>
                            <div><span>Spielleiter</span><strong id="lobbyHostNameJoined">-</strong></div>
                        </div>
                        <div id="playerLobbyMessage" class="quiz-waiting-notice">Bitte warten Sie, bis der Spielleiter das Quiz startet.</div>
                    </div>

                    <aside class="panel player-side-panel">
                        <h3 style="margin-top:0;">Teilnehmer</h3>
                        <div id="playerCount">Spieler: 0</div>
                        <label class="small participant-search-label" for="player-search">Spieler suchen</label>
                        <input type="search" id="player-search" maxlength="100" autocomplete="off" placeholder="Name eingeben">
                        <div id="player-search-count" class="small participant-search-count"></div>
                        <div class="participant-table-wrap" tabindex="0" role="region" aria-label="Teilnehmerliste">
                            <table class="participant-table">
                                <tbody id="playerList"></tbody>
                            </table>
                        </div>
                    </aside>
                </div>
            </div>

            <div id="playerStartView" class="hidden player-stage">
                <div class="panel quiz-start-screen">
                    <div class="small">Das Quiz beginnt</div>
                    <h1 id="playerStartTitle">Quiz</h1>
                    <p>Mach dich bereit. Die erste Frage wird gleich angezeigt.</p>
                </div>
            </div>

            <div id="questionView" class="hidden player-stage">
                <div class="player-question-grid">
                    <div class="panel player-question-panel">
                        <div class="status-pill" id="questionState">Frage lÃ¤uft</div>
                        <section id="player-round-panel" class="round-panel hidden" aria-live="polite" aria-label="Deine Runde"></section>
                        <section id="player-standing-panel" class="standing-panel hidden" aria-live="polite" aria-label="Gesamtstand"></section>
                        <img id="player-question-image" class="question-media hidden" src="" alt="">
                        <div class="hero" id="questionText"></div>
                        <div id="answerOptions"></div>
                        <div id="player-question-stats" class="small hidden"></div>
                    </div>

                    <aside class="panel player-question-side">
                        <div id="playerTimerPanel" class="<?php echo $phaseTimersEnabled ? '' : 'hidden'; ?>">
                            <div class="small">Verbleibende Zeit</div>
                            <div class="timer" id="timer">15</div>
                        </div>
                        <div class="meta-line">Quiz: <strong id="questionQuizTitle">-</strong></div>
                        <div class="meta-line">Spielleiter: <strong id="questionHostName">-</strong></div>
                        <div class="meta-line" id="questionPlayerCount">Spieler: 0</div>
                    </aside>
                </div>
            </div>

            <section id="player-finished-view" class="panel player-stage hidden">
                <h1>Quiz beendet</h1>
                <p id="player-finished-placement" class="own-placement" role="status"></p>
                <h2>Top 10</h2>
                <div id="player-finished-top10"></div>
                <details class="finished-ranking-details">
                    <summary>Gesamtranking anzeigen</summary>
                    <div id="player-finished-ranking" class="ranking-scroll" tabindex="0" role="region" aria-label="Gesamtranking"></div>
                </details>
            </section>
        </div>
    </div>

    <script>
        window.WS_HOST = <?php echo json_encode($wsHost); ?>;
        window.WS_PORT = <?php echo json_encode($wsPort); ?>;
        window.WS_PATH = <?php echo json_encode($wsPath); ?>;
        window.SESSION_PIN = "<?php echo htmlspecialchars($_GET['pin'] ?? ''); ?>";
        window.PHASE_TIMERS_ENABLED = <?php echo json_encode($phaseTimersEnabled); ?>;
    </script>
    <script src="js/status-utils.js?v=20260831b"></script>
    <script src="js/websocket-url.js?v=20261030b"></script>
    <script src="js/group-view.js?v=20261030f"></script>
    <script src="js/result-visuals.js?v=20261031a"></script>
    <script src="js/app.js?v=20261031a"></script>
    <script>
        window.addEventListener('load', function() {
            const urlParams = new URLSearchParams(window.location.search);
            const name = urlParams.get('nickname') || localStorage.getItem('quizzy_nickname') || '';

            if (SESSION_PIN && name) {
                document.getElementById('nicknameInput').value = name;
                localStorage.setItem('quizzy_nickname', name);
                if (typeof initPlayer === 'function') {
                    initPlayer(SESSION_PIN, name);
                }
            }
        });

        document.getElementById('joinBtn').addEventListener('click', function() {
            const nickname = document.getElementById('nicknameInput').value.trim();
            if (!nickname || !SESSION_PIN) {
                alert('Bitte Name und PIN eingeben!');
                return;
            }
            localStorage.setItem('quizzy_nickname', nickname);
            if (typeof initPlayer === 'function') {
                initPlayer(SESSION_PIN, nickname);
            }
        });

        document.getElementById('nicknameInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                document.getElementById('joinBtn').click();
            }
        });
    </script>
</body>
</html>
