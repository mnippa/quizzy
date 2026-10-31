<?php
require __DIR__ . '/auth.php';

quizzyLogout();
header('Location: ' . quizzyLoginUrl());
exit;
