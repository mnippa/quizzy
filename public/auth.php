<?php
session_start();

function quizzyPublicBasePath() {
    $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
    $publicPos = strpos($scriptName, '/public/');

    if ($publicPos !== false) {
        return substr($scriptName, 0, $publicPos + strlen('/public'));
    }

    if (substr($scriptName, -strlen('/public')) === '/public') {
        return $scriptName;
    }

    return rtrim(dirname($scriptName), '/');
}

function quizzyLoginUrl() {
    return quizzyPublicBasePath() . '/login.php';
}

function quizzyRequireAuth($requiredRole = 'admin') {
    $role = $_SESSION['quizzy_role'] ?? null;

    if ($role !== $requiredRole) {
        $next = $_SERVER['REQUEST_URI'] ?? '';
        $location = quizzyLoginUrl() . '?next=' . rawurlencode($next);
        header('Location: ' . $location);
        exit;
    }
}

function quizzyLogin($role, $username = null) {
    $_SESSION['quizzy_role'] = $role;
    if ($username !== null && $username !== '') {
        $_SESSION['quizzy_username'] = (string) $username;
    }
}

function quizzyLogout() {
    unset($_SESSION['quizzy_role']);
    unset($_SESSION['quizzy_username']);
    unset($_SESSION['quizzy_host_tokens']);
    unset($_SESSION['current_session_pin']);
}

function quizzyCheckAdminCredentials($username, $password) {
    $config = require __DIR__ . '/../config/config.php';
    $expectedUser = (string) ($config['auth']['admin_user'] ?? 'admin');
    $expectedPass = (string) ($config['auth']['admin_pass'] ?? '');

    if ($expectedPass === '') {
        error_log('Quizzy admin login rejected: ADMIN_PASS is not configured.');
        return false;
    }

    return hash_equals($expectedUser, (string) $username) && hash_equals($expectedPass, (string) $password);
}
