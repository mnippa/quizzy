<?php
require __DIR__ . '/../auth.php';
quizzyRequireAuth('admin');

$config = require __DIR__ . '/../../config/config.php';
$pdo = new PDO(
    "mysql:host={$config['db']['host']};dbname={$config['db']['dbname']};charset={$config['db']['charset']}",
    $config['db']['user'],
    $config['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$quizId = isset($_GET['quiz_id']) ? (int) $_GET['quiz_id'] : 0;
$quiz = $pdo->prepare('SELECT id, title, description FROM quizzes WHERE id = ?');
$quiz->execute([$quizId]);
$quizRow = $quiz->fetch(PDO::FETCH_ASSOC);

if (!$quizRow) {
    echo '<h1>Quiz nicht gefunden</h1>';
    exit;
}

function truncateQuestionTitle(string $text, int $max = 48): string
{
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        return mb_substr($text, 0, $max - 3) . '...';
    }

    if (strlen($text) <= $max) {
        return $text;
    }

    return substr($text, 0, $max - 3) . '...';
}

function validateQuestionInput(string $text, string $questionType, int $correctOptionIndex, string $answerPayload): ?string
{
    $supportedTypes = ['single_choice', 'true_false', 'multiple_choice', 'short_text'];
    if (!in_array($questionType, $supportedTypes, true)) {
        return 'Der Fragetyp wird nicht unterstuetzt.';
    }
    if ($text === '') {
        return 'Der Fragetext darf nicht leer sein.';
    }
    if ($questionType === 'true_false' && !in_array($correctOptionIndex, [0, 1], true)) {
        return 'Wahr/Falsch erwartet den richtigen Index 0 oder 1.';
    }
    if (!in_array($questionType, ['multiple_choice', 'short_text'], true)) {
        return null;
    }

    $decodedPayload = json_decode($answerPayload, true);
    if (!is_array($decodedPayload) || $decodedPayload === []) {
        return 'Dieser Fragetyp erwartet eine nichtleere JSON-Liste als Antwort-Payload.';
    }
    if ($questionType === 'multiple_choice') {
        foreach ($decodedPayload as $index) {
            if (!is_int($index) || $index < 0) {
                return 'Multiple Choice erwartet eine Liste nichtnegativer ganzzahliger Indizes.';
            }
        }
    } else {
        foreach ($decodedPayload as $answer) {
            if (!is_string($answer) || trim($answer) === '') {
                return 'Freitext erwartet eine Liste nichtleerer Antworttexte.';
            }
        }
    }
    return null;
}

function storeUploadedImage(?array $file, string $category): ?string
{
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Das Bild konnte nicht hochgeladen werden.');
    }
    if ((int) ($file['size'] ?? 0) > 5 * 1024 * 1024) {
        throw new RuntimeException('Bilder duerfen maximal 5 MB gross sein.');
    }

    $allowedMimeTypes = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif'
    ];
    $mimeType = (new finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']);
    if (!isset($allowedMimeTypes[$mimeType])) {
        throw new RuntimeException('Erlaubt sind JPEG-, PNG-, WebP- und GIF-Bilder.');
    }

    $relativeDirectory = 'uploads/' . $category;
    $targetDirectory = __DIR__ . '/../' . $relativeDirectory;
    if (!is_dir($targetDirectory) && !mkdir($targetDirectory, 0775, true) && !is_dir($targetDirectory)) {
        throw new RuntimeException('Das Uploadverzeichnis konnte nicht erstellt werden.');
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $allowedMimeTypes[$mimeType];
    if (!move_uploaded_file((string) $file['tmp_name'], $targetDirectory . '/' . $filename)) {
        throw new RuntimeException('Das Bild konnte nicht gespeichert werden.');
    }
    return $relativeDirectory . '/' . $filename;
}

function deleteUploadedImages(array $relativePaths): void
{
    foreach ($relativePaths as $relativePath) {
        $absolutePath = __DIR__ . '/../' . $relativePath;
        if (is_file($absolutePath)) {
            unlink($absolutePath);
        }
    }
}

function deleteUnreferencedUploadedImages(PDO $pdo, array $relativePaths): void
{
    $referenceQuery = $pdo->prepare('
        SELECT
            (SELECT COUNT(*) FROM questions WHERE image_url = ?) +
            (SELECT COUNT(*) FROM question_options WHERE option_image_url = ?) AS reference_count
    ');
    $unreferencedPaths = [];
    foreach (array_values(array_unique(array_filter(array_map('strval', $relativePaths)))) as $relativePath) {
        if (!preg_match('#^uploads/(questions|options)/[a-f0-9]{32}\.(jpg|png|webp|gif)$#', $relativePath)) {
            continue;
        }
        $referenceQuery->execute([$relativePath, $relativePath]);
        if ((int) $referenceQuery->fetchColumn() === 0) {
            $unreferencedPaths[] = $relativePath;
        }
    }
    deleteUploadedImages($unreferencedPaths);
}

function normalizeTypedAnswers(string $questionType, array $post, array $optionImageUrls = []): array
{
    if ($questionType === 'short_text') {
        $answers = array_values(array_unique(array_filter(array_map(
            static fn($answer) => trim((string) $answer),
            $post['accepted_answers'] ?? []
        ), static fn($answer) => $answer !== '')));
        return [[], 0, json_encode($answers, JSON_UNESCAPED_UNICODE) ?: '[]'];
    }

    $rawOptions = $post['options'] ?? [];
    $rawAltTexts = $post['option_alt_texts'] ?? [];
    $selectedIndices = array_map('intval', $post['correct_indices'] ?? []);
    $options = [];
    $normalizedCorrectIndices = [];
    if ($questionType === 'true_false') {
        $options = [
            ['text' => 'Wahr', 'image_url' => '', 'alt_text' => ''],
            ['text' => 'Falsch', 'image_url' => '', 'alt_text' => '']
        ];
    } else {
        $rowCount = max(count($rawOptions), count($optionImageUrls), count($rawAltTexts));
        for ($index = 0; $index < $rowCount; $index++) {
            $text = trim((string) ($rawOptions[$index] ?? ''));
            $imageUrl = trim((string) ($optionImageUrls[$index] ?? ''));
            $altText = trim((string) ($rawAltTexts[$index] ?? ''));
            if ($text === '' && $imageUrl === '') {
                continue;
            }
            $newIndex = count($options);
            $options[] = ['text' => $text, 'image_url' => $imageUrl, 'alt_text' => $altText];
            if (in_array($index, $selectedIndices, true)) {
                $normalizedCorrectIndices[] = $newIndex;
            }
        }
    }
    $correctIndices = $questionType === 'true_false'
        ? array_values(array_filter($selectedIndices, static fn($index) => $index >= 0 && $index < 2))
        : $normalizedCorrectIndices;
    $correctIndices = array_values(array_unique($correctIndices));
    sort($correctIndices);
    $correctOptionIndex = $correctIndices[0] ?? -1;
    return [$options, $correctOptionIndex, json_encode($correctIndices) ?: '[]'];
}

function renderAnswerEditor(string $questionType = 'single_choice', array $options = [], string $answerPayload = '', int $correctOptionIndex = 0, array $optionImages = [], array $optionAltTexts = []): void
{
    $payload = json_decode($answerPayload, true);
    $payload = is_array($payload) ? $payload : [];
    $correctIndices = $questionType === 'multiple_choice' ? array_map('intval', $payload) : [$correctOptionIndex];
    $choiceOptions = array_pad(array_slice($options, 0, 6), 4, '');
    $acceptedAnswers = $questionType === 'short_text' ? array_pad(array_slice($payload, 0, 6), 4, '') : ['', '', '', ''];
    ?>
    <input type="hidden" name="editor_contract" value="typed">
    <div class="typed-answer-fields" data-answer-fields="choice">
        <label>Antwortoptionen und Korrektmarkierung</label>
        <?php foreach ($choiceOptions as $optionIndex => $optionText): ?>
            <div class="editor-answer-row">
                <input class="editor-correct-input" type="checkbox" name="correct_indices[]" value="<?php echo $optionIndex; ?>" <?php echo in_array($optionIndex, $correctIndices, true) ? 'checked' : ''; ?> aria-label="Antwort <?php echo $optionIndex + 1; ?> ist richtig">
                <div>
                    <input class="editor-option-input" type="text" name="options[]" value="<?php echo htmlspecialchars((string) $optionText); ?>" placeholder="Antwort <?php echo $optionIndex + 1; ?>">
                    <input class="editor-option-image" type="file" name="option_images[]" accept="image/jpeg,image/png,image/webp,image/gif">
                    <?php if (($optionImages[$optionIndex] ?? '') !== ''): ?>
                        <img class="editor-media-preview" src="../<?php echo htmlspecialchars((string) $optionImages[$optionIndex]); ?>" alt="Vorschau der Bildoption <?php echo $optionIndex + 1; ?>" tabindex="0" role="button" aria-label="Bildoption <?php echo $optionIndex + 1; ?> gross anzeigen">
                        <label><input type="checkbox" name="remove_option_images[]" value="<?php echo $optionIndex; ?>"> Bild entfernen</label>
                    <?php endif; ?>
                    <input type="text" name="option_alt_texts[]" value="<?php echo htmlspecialchars((string) ($optionAltTexts[$optionIndex] ?? '')); ?>" placeholder="Alternativtext fuer Bildoption">
                </div>
            </div>
        <?php endforeach; ?>
    </div>
    <div class="typed-answer-fields" data-answer-fields="short_text">
        <label>Akzeptierte Freitextantworten</label>
        <?php foreach ($acceptedAnswers as $answerIndex => $acceptedAnswer): ?>
            <input type="text" name="accepted_answers[]" value="<?php echo htmlspecialchars((string) $acceptedAnswer); ?>" placeholder="Akzeptierte Antwort <?php echo $answerIndex + 1; ?>">
        <?php endforeach; ?>
    </div>
    <?php
}

$formError = null;
$newQuestionInput = [
    'text' => '',
    'question_type' => 'single_choice',
    'time_limit' => 15,
    'points_max' => 100,
    'points_min' => 40,
    'points_delay' => 0,
    'points_decay_time' => 15,
    'correct_option_index' => 0,
    'answer_payload' => '',
    'options' => [],
    'image_url' => '',
    'option_images' => [],
    'option_alt_texts' => []
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $questionId = isset($_POST['question_id']) ? (int) $_POST['question_id'] : 0;
    $action = (string) ($_POST['action'] ?? 'save');

    if ($questionId > 0 && in_array($action, ['delete', 'duplicate', 'move_up', 'move_down'], true)) {
        $obsoleteMediaPaths = [];
        $pdo->beginTransaction();
        try {
            if ($action === 'delete') {
                $mediaQuery = $pdo->prepare('
                    SELECT image_url AS media_path FROM questions WHERE id = ? AND quiz_id = ?
                    UNION ALL
                    SELECT option_image_url AS media_path FROM question_options WHERE question_id = ?
                ');
                $mediaQuery->execute([$questionId, $quizId, $questionId]);
                $obsoleteMediaPaths = array_column($mediaQuery->fetchAll(PDO::FETCH_ASSOC), 'media_path');
                $pdo->prepare('DELETE FROM questions WHERE id = ? AND quiz_id = ?')->execute([$questionId, $quizId]);
            } elseif ($action === 'duplicate') {
                $positionStatement = $pdo->prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE quiz_id = ?');
                $positionStatement->execute([$quizId]);
                $newPosition = (int) $positionStatement->fetchColumn();
                $duplicate = $pdo->prepare('
                    INSERT INTO questions (
                        quiz_id, question_text, image_url, position, text, question_type,
                        correct_option_index, answer_payload, time_limit, points_max,
                        points_min, points_delay, points_decay_time
                    )
                    SELECT quiz_id, question_text, image_url, ?, text, question_type,
                        correct_option_index, answer_payload, time_limit, points_max,
                        points_min, points_delay, points_decay_time
                    FROM questions WHERE id = ? AND quiz_id = ?
                ');
                $duplicate->execute([$newPosition, $questionId, $quizId]);
                $newQuestionId = (int) $pdo->lastInsertId();
                $pdo->prepare('
                    INSERT INTO question_options (question_id, option_text, option_image_url, option_alt_text, option_index)
                    SELECT ?, option_text, option_image_url, option_alt_text, option_index
                    FROM question_options WHERE question_id = ?
                ')->execute([$newQuestionId, $questionId]);
            } else {
                $ordered = $pdo->prepare('SELECT id FROM questions WHERE quiz_id = ? ORDER BY position, id FOR UPDATE');
                $ordered->execute([$quizId]);
                $questionIds = array_map('intval', array_column($ordered->fetchAll(PDO::FETCH_ASSOC), 'id'));
                $currentIndex = array_search($questionId, $questionIds, true);
                $targetIndex = $action === 'move_up' ? $currentIndex - 1 : $currentIndex + 1;
                if ($currentIndex !== false && isset($questionIds[$targetIndex])) {
                    [$questionIds[$currentIndex], $questionIds[$targetIndex]] = [$questionIds[$targetIndex], $questionIds[$currentIndex]];
                }
                $positionUpdate = $pdo->prepare('UPDATE questions SET position = ? WHERE id = ? AND quiz_id = ?');
                foreach ($questionIds as $position => $orderedQuestionId) {
                    $positionUpdate->execute([$position + 1, $orderedQuestionId, $quizId]);
                }
            }
            $pdo->commit();
            deleteUnreferencedUploadedImages($pdo, $obsoleteMediaPaths);
            header('Location: quiz_edit.php?quiz_id=' . $quizId);
            exit;
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    }

    $text = trim($_POST['text'] ?? '');
    $questionType = trim($_POST['question_type'] ?? 'single_choice');
    $timeLimit = max(1, (int) ($_POST['time_limit'] ?? 15));
    $pointsMax = max(0, (int) ($_POST['points_max'] ?? 100));
    $pointsMin = max(0, (int) ($_POST['points_min'] ?? 40));
    $pointsDelay = max(0, (int) ($_POST['points_delay'] ?? 0));
    $pointsDecayTime = max(1, (int) ($_POST['points_decay_time'] ?? $timeLimit));
    $correctOptionIndex = isset($_POST['correct_option_index']) ? (int) $_POST['correct_option_index'] : 0;
    $answerPayload = trim($_POST['answer_payload'] ?? '');
    $questionImageUrl = '';
    $optionImageUrls = [];
    if ($questionId > 0) {
        $existingQuestion = $pdo->prepare('SELECT image_url FROM questions WHERE id = ? AND quiz_id = ?');
        $existingQuestion->execute([$questionId, $quizId]);
        $questionImageUrl = (string) ($existingQuestion->fetchColumn() ?: '');

        $existingOptions = $pdo->prepare('SELECT option_image_url FROM question_options WHERE question_id = ? ORDER BY option_index');
        $existingOptions->execute([$questionId]);
        $optionImageUrls = array_map('strval', $existingOptions->fetchAll(PDO::FETCH_COLUMN));
    }
    $persistedQuestionImageUrl = $questionImageUrl;
    $persistedOptionImageUrls = $optionImageUrls;
    if (isset($_POST['remove_image'])) {
        $questionImageUrl = '';
    }
    foreach (array_map('intval', $_POST['remove_option_images'] ?? []) as $removeOptionIndex) {
        if (array_key_exists($removeOptionIndex, $optionImageUrls)) {
            $optionImageUrls[$removeOptionIndex] = '';
        }
    }
    $newlyUploadedPaths = [];
    $uploadError = null;
    try {
        $uploadedQuestionImage = storeUploadedImage($_FILES['question_image'] ?? null, 'questions');
        if ($uploadedQuestionImage !== null) {
            $questionImageUrl = $uploadedQuestionImage;
            $newlyUploadedPaths[] = $uploadedQuestionImage;
        }
        $optionFiles = $_FILES['option_images'] ?? null;
        if (is_array($optionFiles) && isset($optionFiles['name']) && is_array($optionFiles['name'])) {
            foreach (array_keys($optionFiles['name']) as $fileIndex) {
                $file = [
                    'name' => $optionFiles['name'][$fileIndex] ?? '',
                    'type' => $optionFiles['type'][$fileIndex] ?? '',
                    'tmp_name' => $optionFiles['tmp_name'][$fileIndex] ?? '',
                    'error' => $optionFiles['error'][$fileIndex] ?? UPLOAD_ERR_NO_FILE,
                    'size' => $optionFiles['size'][$fileIndex] ?? 0
                ];
                $uploadedOptionImage = storeUploadedImage($file, 'options');
                if ($uploadedOptionImage !== null) {
                    $optionImageUrls[$fileIndex] = $uploadedOptionImage;
                    $newlyUploadedPaths[] = $uploadedOptionImage;
                }
            }
        }
    } catch (RuntimeException $error) {
        $uploadError = $error->getMessage();
    }

    $optionRows = [];
    if (($_POST['editor_contract'] ?? '') === 'typed') {
        [$optionRows, $correctOptionIndex, $answerPayload] = normalizeTypedAnswers($questionType, $_POST, $optionImageUrls);
    }
    $optionTexts = array_column($optionRows, 'text');
    $submittedQuestionInput = [
        'text' => $text,
        'question_type' => $questionType,
        'time_limit' => $timeLimit,
        'points_max' => $pointsMax,
        'points_min' => $pointsMin,
        'points_delay' => $pointsDelay,
        'points_decay_time' => $pointsDecayTime,
        'correct_option_index' => $correctOptionIndex,
        'answer_payload' => $answerPayload,
        'options' => $optionTexts,
        'image_url' => $questionImageUrl,
        'option_images' => array_column($optionRows, 'image_url'),
        'option_alt_texts' => array_column($optionRows, 'alt_text')
    ];
    if ($questionId === 0) {
        $newQuestionInput = $submittedQuestionInput;
    }
    $formError = validateQuestionInput($text, $questionType, $correctOptionIndex, $answerPayload);
    if ($uploadError !== null) {
        $formError = $uploadError;
    }
    if ($formError === null && in_array($questionType, ['single_choice', 'true_false', 'multiple_choice'], true)) {
        $correctIndices = json_decode($answerPayload, true);
        if (count($optionTexts) < 2) {
            $formError = 'Auswahlfragen benoetigen mindestens zwei Antwortoptionen.';
        } elseif (!is_array($correctIndices) || $correctIndices === []) {
            $formError = 'Mindestens eine richtige Antwort muss markiert sein.';
        } elseif ($questionType !== 'multiple_choice' && count($correctIndices) !== 1) {
            $formError = 'Dieser Fragetyp erwartet genau eine richtige Antwort.';
        }
        foreach ($optionRows as $optionRow) {
            if ($optionRow['image_url'] !== '' && $optionRow['alt_text'] === '') {
                $formError = 'Jede Bildantwort benoetigt einen Alternativtext.';
                break;
            }
        }
    }

    if ($formError !== null) {
        deleteUploadedImages($newlyUploadedPaths);
        $submittedQuestionInput['image_url'] = $persistedQuestionImageUrl;
        foreach ($submittedQuestionInput['option_images'] as $optionIndex => $_optionImageUrl) {
            $submittedQuestionInput['option_images'][$optionIndex] = $persistedOptionImageUrls[$optionIndex] ?? '';
        }
        if ($questionId === 0) {
            $newQuestionInput = $submittedQuestionInput;
        }
        http_response_code(422);
    } else {
        $pdo->beginTransaction();
        try {
            if ($questionId) {
                $stmt = $pdo->prepare('UPDATE questions SET text = ?, question_text = ?, image_url = ?, question_type = ?, time_limit = ?, points_max = ?, points_min = ?, points_delay = ?, points_decay_time = ?, correct_option_index = ?, answer_payload = ? WHERE id = ? AND quiz_id = ?');
                $stmt->execute([$text, $text, $questionImageUrl, $questionType, $timeLimit, $pointsMax, $pointsMin, $pointsDelay, $pointsDecayTime, $correctOptionIndex, $answerPayload, $questionId, $quizId]);
            } else {
                $positionStatement = $pdo->prepare('SELECT COALESCE(MAX(position), 0) + 1 FROM questions WHERE quiz_id = ?');
                $positionStatement->execute([$quizId]);
                $position = (int) $positionStatement->fetchColumn();
                $stmt = $pdo->prepare('INSERT INTO questions (quiz_id, text, image_url, question_type, time_limit, points_max, points_min, points_delay, points_decay_time, correct_option_index, answer_payload, question_text, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $stmt->execute([$quizId, $text, $questionImageUrl, $questionType, $timeLimit, $pointsMax, $pointsMin, $pointsDelay, $pointsDecayTime, $correctOptionIndex, $answerPayload, $text, $position]);
                $questionId = (int) $pdo->lastInsertId();
            }

            if (($_POST['editor_contract'] ?? '') === 'typed') {
                $pdo->prepare('DELETE FROM question_options WHERE question_id = ?')->execute([$questionId]);
                $optionInsert = $pdo->prepare('INSERT INTO question_options (question_id, option_text, option_image_url, option_alt_text, option_index) VALUES (?, ?, ?, ?, ?)');
                foreach ($optionRows as $optionIndex => $optionRow) {
                    $optionInsert->execute([$questionId, $optionRow['text'], $optionRow['image_url'], $optionRow['alt_text'], $optionIndex]);
                }
            }
            $pdo->commit();
            deleteUnreferencedUploadedImages($pdo, array_merge(
                [$persistedQuestionImageUrl],
                $persistedOptionImageUrls
            ));
        } catch (Throwable $error) {
            $pdo->rollBack();
            deleteUploadedImages($newlyUploadedPaths);
            throw $error;
        }
    }

    if ($formError === null) {
        header('Location: quiz_edit.php?quiz_id=' . $quizId);
        exit;
    }
}

$questions = $pdo->prepare('SELECT id, text, image_url, question_type, time_limit, points_max, points_min, points_delay, points_decay_time, correct_option_index, answer_payload FROM questions WHERE quiz_id = ? ORDER BY position, id');
$questions->execute([$quizId]);
$questionRows = $questions->fetchAll(PDO::FETCH_ASSOC);
$optionQuery = $pdo->prepare('SELECT option_text, option_image_url, option_alt_text, option_index FROM question_options WHERE question_id = ? ORDER BY option_index');
foreach ($questionRows as &$questionRow) {
    $optionQuery->execute([(int) $questionRow['id']]);
    $storedOptions = $optionQuery->fetchAll(PDO::FETCH_ASSOC);
    $questionRow['options'] = array_column($storedOptions, 'option_text');
    $questionRow['option_images'] = array_column($storedOptions, 'option_image_url');
    $questionRow['option_alt_texts'] = array_column($storedOptions, 'option_alt_text');
    if ($formError !== null && isset($submittedQuestionInput) && (int) $questionRow['id'] === $questionId) {
        $questionRow = array_merge($questionRow, $submittedQuestionInput);
    }
}
unset($questionRow);
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fragen bearbeiten</title>
    <link rel="icon" href="../assets/quizzy-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="../css/style.css">
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="shell-header">
                <div>
                    <a href="quizzes.php" class="brand-lockup page-brand">
                        <img class="brand-mark" src="../assets/quizzy-mark.svg" alt="">
                        <span class="brand-name">Quizzy</span>
                    </a>
                    <div class="small">Quiz Stammdatenpflege</div>
                    <div class="hero" style="font-size: 38px;">Fragen fuer <?php echo htmlspecialchars($quizRow['title']); ?></div>
                </div>
                <a href="quizzes.php" class="button ghost">Zurueck zur Quiz-Uebersicht</a>
            </div>

            <div class="editor-layout">
                <?php if ($formError !== null): ?>
                    <div class="panel" role="alert"><?php echo htmlspecialchars($formError); ?></div>
                <?php endif; ?>
                <aside class="panel question-nav">
                    <h3>Inhaltsverzeichnis</h3>
                    <a class="question-link" href="#new-question">+ Neue Frage</a>
                    <?php foreach ($questionRows as $index => $question): ?>
                        <a class="question-link" href="#question-<?php echo (int) $question['id']; ?>">
                            #<?php echo $index + 1; ?> <?php echo htmlspecialchars(truncateQuestionTitle((string) $question['text'])); ?>
                        </a>
                    <?php endforeach; ?>
                </aside>

                <div>
                    <form method="post" enctype="multipart/form-data" class="panel" id="new-question" style="margin-bottom: 20px;">
                        <input type="hidden" name="question_id" value="">
                        <h3>Neue Frage anlegen</h3>
                        <div class="tabs">
                            <button type="button" class="tab-btn active" data-target="new-base">Basis</button>
                            <button type="button" class="tab-btn" data-target="new-advanced">Advanced</button>
                        </div>
                        <div class="tab-panel active" id="new-base">
                            <label>Frage</label>
                            <textarea name="text" required style="min-height:90px;"><?php echo htmlspecialchars((string) $newQuestionInput['text']); ?></textarea>
                            <label>Fragebild (optional)</label>
                            <input type="file" name="question_image" accept="image/jpeg,image/png,image/webp,image/gif">
                            <?php if ($newQuestionInput['image_url'] !== ''): ?>
                                <img class="editor-media-preview" src="../<?php echo htmlspecialchars((string) $newQuestionInput['image_url']); ?>" alt="Vorschau des Fragebilds" tabindex="0" role="button" aria-label="Fragebild gross anzeigen">
                            <?php endif; ?>
                            <label>Fragetyp</label>
                            <select name="question_type">
                                <option value="single_choice" <?php echo $newQuestionInput['question_type'] === 'single_choice' ? 'selected' : ''; ?>>Single Choice</option>
                                <option value="true_false" <?php echo $newQuestionInput['question_type'] === 'true_false' ? 'selected' : ''; ?>>Wahr/Falsch</option>
                                <option value="multiple_choice" <?php echo $newQuestionInput['question_type'] === 'multiple_choice' ? 'selected' : ''; ?>>Multiple Choice</option>
                                <option value="short_text" <?php echo $newQuestionInput['question_type'] === 'short_text' ? 'selected' : ''; ?>>Freitext</option>
                            </select>
                            <?php renderAnswerEditor(
                                (string) $newQuestionInput['question_type'],
                                $newQuestionInput['options'],
                                (string) $newQuestionInput['answer_payload'],
                                (int) $newQuestionInput['correct_option_index'],
                                $newQuestionInput['option_images'],
                                $newQuestionInput['option_alt_texts']
                            ); ?>
                        </div>
                        <div class="tab-panel" id="new-advanced">
                            <label>Zeitlimit (Sekunden)</label>
                            <input type="number" name="time_limit" value="<?php echo (int) $newQuestionInput['time_limit']; ?>" min="1">
                            <label>Max Punkte</label>
                            <input type="number" name="points_max" value="<?php echo (int) $newQuestionInput['points_max']; ?>" min="0">
                            <label>Min Punkte</label>
                            <input type="number" name="points_min" value="<?php echo (int) $newQuestionInput['points_min']; ?>" min="0">
                            <label>Delay (Sekunden)</label>
                            <input type="number" name="points_delay" value="<?php echo (int) $newQuestionInput['points_delay']; ?>" min="0">
                            <label>Abfallzeit (Sekunden)</label>
                            <input type="number" name="points_decay_time" value="<?php echo (int) $newQuestionInput['points_decay_time']; ?>" min="1">
                        </div>
                        <div style="margin-top: 12px;"><button type="submit" name="action" value="save" class="primary">Frage speichern</button></div>
                    </form>

                    <?php foreach ($questionRows as $index => $question): ?>
                        <form method="post" enctype="multipart/form-data" class="panel" id="question-<?php echo (int) $question['id']; ?>" style="margin-bottom: 16px;">
                            <input type="hidden" name="question_id" value="<?php echo (int) $question['id']; ?>">
                            <h3>Frage <?php echo $index + 1; ?></h3>
                            <div class="small" style="margin-bottom:12px;">ID: <?php echo (int) $question['id']; ?></div>

                            <div class="tabs">
                                <button type="button" class="tab-btn active" data-target="q-<?php echo (int) $question['id']; ?>-base">Basis</button>
                                <button type="button" class="tab-btn" data-target="q-<?php echo (int) $question['id']; ?>-advanced">Advanced</button>
                            </div>

                            <div class="tab-panel active" id="q-<?php echo (int) $question['id']; ?>-base">
                                <label>Frage</label>
                                <textarea name="text" required style="min-height:90px;"><?php echo htmlspecialchars($question['text']); ?></textarea>
                                <label>Fragebild (optional)</label>
                                <input type="file" name="question_image" accept="image/jpeg,image/png,image/webp,image/gif">
                                <?php if (($question['image_url'] ?? '') !== ''): ?>
                                    <img class="editor-media-preview" src="../<?php echo htmlspecialchars((string) $question['image_url']); ?>" alt="Vorschau des Fragebilds" tabindex="0" role="button" aria-label="Fragebild gross anzeigen">
                                    <label><input type="checkbox" name="remove_image" value="1"> Bild entfernen</label>
                                <?php endif; ?>
                                <label>Fragetyp</label>
                                <select name="question_type">
                                    <option value="single_choice" <?php echo $question['question_type'] === 'single_choice' ? 'selected' : ''; ?>>Single Choice</option>
                                    <option value="true_false" <?php echo $question['question_type'] === 'true_false' ? 'selected' : ''; ?>>Wahr/Falsch</option>
                                    <option value="multiple_choice" <?php echo $question['question_type'] === 'multiple_choice' ? 'selected' : ''; ?>>Multiple Choice</option>
                                    <option value="short_text" <?php echo $question['question_type'] === 'short_text' ? 'selected' : ''; ?>>Freitext</option>
                                </select>
                                <?php renderAnswerEditor(
                                    (string) $question['question_type'],
                                    $question['options'] ?? [],
                                    (string) ($question['answer_payload'] ?? ''),
                                    (int) $question['correct_option_index'],
                                    $question['option_images'] ?? [],
                                    $question['option_alt_texts'] ?? []
                                ); ?>
                            </div>

                            <div class="tab-panel" id="q-<?php echo (int) $question['id']; ?>-advanced">
                                <label>Zeitlimit (Sekunden)</label>
                                <input type="number" name="time_limit" value="<?php echo (int) $question['time_limit']; ?>" min="1">
                                <label>Max Punkte</label>
                                <input type="number" name="points_max" value="<?php echo (int) $question['points_max']; ?>" min="0">
                                <label>Min Punkte</label>
                                <input type="number" name="points_min" value="<?php echo (int) $question['points_min']; ?>" min="0">
                                <label>Delay (Sekunden)</label>
                                <input type="number" name="points_delay" value="<?php echo (int) $question['points_delay']; ?>" min="0">
                                <label>Abfallzeit (Sekunden)</label>
                                <input type="number" name="points_decay_time" value="<?php echo (int) $question['points_decay_time']; ?>" min="1">
                            </div>

                            <div class="editor-question-actions">
                                <button type="submit" name="action" value="save" class="primary">Aenderung speichern</button>
                                <button type="submit" name="action" value="move_up" class="secondary" title="Frage nach oben verschieben" aria-label="Frage nach oben verschieben">↑</button>
                                <button type="submit" name="action" value="move_down" class="secondary" title="Frage nach unten verschieben" aria-label="Frage nach unten verschieben">↓</button>
                                <button type="submit" name="action" value="duplicate" class="secondary">Duplizieren</button>
                                <button type="submit" name="action" value="delete" class="secondary" onclick="return confirm('Diese Frage wirklich loeschen?');">Loeschen</button>
                            </div>
                        </form>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
    </div>

    <dialog id="editor-media-dialog" class="editor-media-dialog" aria-label="Bildvorschau">
        <button type="button" class="editor-media-dialog-close" aria-label="Bildvorschau schliessen">×</button>
        <img id="editor-media-dialog-image" src="" alt="">
    </dialog>

    <script>
        document.querySelectorAll('.tabs').forEach(function(tabGroup) {
            const buttons = tabGroup.querySelectorAll('.tab-btn');
            buttons.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    const targetId = btn.getAttribute('data-target');
                    const form = tabGroup.closest('form');
                    if (!form || !targetId) return;

                    buttons.forEach(function(candidate) {
                        candidate.classList.remove('active');
                    });
                    btn.classList.add('active');

                    form.querySelectorAll('.tab-panel').forEach(function(panel) {
                        panel.classList.remove('active');
                    });

                    const panel = form.querySelector('#' + targetId);
                    if (panel) {
                        panel.classList.add('active');
                    }
                });
            });
        });

        function updateAnswerFields(form) {
            const type = form.querySelector('[name="question_type"]')?.value || 'single_choice';
            form.querySelectorAll('[data-answer-fields]').forEach(function(group) {
                const visible = group.dataset.answerFields === (type === 'short_text' ? 'short_text' : 'choice');
                group.classList.toggle('hidden', !visible);
                group.querySelectorAll('input').forEach(function(input) {
                    input.disabled = !visible;
                });
            });

            const choiceRows = Array.from(form.querySelectorAll('[data-answer-fields="choice"] .editor-answer-row'));
            choiceRows.forEach(function(row, index) {
                const optionInput = row.querySelector('.editor-option-input');
                const correctInput = row.querySelector('.editor-correct-input');
                const imageInput = row.querySelector('.editor-option-image');
                const altInput = row.querySelector('[name="option_alt_texts[]"]');
                const enabled = type !== 'true_false' || index < 2;
                imageInput.disabled = !enabled || type === 'short_text' || type === 'true_false';
                altInput.disabled = !enabled || type === 'short_text' || type === 'true_false';
                row.classList.toggle('hidden', !enabled);
                optionInput.disabled = !enabled || type === 'short_text';
                correctInput.disabled = !enabled || type === 'short_text';
                correctInput.type = type === 'multiple_choice' ? 'checkbox' : 'radio';
                if (type === 'true_false' && index < 2) {
                    optionInput.value = index === 0 ? 'Wahr' : 'Falsch';
                    optionInput.readOnly = true;
                } else {
                    optionInput.readOnly = false;
                }

            });
        }

        document.querySelectorAll('form').forEach(function(form) {
            const typeSelect = form.querySelector('[name="question_type"]');
            if (!typeSelect) return;
            updateAnswerFields(form);
            typeSelect.addEventListener('change', function() {
                updateAnswerFields(form);
            });
        });

        const mediaDialog = document.getElementById('editor-media-dialog');
        const mediaDialogImage = document.getElementById('editor-media-dialog-image');
        function openMediaPreview(preview) {
            mediaDialogImage.src = preview.currentSrc || preview.src;
            mediaDialogImage.alt = preview.alt;
            mediaDialog.showModal();
        }
        document.querySelectorAll('.editor-media-preview').forEach(function(preview) {
            preview.addEventListener('click', function() {
                openMediaPreview(preview);
            });
            preview.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openMediaPreview(preview);
                }
            });
        });
        mediaDialog.querySelector('.editor-media-dialog-close').addEventListener('click', function() {
            mediaDialog.close();
        });
        mediaDialog.addEventListener('click', function(event) {
            if (event.target === mediaDialog) {
                mediaDialog.close();
            }
        });
    </script>
</body>
</html>

