<?php
$pin = trim((string) ($_GET['pin'] ?? ''));
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Quizzy - Session gesperrt</title>
    <link rel="icon" href="assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="css/style.css">
</head>
<body class="player-page entry-page">
    <div class="container entry-container">
        <main class="card entry-card removed-card">
            <div class="brand-lockup brand-lockup-large">
                <img class="brand-mark" src="assets/quizzy-mark.svg" alt="">
                <span class="brand-name">Quizzy</span>
            </div>
            <div class="status-pill" data-state="finished">Zugang gesperrt</div>
            <h1>Aus der Session entfernt</h1>
            <p>Du wurdest vom Spielleiter aus dieser Quiz-Session entfernt und kannst ihr aktuell nicht erneut beitreten.</p>
            <?php if ($pin !== ''): ?>
                <p class="small">Session-PIN: <strong><?php echo htmlspecialchars($pin); ?></strong></p>
            <?php endif; ?>
            <p class="small">Der Spielleiter kann die Sperre in der Teilnehmerverwaltung wieder aufheben.</p>
            <a href="index.php" class="button ghost">Zur Quizzy-Startseite</a>
        </main>
    </div>
</body>
</html>