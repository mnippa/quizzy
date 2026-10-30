<?php
$config = require __DIR__ . '/../../config/config.php';
$pdo = new PDO(
    "mysql:host={$config['db']['host']};dbname={$config['db']['dbname']};charset=utf8mb4",
    $config['db']['user'],
    $config['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

if (!empty($_POST['start_session'])) {
    $quizId = (int) ($_POST['quiz_id'] ?? 0);
    $pin = sprintf("%06d", mt_rand(0, 999999));
    $sessionColumns = $pdo->query("SHOW COLUMNS FROM sessions")->fetchAll(PDO::FETCH_COLUMN);

    if (in_array('emergency_pin', $sessionColumns, true)) {
        $emergencyPin = sprintf("%06d", mt_rand(0, 999999));
        $stmt = $pdo->prepare("INSERT INTO sessions (quiz_id, pin, emergency_pin) VALUES (?, ?, ?)");
        $stmt->execute([$quizId, $pin, $emergencyPin]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO sessions (quiz_id, pin) VALUES (?, ?)");
        $stmt->execute([$quizId, $pin]);
    }
    
    session_start();
    $_SESSION['current_session_pin'] = $pin;
   header("Location: ../host_control.php?pin=" . $pin);  // ← PIN als GET-Parameter

    exit;
}

$quizzes = $pdo->query("SELECT * FROM quizzes")->fetchAll();
?>
<!DOCTYPE html>
<html>
<head>
    <title>Quiz Manager</title>
    <link rel="stylesheet" href="../css/style.css">
</head>
<body>
<h1>Quizze</h1>
<?php foreach($quizzes as $quiz): ?>
    <div style="border:1px solid #ccc; padding:20px; margin:10px;">
        <h3><?php echo htmlspecialchars($quiz['title'] ?? $quiz['name'] ?? ('Quiz #' . $quiz['id'])); ?></h3>
        <form method="post" style="display:inline;">
            <input type="hidden" name="quiz_id" value="<?php echo $quiz['id']; ?>">
            <button name="start_session" value="1" style="background:#4CAF50;color:white;padding:10px;">Session starten</button>
        </form>
    </div>
<?php endforeach; ?>
<p><a href="../index.php">Zur Spieler-Ansicht</a></p>
</body>
</html>
