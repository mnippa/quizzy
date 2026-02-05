<?php
$config = require __DIR__ . '/../config/config.php';
// Gleiche PIN wie in host_control.php für Schritt 1
$pin = '123456';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Quiz – Anzeige</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
<h1>Quiz – Live-Anzeige</h1>

<div id="display-lobby">
    <p>PIN: <strong><?php echo $pin; ?></strong></p>
    <p>Bitte per Smartphone beitreten.</p>
</div>

<div id="display-question" style="display:none;">
    <h2 id="display-question-text"></h2>
    <div id="display-question-image-container" style="display:none;">
        <img id="display-question-image" src="" alt="Fragebild" style="max-width:100%;">
    </div>
    <div id="display-info-timer"></div>
</div>

<div id="display-answer" style="display:none;">
    <h2 id="display-answer-question-text"></h2>
    <ul id="display-options"></ul>
    <div id="display-answer-timer"></div>
</div>

<div id="display-result" style="display:none;">
    <h2>Richtige Antwort</h2>
    <p id="display-correct"></p>
</div>

<script>
    const WS_HOST = "<?php echo $config['ws_host']; ?>";
    const WS_PORT = "<?php echo $config['ws_port']; ?>";
    const SESSION_PIN = "<?php echo $pin; ?>";
</script>
<script src="js/app.js"></script>
<script>
    window.addEventListener('load', function () {
        QuizApp.initDisplay(SESSION_PIN);
    });
</script>
</body>
</html>
