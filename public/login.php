<?php
require __DIR__ . '/auth.php';

$next = $_GET['next'] ?? $_POST['next'] ?? '/';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = (string) ($_POST['password'] ?? '');

    if (quizzyCheckAdminCredentials($username, $password)) {
        quizzyLogin('admin', $username);

        $isExternalUrl = is_string($next) && preg_match('#^https?://#i', $next) === 1;
        if (!is_string($next) || $next === '' || $isExternalUrl) {
            $next = quizzyPublicBasePath() . '/admin/quizzes.php';
        }

        header('Location: ' . $next);
        exit;
    }

    $error = 'Login fehlgeschlagen. Bitte Zugangsdaten prüfen.';
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quizzy Login</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css">
</head>
<body class="host-page login-page">
    <div class="container login-container">
        <main class="card login-card">
            <a href="index.php" class="brand-lockup brand-lockup-large login-brand" aria-label="Zur Quizzy-Startseite">
                <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                <span class="brand-name">Quizzy</span>
            </a>
            <h1>Spielleiter-Login</h1>
            <p class="small">Zum Vorbereiten und Steuern deiner Quizze anmelden.</p>

            <?php if ($error): ?>
                <div class="panel" style="border:1px solid #ef4444; color:#991b1b; background:#fef2f2;">
                    <?php echo htmlspecialchars($error); ?>
                </div>
            <?php endif; ?>

            <form method="post" class="login-form">
                <input type="hidden" name="next" value="<?php echo htmlspecialchars((string) $next); ?>">

                <label for="username">Benutzername</label>
                <input id="username" name="username" type="text" required autocomplete="username" />

                <label for="password">Passwort</label>
                <input id="password" name="password" type="password" required autocomplete="current-password" />

                <button type="submit" class="primary">Anmelden</button>
            </form>

            <a href="index.php" class="login-back-link">Als Spieler beitreten</a>
        </main>
    </div>
</body>
</html>
