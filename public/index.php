<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quizzy Start</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css">
</head>
<body class="player-page entry-page">
    <div class="container entry-container">
        <main class="card entry-card">
            <header class="entry-header">
                <div class="brand-lockup brand-lockup-large">
                    <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                    <span class="brand-name">Quizzy</span>
                </div>
                <div class="entry-kicker">Live-Quiz beitreten</div>
                <p>PIN eingeben, Namen wählen und direkt mitspielen.</p>
            </header>

            <form action="lobby.php" method="get" class="player-entry-form">
                <div>
                    <label for="player-pin">Quiz-PIN</label>
                    <input id="player-pin" type="text" name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,6}" maxlength="6" placeholder="123456" required autofocus>
                </div>

                <div>
                    <label for="player-name">Dein Name</label>
                    <input id="player-name" type="text" name="nickname" autocomplete="nickname" maxlength="20" placeholder="Nickname" required>
                </div>

                <button type="submit" class="primary entry-submit">Quiz beitreten</button>
            </form>

            <footer class="entry-footer">
                <a href="admin/quizzes.php">Spielleiter-Login</a>
            </footer>
        </main>
    </div>
</body>
</html>
