<?php
$env = file_exists(__DIR__ . '/../.env') ? parse_ini_file(__DIR__ . '/../.env') : [];

return [
    'db' => [
        'host' => $env['DB_HOST'] ?? 'localhost',
        'dbname' => $env['DB_NAME'] ?? 'quizgame',
        'user' => $env['DB_USER'] ?? 'root',
        'pass' => $env['DB_PASS'] ?? '',
        'charset' => $env['DB_CHARSET'] ?? 'utf8mb4'
    ],
    'gameplay' => [
        'allow_join_after_start' => filter_var($env['ALLOW_JOIN_AFTER_START'] ?? 'false', FILTER_VALIDATE_BOOLEAN),
        'use_endresult_state' => filter_var($env['USE_ENDRESULT_STATE'] ?? 'true', FILTER_VALIDATE_BOOLEAN),
        'use_phase_timers' => filter_var($env['USE_PHASE_TIMERS'] ?? 'false', FILTER_VALIDATE_BOOLEAN)
    ],
    'auth' => [
        'admin_user' => $env['ADMIN_USER'] ?? 'admin',
        'admin_pass' => $env['ADMIN_PASS'] ?? ''
    ],
    'ws_host' => $env['WS_HOST'] ?? '127.0.0.1',
    'ws_port' => (int) ($env['WS_PORT'] ?? $env['PORT'] ?? 8081),
    'ws_path' => $env['WS_PATH'] ?? '/ws',
];
