<?php
$config = require __DIR__ . '/../config/config.php';
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Quiz – Beitreten</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
<h1>Live-Quiz</h1>
<form action="lobby.php" method="get">
    <label>PIN:
        <input type="text" name="pin" required>
    </label><br>
    <label>Nickname:
        <input type="text" name="nickname" required>
    </label><br>
    <button type="submit">Beitreten</button>
</form>
<p>Spielleiter? <a href="host_control.php">Zur Steuerung</a></p>
</body>
</html>
