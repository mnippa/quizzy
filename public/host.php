<?php
$pin = trim((string) ($_GET['pin'] ?? $_POST['pin'] ?? ''));

if ($pin !== '') {
    header('Location: host_control.php?pin=' . rawurlencode($pin));
    exit;
}

header('Location: admin/quizzes.php');
exit;
