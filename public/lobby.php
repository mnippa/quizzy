<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quizzy - Spieler Lobby</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; }
        .container { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 20px; backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        h1 { text-align: center; margin-bottom: 30px; }
        #playerStatus { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; text-align: center; margin-bottom: 20px; font-size: 18px; }
        #lobbyView { text-align: center; display: block; }
        #questionView, #rankingView { display: none; }
        .pin-display { background: rgba(255,255,255,0.3); padding: 20px; border-radius: 15px; font-size: 24px; font-weight: bold; margin: 20px 0; letter-spacing: 5px; }
        .nickname-input { width: 100%; padding: 15px; border: none; border-radius: 10px; font-size: 16px; margin-bottom: 20px; box-sizing: border-box; }
        .join-btn { width: 100%; padding: 15px; background: #4CAF50; color: white; border: none; border-radius: 10px; font-size: 18px; cursor: pointer; transition: background 0.3s; }
        .join-btn:hover { background: #45a049; }
        .join-btn:disabled { background: #666; cursor: not-allowed; }
        #playerCount { font-size: 24px; margin: 20px 0; font-weight: bold; }
        #playerList li { background: rgba(255,255,255,0.2); margin: 10px 0; padding: 15px; border-radius: 10px; }
        .answer-btn { width: 100%; padding: 20px; margin: 10px 0; border: none; border-radius: 15px; font-size: 18px; cursor: pointer; background: rgba(255,255,255,0.9); color: #333; transition: all 0.3s; }
        .answer-btn:hover { background: rgba(255,255,255,1); transform: translateY(-2px); }
        .answer-btn:disabled { cursor: not-allowed; opacity: 0.6; }
        #timer { font-size: 48px; font-weight: bold; color: #FF6B6B; margin: 20px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
        #questionText { font-size: 28px; margin: 30px 0; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Quizzy Spieler</h1>
        
        <div id="lobbyView">
            <div class="pin-display">PIN: <span id="sessionPin"><?php echo htmlspecialchars($_GET['pin'] ?? ''); ?></span></div>
            <div id="playerStatus">Verbinde...</div>
            
            <input type="text" id="nicknameInput" class="nickname-input" placeholder="Deinen Namen eingeben..." maxlength="20">
            <button id="joinBtn" class="join-btn">Lobby beitreten</button>
            
            <div id="playerCount">Spieler: 0</div>
            <ul id="playerList"></ul>
        </div>
        
        <div id="questionView">
            <div id="timer">15</div>
            <div id="questionText"></div>
            <div id="answerOptions"></div>
        </div>
    </div>

    <script>
        const WS_HOST = '<?php echo $_ENV['ws_host'] ?? "localhost"; ?>';
        const WS_PORT = <?php echo $_ENV['ws_port'] ?? 8080; ?>;
        const SESSION_PIN = "<?php echo htmlspecialchars($_GET['pin'] ?? ''); ?>";
    </script>
    <script src="js/app.js"></script>
    <script>
        window.addEventListener('load', function() {
            const urlParams = new URLSearchParams(window.location.search);
            const name = urlParams.get('nickname') || localStorage.getItem('quizzy_nickname') || '';
            
            if (SESSION_PIN && name) {
                document.getElementById('nicknameInput').value = name;
                localStorage.setItem('quizzy_nickname', name);
                // *** FIX: QuizApp → initPlayer ***
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
            // *** FIX: QuizApp → initPlayer ***
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
