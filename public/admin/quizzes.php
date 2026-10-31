<?php
require __DIR__ . '/../auth.php';
quizzyRequireAuth('admin');

$config = require __DIR__ . '/../../config/config.php';
$wsHost = $config['ws_host'] ?? '127.0.0.1';
$wsPort = $config['ws_port'] ?? 8081;
$wsPath = $config['ws_path'] ?? '/ws';
$pdo = new PDO(
    "mysql:host={$config['db']['host']};dbname={$config['db']['dbname']};charset={$config['db']['charset']}",
    $config['db']['user'],
    $config['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

function ensureQuizAutomationColumns(PDO $pdo): void
{
    $columns = $pdo->query('SHOW COLUMNS FROM quizzes')->fetchAll(PDO::FETCH_COLUMN);
    $definitions = [
        'automatic_mode' => 'TINYINT(1) NOT NULL DEFAULT 0',
        'start_phase_seconds' => 'INT NOT NULL DEFAULT 2',
        'question_phase_seconds' => 'INT NOT NULL DEFAULT 2',
        'options_phase_seconds' => 'INT NOT NULL DEFAULT 2',
        'solution_phase_seconds' => 'INT NOT NULL DEFAULT 2',
    ];
    foreach ($definitions as $column => $definition) {
        if (!in_array($column, $columns, true)) {
            $pdo->exec("ALTER TABLE quizzes ADD COLUMN {$column} {$definition}");
        }
    }
}

function cloneAutomaticQuiz(PDO $pdo, int $sourceQuizId): void
{
    $sourceStatement = $pdo->prepare('SELECT title, description, image_url FROM quizzes WHERE id = ?');
    $sourceStatement->execute([$sourceQuizId]);
    $source = $sourceStatement->fetch(PDO::FETCH_ASSOC);
    if (!$source) {
        throw new RuntimeException('Quellquiz wurde nicht gefunden.');
    }

    $targetTitle = $source['title'] . ' Automatisch';
    $legacyTitle = $source['title'] . ' Automatisch (2-2-10-2)';
    $existingStatement = $pdo->prepare('SELECT id FROM quizzes WHERE title IN (?, ?) ORDER BY id LIMIT 1');
    $existingStatement->execute([$targetTitle, $legacyTitle]);
    $existingQuizId = $existingStatement->fetchColumn();
    if ($existingQuizId) {
        $renameStatement = $pdo->prepare('UPDATE quizzes SET title = ? WHERE id = ?');
        $renameStatement->execute([$targetTitle, $existingQuizId]);
        return;
    }

    $pdo->beginTransaction();
    try {
        $insertQuiz = $pdo->prepare(
            'INSERT INTO quizzes (title, description, image_url, automatic_mode, start_phase_seconds, question_phase_seconds, options_phase_seconds, solution_phase_seconds) VALUES (?, ?, ?, 1, 2, 2, 2, 2)'
        );
        $insertQuiz->execute([$targetTitle, $source['description'], $source['image_url']]);
        $targetQuizId = (int) $pdo->lastInsertId();

        $questionStatement = $pdo->prepare(
            'SELECT id, question_text, image_url, position, text, question_type, correct_option_index, answer_payload, points_max, points_min, points_delay FROM questions WHERE quiz_id = ? ORDER BY position, id'
        );
        $questionStatement->execute([$sourceQuizId]);
        $questions = $questionStatement->fetchAll(PDO::FETCH_ASSOC);

        $insertQuestion = $pdo->prepare(
            'INSERT INTO questions (quiz_id, question_text, image_url, position, text, question_type, correct_option_index, answer_payload, time_limit, points_max, points_min, points_delay, points_decay_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, 10)'
        );
        $optionStatement = $pdo->prepare(
            'SELECT option_text, option_index FROM question_options WHERE question_id = ? ORDER BY option_index'
        );
        $insertOption = $pdo->prepare(
            'INSERT INTO question_options (question_id, option_text, option_index) VALUES (?, ?, ?)'
        );

        foreach ($questions as $question) {
            $insertQuestion->execute([
                $targetQuizId,
                $question['question_text'],
                $question['image_url'],
                $question['position'],
                $question['text'],
                $question['question_type'],
                $question['correct_option_index'],
                $question['answer_payload'],
                $question['points_max'],
                $question['points_min'],
                $question['points_delay'],
            ]);
            $targetQuestionId = (int) $pdo->lastInsertId();

            $optionStatement->execute([$question['id']]);
            foreach ($optionStatement->fetchAll(PDO::FETCH_ASSOC) as $option) {
                $insertOption->execute([$targetQuestionId, $option['option_text'], $option['option_index']]);
            }
        }

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

ensureQuizAutomationColumns($pdo);

$statusFilter = strtolower(trim((string) ($_GET['status'] ?? 'all')));
if (!in_array($statusFilter, ['all', 'open', 'closed'], true)) {
    $statusFilter = 'all';
}
$searchQuery = trim((string) ($_GET['q'] ?? ''));

function dashboardRedirect(string $statusFilter, string $searchQuery): void
{
    $target = 'quizzes.php';
    $query = [];
    if ($statusFilter !== 'all') {
        $query['status'] = $statusFilter;
    }
    if ($searchQuery !== '') {
        $query['q'] = $searchQuery;
    }
    if ($query) {
        $target .= '?' . http_build_query($query);
    }

    header('Location: ' . $target);
    exit;
}

function clearQuizResults(PDO $pdo, int $quizId): void
{
    $pdo->beginTransaction();
    try {
        $deleteResults = $pdo->prepare(
            "DELETE FROM session_results WHERE session_pin IN (SELECT pin FROM sessions WHERE quiz_id = ?)"
        );
        $deleteResults->execute([$quizId]);

        $deleteReviews = $pdo->prepare(
            "DELETE FROM short_text_reviews WHERE session_pin IN (SELECT pin FROM sessions WHERE quiz_id = ?)"
        );
        $deleteReviews->execute([$quizId]);

        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function createQuizSession(PDO $pdo, int $quizId): array
{
    $quizStatement = $pdo->prepare('SELECT id FROM quizzes WHERE id = ? LIMIT 1');
    $quizStatement->execute([$quizId]);
    if (!$quizStatement->fetchColumn()) {
        throw new RuntimeException('Das ausgewaehlte Quiz wurde nicht gefunden.');
    }

    $insertSession = $pdo->prepare('INSERT INTO sessions (quiz_id, pin, host_token_hash) VALUES (?, ?, ?)');
    for ($attempt = 0; $attempt < 20; $attempt++) {
        $pin = sprintf('%06d', random_int(0, 999999));
        $hostToken = bin2hex(random_bytes(32));
        $hostTokenHash = hash('sha256', $hostToken);
        try {
            $insertSession->execute([$quizId, $pin, $hostTokenHash]);
            return ['pin' => $pin, 'host_token' => $hostToken];
        } catch (PDOException $error) {
            if ($error->getCode() !== '23000') {
                throw $error;
            }
        }
    }

    throw new RuntimeException('Es konnte keine freie Session-PIN erzeugt werden.');
}

if ($_POST['close_session'] ?? null) {
    $pin = trim((string) ($_POST['pin'] ?? ''));
    if ($pin !== '') {
        $stmt = $pdo->prepare("UPDATE sessions SET state = 'endresult' WHERE pin = ?");
        $stmt->execute([$pin]);

        if (($_SESSION['current_session_pin'] ?? null) === $pin) {
            unset($_SESSION['current_session_pin']);
        }
        unset($_SESSION['quizzy_host_tokens'][$pin]);
    }

    dashboardRedirect($statusFilter, $searchQuery);
}

if ($_POST['delete_results'] ?? null) {
    $quizId = (int) ($_POST['quiz_id'] ?? 0);
    if ($quizId > 0) {
        clearQuizResults($pdo, $quizId);
    }

    dashboardRedirect($statusFilter, $searchQuery);
}

if ($_POST['clone_automatic'] ?? null) {
    $quizId = (int) ($_POST['quiz_id'] ?? 0);
    if ($quizId > 0) {
        cloneAutomaticQuiz($pdo, $quizId);
    }

    dashboardRedirect($statusFilter, $searchQuery);
}

if ($_POST['update_automation'] ?? null) {
    $quizId = (int) ($_POST['quiz_id'] ?? 0);
    $automaticMode = (int) ($_POST['automatic_mode'] ?? 0) === 1 ? 1 : 0;
    $startSeconds = max(1, min(300, (int) ($_POST['start_seconds'] ?? 2)));
    $questionSeconds = max(1, min(300, (int) ($_POST['question_seconds'] ?? 2)));
    $optionsSeconds = max(1, min(300, (int) ($_POST['options_seconds'] ?? 2)));
    $answerSeconds = max(1, min(300, (int) ($_POST['answer_seconds'] ?? 10)));
    $solutionSeconds = max(1, min(300, (int) ($_POST['solution_seconds'] ?? 2)));
    if ($quizId > 0) {
        $pdo->beginTransaction();
        try {
            $updateQuiz = $pdo->prepare(
                'UPDATE quizzes SET automatic_mode = ?, start_phase_seconds = ?, question_phase_seconds = ?, options_phase_seconds = ?, solution_phase_seconds = ? WHERE id = ?'
            );
            $updateQuiz->execute([$automaticMode, $startSeconds, $questionSeconds, $optionsSeconds, $solutionSeconds, $quizId]);
            $updateQuestions = $pdo->prepare(
                'UPDATE questions SET time_limit = ?, points_decay_time = ? WHERE quiz_id = ?'
            );
            $updateQuestions->execute([$answerSeconds, $answerSeconds, $quizId]);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    dashboardRedirect($statusFilter, $searchQuery);
}

if (($_POST['start_session'] ?? null) !== null) {
    $quizId = (int) ($_POST['quiz_id'] ?? 0);
    if ($quizId <= 0) {
        dashboardRedirect($statusFilter, $searchQuery);
    }

    // Ergebnisse bleiben bis zur naechsten Oeffnung sichtbar und werden beim Oeffnen zurueckgesetzt.
    clearQuizResults($pdo, $quizId);
    $createdSession = createQuizSession($pdo, $quizId);
    $pin = $createdSession['pin'];
    
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }
    $_SESSION['current_session_pin'] = $pin;
    $_SESSION['quizzy_host_tokens'][$pin] = $createdSession['host_token'];
    header("Location: ../host_control.php?pin=" . $pin);

    exit;
}

$quizSql = "
    SELECT
        q.id,
        q.title,
        q.description,
        q.automatic_mode,
        q.start_phase_seconds,
        q.question_phase_seconds,
        q.options_phase_seconds,
        q.solution_phase_seconds,
        MIN(que.time_limit) AS answer_phase_seconds,
        COUNT(que.id) AS question_count,
        (
            SELECT s.pin
            FROM sessions s
            WHERE s.quiz_id = q.id AND s.state NOT IN ('finished', 'endresult')
            ORDER BY s.created_at DESC
            LIMIT 1
        ) AS open_pin,
        (
            SELECT s.state
            FROM sessions s
            WHERE s.quiz_id = q.id AND s.state NOT IN ('finished', 'endresult')
            ORDER BY s.created_at DESC
            LIMIT 1
        ) AS open_state,
        (
            SELECT s.pin
            FROM sessions s
            WHERE s.quiz_id = q.id
            ORDER BY s.created_at DESC
            LIMIT 1
        ) AS latest_pin,
        (
            SELECT s.state
            FROM sessions s
            WHERE s.quiz_id = q.id
            ORDER BY s.created_at DESC
            LIMIT 1
        ) AS latest_state
    FROM quizzes q
    LEFT JOIN questions que ON que.quiz_id = q.id
    WHERE (:search = '' OR q.title LIKE :search_pattern OR q.description LIKE :search_pattern)
    GROUP BY q.id, q.title, q.description, q.automatic_mode, q.start_phase_seconds,
        q.question_phase_seconds, q.options_phase_seconds, q.solution_phase_seconds
    ORDER BY q.id DESC
";
$quizStatement = $pdo->prepare($quizSql);
$quizStatement->execute([
    'search' => $searchQuery,
    'search_pattern' => '%' . $searchQuery . '%',
]);
$quizzes = $quizStatement->fetchAll();
$searchSuffix = $searchQuery === '' ? '' : '&q=' . rawurlencode($searchQuery);
?>
<!DOCTYPE html>
<html>
<head>
    <title>Spielleiter Dashboard</title>
    <link rel="icon" href="../assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="../css/style.css">
</head>
<body class="host-page">
<div class="container">
    <div class="card">
        <div class="shell-header">
            <div>
                <a href="../index.php" class="brand-lockup page-brand">
                    <img class="brand-mark" src="../assets/quizzy-mark.svg" alt="">
                    <span class="brand-name">Quizzy</span>
                </a>
                <div class="small">Steuerung und Verwaltung</div>
                <div class="hero" style="font-size: 38px;">Spielleiter Dashboard</div>
            </div>
            <a href="../index.php" class="button ghost">Zur Spieler-Ansicht</a>
        </div>

        <div class="panel dashboard-filters">
            <div class="dashboard-status-filter">
                <div class="small">Status</div>
                <div class="filter-chips">
                    <a href="quizzes.php?<?php echo $searchQuery === '' ? '' : 'q=' . rawurlencode($searchQuery); ?>" class="filter-chip <?php echo $statusFilter === 'all' ? 'active' : ''; ?>">Alle</a>
                    <a href="quizzes.php?status=open<?php echo $searchSuffix; ?>" class="filter-chip <?php echo $statusFilter === 'open' ? 'active' : ''; ?>">Offen</a>
                    <a href="quizzes.php?status=closed<?php echo $searchSuffix; ?>" class="filter-chip <?php echo $statusFilter === 'closed' ? 'active' : ''; ?>">Geschlossen</a>
                </div>
            </div>
            <form method="get" class="dashboard-search" role="search">
                <?php if ($statusFilter !== 'all'): ?>
                    <input type="hidden" name="status" value="<?php echo htmlspecialchars($statusFilter); ?>">
                <?php endif; ?>
                <label for="quiz-search">Quiz durchsuchen</label>
                <div class="dashboard-search-controls">
                    <input id="quiz-search" type="search" name="q" value="<?php echo htmlspecialchars($searchQuery); ?>" placeholder="Titel oder Beschreibung">
                    <button type="submit" class="secondary">Suchen</button>
                    <a id="clear-quiz-search" href="quizzes.php<?php echo $statusFilter === 'all' ? '' : '?status=' . rawurlencode($statusFilter); ?>" class="button ghost<?php echo $searchQuery === '' ? ' hidden' : ''; ?>">Löschen</a>
                </div>
            </form>
        </div>

        <div class="quiz-grid">
        <?php $visibleQuizCount = 0; ?>
        <?php foreach($quizzes as $quiz): ?>
            <?php $isOpen = !empty($quiz['open_pin']); ?>
            <?php $hasLatestSession = !empty($quiz['latest_pin']); ?>
            <?php if ($statusFilter === 'open' && !$isOpen) { continue; } ?>
            <?php if ($statusFilter === 'closed' && $isOpen) { continue; } ?>
            <?php $visibleQuizCount++; ?>
            <article class="quiz-card">
                <div class="quiz-card-header">
                    <span class="status-pill" data-state="<?php echo $isOpen ? 'ready' : 'finished'; ?>">
                        <?php echo $isOpen ? 'Offen' : 'Geschlossen'; ?>
                    </span>
                    <span class="quiz-question-count"><?php echo (int) $quiz['question_count']; ?> Fragen</span>
                </div>
                <div class="quiz-card-content">
                    <h2><?php echo htmlspecialchars($quiz['title']); ?></h2>
                    <p><?php echo htmlspecialchars($quiz['description'] ?? ''); ?></p>
                </div>
                <?php if ($isOpen || $hasLatestSession): ?>
                    <div class="quiz-pin">
                        <span><?php echo $isOpen ? 'Aktuelle PIN' : 'Letzte PIN'; ?></span>
                        <strong><?php echo htmlspecialchars($isOpen ? $quiz['open_pin'] : $quiz['latest_pin']); ?></strong>
                    </div>
                <?php endif; ?>
                <div class="quiz-card-actions">
                    <?php if ($isOpen): ?>
                        <a href="../host_control.php?pin=<?php echo rawurlencode($quiz['open_pin']); ?>" class="button secondary">Betreten</a>
                        <button type="button" class="danger" onclick="closeOpenSession('<?php echo htmlspecialchars($quiz['open_pin'], ENT_QUOTES); ?>')">Schließen</button>
                        <form id="fallback-close-<?php echo htmlspecialchars($quiz['open_pin'], ENT_QUOTES); ?>" method="post" style="display:none;">
                            <input type="hidden" name="pin" value="<?php echo htmlspecialchars($quiz['open_pin']); ?>">
                            <button name="close_session" value="1" class="danger">Schließen</button>
                        </form>
                    <?php else: ?>
                        <a href="quiz_edit.php?quiz_id=<?php echo (int) $quiz['id']; ?>" class="button ghost">Fragen bearbeiten</a>
                        <?php if ($hasLatestSession): ?>
                            <a href="../host_control.php?pin=<?php echo rawurlencode($quiz['latest_pin']); ?>" class="button secondary">Ergebnisse ansehen</a>
                        <?php endif; ?>
                        <form method="post" onsubmit="return confirm('Ergebnisse dieses Quiz wirklich löschen?');">
                            <input type="hidden" name="quiz_id" value="<?php echo (int) $quiz['id']; ?>">
                            <button name="delete_results" value="1" class="ghost">Ergebnisse löschen</button>
                        </form>
                        <form method="post">
                            <input type="hidden" name="quiz_id" value="<?php echo (int) $quiz['id']; ?>">
                            <button name="start_session" value="1" class="primary">Öffnen</button>
                        </form>
                        <form method="post" class="quiz-automation-form">
                            <input type="hidden" name="quiz_id" value="<?php echo (int) $quiz['id']; ?>">
                            <label class="automation-mode-field">
                                Modus
                                <select name="automatic_mode">
                                    <option value="0"<?php echo !(bool) $quiz['automatic_mode'] ? ' selected' : ''; ?>>Manuell</option>
                                    <option value="1"<?php echo (bool) $quiz['automatic_mode'] ? ' selected' : ''; ?>>Automatisch</option>
                                </select>
                            </label>
                            <?php foreach ([
                                'start_seconds' => ['Start', $quiz['start_phase_seconds'] ?? 2],
                                'question_seconds' => ['Frage', $quiz['question_phase_seconds'] ?? 2],
                                'options_seconds' => ['Optionen', $quiz['options_phase_seconds'] ?? 2],
                                'answer_seconds' => ['Antwort', $quiz['answer_phase_seconds'] ?? 10],
                                'solution_seconds' => ['Loesung', $quiz['solution_phase_seconds'] ?? 2],
                            ] as $fieldName => [$fieldLabel, $fieldValue]): ?>
                                <label>
                                    <?php echo $fieldLabel; ?>
                                    <input type="number" name="<?php echo $fieldName; ?>" min="1" max="300" value="<?php echo (int) $fieldValue; ?>">
                                </label>
                            <?php endforeach; ?>
                            <button name="update_automation" value="1" class="secondary">Ablauf speichern</button>
                        </form>
                        <?php if (!(bool) $quiz['automatic_mode']): ?>
                            <form method="post">
                                <input type="hidden" name="quiz_id" value="<?php echo (int) $quiz['id']; ?>">
                                <button name="clone_automatic" value="1" class="secondary">Automatik-Klon 2-2-10-2</button>
                            </form>
                        <?php endif; ?>
                    <?php endif; ?>
                </div>
            </article>
        <?php endforeach; ?>
            <?php if ($visibleQuizCount === 0): ?>
                <div class="quiz-empty-state">
                    <h2>Keine Quizze gefunden</h2>
                    <p>
                        <?php if ($searchQuery !== ''): ?>
                            Für „<?php echo htmlspecialchars($searchQuery); ?>“ gibt es in diesem Status keine Treffer.
                        <?php else: ?>
                            In diesem Status sind aktuell keine Quizze vorhanden.
                        <?php endif; ?>
                    </p>
                </div>
            <?php endif; ?>
            </div>

    </div>
</div>

<script>
    const DASHBOARD_WS_HOST = <?php echo json_encode($wsHost); ?>;
    const DASHBOARD_WS_PORT = <?php echo json_encode($wsPort); ?>;
    const DASHBOARD_WS_PATH = <?php echo json_encode($wsPath); ?>;
    const dashboardSearchForm = document.querySelector('.dashboard-search');
    const dashboardSearchInput = document.getElementById('quiz-search');
    const dashboardSearchClear = document.getElementById('clear-quiz-search');
    const dashboardQuizGrid = document.querySelector('.quiz-grid');
    const dashboardStatus = <?php echo json_encode($statusFilter); ?>;
    let dashboardSearchTimer;
    let dashboardSearchRequest;

    function dashboardSearchUrl(searchQuery) {
        const url = new URL('quizzes.php', window.location.href);
        if (dashboardStatus !== 'all') {
            url.searchParams.set('status', dashboardStatus);
        }
        if (searchQuery) {
            url.searchParams.set('q', searchQuery);
        }
        return url;
    }

    function updateDashboardFilterLinks(searchQuery) {
        document.querySelectorAll('.filter-chip').forEach((link) => {
            const url = new URL(link.href, window.location.href);
            if (searchQuery) {
                url.searchParams.set('q', searchQuery);
            } else {
                url.searchParams.delete('q');
            }
            link.href = url.pathname.split('/').pop() + url.search;
        });
        dashboardSearchClear.classList.toggle('hidden', searchQuery === '');
    }

    async function updateDashboardResults() {
        const searchQuery = dashboardSearchInput.value.trim();
        const url = dashboardSearchUrl(searchQuery);

        if (dashboardSearchRequest) {
            dashboardSearchRequest.abort();
        }
        dashboardSearchRequest = new AbortController();
        dashboardQuizGrid.setAttribute('aria-busy', 'true');

        try {
            const response = await fetch(url, {
                signal: dashboardSearchRequest.signal,
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!response.ok) {
                throw new Error('Suche konnte nicht geladen werden.');
            }

            const page = new DOMParser().parseFromString(await response.text(), 'text/html');
            const nextGrid = page.querySelector('.quiz-grid');
            if (!nextGrid) {
                throw new Error('Suchergebnis ist unvollständig.');
            }

            dashboardQuizGrid.innerHTML = nextGrid.innerHTML;
            window.history.replaceState({}, '', url);
            updateDashboardFilterLinks(searchQuery);
        } catch (error) {
            if (error.name !== 'AbortError') {
                dashboardSearchForm.submit();
            }
        } finally {
            dashboardQuizGrid.removeAttribute('aria-busy');
        }
    }

    dashboardSearchInput.addEventListener('input', () => {
        window.clearTimeout(dashboardSearchTimer);
        dashboardSearchTimer = window.setTimeout(updateDashboardResults, 250);
    });

    dashboardSearchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        window.clearTimeout(dashboardSearchTimer);
        updateDashboardResults();
    });

    dashboardSearchClear.addEventListener('click', (event) => {
        event.preventDefault();
        dashboardSearchInput.value = '';
        updateDashboardResults();
        dashboardSearchInput.focus();
    });

    function submitFallbackClose(pin) {
        const form = document.getElementById('fallback-close-' + pin);
        if (!form) return;

        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'close_session';
        hidden.value = '1';
        form.appendChild(hidden);
        form.submit();
    }

    function closeOpenSession(pin) {
        if (!pin) {
            return;
        }
        submitFallbackClose(pin);
    }
</script>
</body>
</html>
