const mysql = require('mysql2/promise');

let pool = null;

function createDbPool(dbConfig) {
    const connectionLimit = Number(dbConfig.connectionLimit || 20);
    return mysql.createPool({
        ...dbConfig,
        charset: dbConfig.charset || 'utf8mb4',
        connectionLimit: Number.isInteger(connectionLimit) && connectionLimit > 0 ? connectionLimit : 20,
        waitForConnections: true,
        queueLimit: 0
    });
}

function getDbPool(dbConfig) {
    if (!pool) pool = createDbPool(dbConfig);
    return pool;
}

async function closeDbPool() {
    if (!pool) return;

    const activePool = pool;
    pool = null;
    await activePool.end();
}

async function initDb(dbConfig) {
    const connection = await mysql.createConnection({
        ...dbConfig,
        charset: dbConfig.charset || 'utf8mb4'
    });

    try {
        await connection.execute('SET NAMES utf8mb4');

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sessions (
                pin VARCHAR(6) PRIMARY KEY,
                quiz_id INT NOT NULL,
                host_token_hash CHAR(64) NULL,
                state VARCHAR(20) DEFAULT 'lobby',
                presentation_view VARCHAR(20) NOT NULL DEFAULT 'solution',
                live_tracking_enabled TINYINT(1) NOT NULL DEFAULT 0,
                live_tracking_threshold INT NOT NULL DEFAULT 1,
                phase_started_ms BIGINT UNSIGNED NULL,
                phase_deadline_ms BIGINT UNSIGNED NULL,
                current_question_index INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        try {
            const [sessionColumns] = await connection.query('SHOW COLUMNS FROM sessions');
            const hasQuizId = sessionColumns.some(column => column.Field === 'quiz_id');
            if (!hasQuizId) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN quiz_id INT NOT NULL DEFAULT 1');
            }
            if (!sessionColumns.some(column => column.Field === 'host_token_hash')) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN host_token_hash CHAR(64) NULL');
            }
            if (!sessionColumns.some(column => column.Field === 'presentation_view')) {
                await connection.execute("ALTER TABLE sessions ADD COLUMN presentation_view VARCHAR(20) NOT NULL DEFAULT 'solution'");
            }
            if (!sessionColumns.some(column => column.Field === 'live_tracking_enabled')) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN live_tracking_enabled TINYINT(1) NOT NULL DEFAULT 0');
            }
            if (!sessionColumns.some(column => column.Field === 'live_tracking_threshold')) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN live_tracking_threshold INT NOT NULL DEFAULT 1');
            }
            if (!sessionColumns.some(column => column.Field === 'phase_started_ms')) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN phase_started_ms BIGINT UNSIGNED NULL');
            }
            if (!sessionColumns.some(column => column.Field === 'phase_deadline_ms')) {
                await connection.execute('ALTER TABLE sessions ADD COLUMN phase_deadline_ms BIGINT UNSIGNED NULL');
            }
        } catch (schemaError) {
            console.log('Schema check skipped:', schemaError.message);
        }

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                question_text TEXT NOT NULL,
                image_url VARCHAR(255) NULL,
                position INT NOT NULL DEFAULT 1,
                text VARCHAR(1000) NOT NULL,
                question_type VARCHAR(32) NOT NULL DEFAULT 'single_choice',
                correct_option_index INT NOT NULL,
                answer_payload TEXT NULL,
                time_limit INT NOT NULL DEFAULT 15,
                points_max INT NOT NULL DEFAULT 100,
                points_min INT NOT NULL DEFAULT 40,
                points_delay INT NOT NULL DEFAULT 0,
                points_decay_time INT NOT NULL DEFAULT 15,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS session_results (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_pin VARCHAR(6) NOT NULL,
                player_id INT NOT NULL,
                nickname VARCHAR(100) NOT NULL,
                points INT NOT NULL DEFAULT 0,
                correct_answers INT NOT NULL DEFAULT 0,
                answered_questions INT NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_player_result (session_pin, player_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS session_players (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_pin VARCHAR(6) NOT NULL,
                player_token VARCHAR(64) NOT NULL,
                nickname VARCHAR(100) NOT NULL,
                points INT NOT NULL DEFAULT 0,
                answered TINYINT(1) NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_session_player (session_pin, player_token)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS session_answers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_pin VARCHAR(6) NOT NULL,
                player_token VARCHAR(64) NOT NULL,
                question_id INT NOT NULL,
                answer_payload TEXT NULL,
                answer_time_ms BIGINT UNSIGNED NOT NULL,
                is_correct TINYINT(1) NOT NULL DEFAULT 0,
                points_awarded INT NOT NULL DEFAULT 0,
                submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                UNIQUE KEY unique_session_player_question (session_pin, player_token, question_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS short_text_reviews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_pin VARCHAR(6) NOT NULL,
                player_id INT NOT NULL,
                nickname VARCHAR(100) NOT NULL,
                question_id INT NOT NULL,
                answer_text TEXT NOT NULL,
                player_token VARCHAR(64) NULL,
                reviewed TINYINT(1) NOT NULL DEFAULT 0,
                approved TINYINT(1) NULL,
                points_awarded INT NOT NULL DEFAULT 0,
                review_comment TEXT NULL,
                reviewed_by VARCHAR(100) NULL,
                reviewed_at DATETIME(3) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_review (session_pin, player_id, question_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS question_options (
                id INT AUTO_INCREMENT PRIMARY KEY,
                question_id INT NOT NULL,
                option_text VARCHAR(500) NOT NULL,
                option_image_url VARCHAR(500) NULL,
                option_alt_text VARCHAR(500) NULL,
                option_index INT NOT NULL,
                FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        try {
            const [quizColumns] = await connection.query('SHOW COLUMNS FROM quizzes');
            if (!quizColumns.some(column => column.Field === 'image_url')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN image_url VARCHAR(255) NULL');
            }
            if (!quizColumns.some(column => column.Field === 'automatic_mode')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN automatic_mode TINYINT(1) NOT NULL DEFAULT 0');
            }
            if (!quizColumns.some(column => column.Field === 'start_phase_seconds')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN start_phase_seconds INT NOT NULL DEFAULT 2');
            }
            if (!quizColumns.some(column => column.Field === 'question_phase_seconds')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN question_phase_seconds INT NOT NULL DEFAULT 2');
            }
            if (!quizColumns.some(column => column.Field === 'options_phase_seconds')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN options_phase_seconds INT NOT NULL DEFAULT 2');
            }
            if (!quizColumns.some(column => column.Field === 'solution_phase_seconds')) {
                await connection.execute('ALTER TABLE quizzes ADD COLUMN solution_phase_seconds INT NOT NULL DEFAULT 2');
            }

            const [questionColumns] = await connection.query('SHOW COLUMNS FROM questions');
            if (!questionColumns.some(column => column.Field === 'quiz_id')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN quiz_id INT NOT NULL DEFAULT 1');
            }
            if (!questionColumns.some(column => column.Field === 'question_text')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN question_text TEXT NOT NULL DEFAULT ""');
            }
            if (!questionColumns.some(column => column.Field === 'image_url')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN image_url VARCHAR(255) NULL');
            }
            if (!questionColumns.some(column => column.Field === 'position')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN position INT NOT NULL DEFAULT 1');
            }
            if (!questionColumns.some(column => column.Field === 'text')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN text VARCHAR(1000) NOT NULL DEFAULT ""');
            }
            if (!questionColumns.some(column => column.Field === 'question_type')) {
                await connection.execute("ALTER TABLE questions ADD COLUMN question_type VARCHAR(32) NOT NULL DEFAULT 'single_choice'");
            }
            if (!questionColumns.some(column => column.Field === 'correct_option_index')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN correct_option_index INT NOT NULL DEFAULT 0');
            }
            if (!questionColumns.some(column => column.Field === 'answer_payload')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN answer_payload TEXT NULL');
            }
            if (!questionColumns.some(column => column.Field === 'time_limit')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN time_limit INT NOT NULL DEFAULT 15');
            }
            if (!questionColumns.some(column => column.Field === 'points_max')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN points_max INT NOT NULL DEFAULT 100');
            }
            if (!questionColumns.some(column => column.Field === 'points_min')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN points_min INT NOT NULL DEFAULT 40');
            }
            if (!questionColumns.some(column => column.Field === 'points_delay')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN points_delay INT NOT NULL DEFAULT 0');
            }
            if (!questionColumns.some(column => column.Field === 'points_decay_time')) {
                await connection.execute('ALTER TABLE questions ADD COLUMN points_decay_time INT NOT NULL DEFAULT 15');
            }

            const [reviewColumns] = await connection.query('SHOW COLUMNS FROM short_text_reviews');
            if (!reviewColumns.some(column => column.Field === 'player_token')) {
                await connection.execute('ALTER TABLE short_text_reviews ADD COLUMN player_token VARCHAR(64) NULL AFTER answer_text');
            }
            if (!reviewColumns.some(column => column.Field === 'points_awarded')) {
                await connection.execute('ALTER TABLE short_text_reviews ADD COLUMN points_awarded INT NOT NULL DEFAULT 0 AFTER approved');
            }
            if (!reviewColumns.some(column => column.Field === 'review_comment')) {
                await connection.execute('ALTER TABLE short_text_reviews ADD COLUMN review_comment TEXT NULL AFTER points_awarded');
            }
            if (!reviewColumns.some(column => column.Field === 'reviewed_by')) {
                await connection.execute('ALTER TABLE short_text_reviews ADD COLUMN reviewed_by VARCHAR(100) NULL AFTER review_comment');
            }
            if (!reviewColumns.some(column => column.Field === 'reviewed_at')) {
                await connection.execute('ALTER TABLE short_text_reviews ADD COLUMN reviewed_at DATETIME(3) NULL AFTER reviewed_by');
            }

            const [optionColumns] = await connection.query('SHOW COLUMNS FROM question_options');
            if (!optionColumns.some(column => column.Field === 'option_text')) {
                await connection.execute('ALTER TABLE question_options ADD COLUMN option_text VARCHAR(500) NOT NULL DEFAULT ""');
            }
            if (!optionColumns.some(column => column.Field === 'option_index')) {
                await connection.execute('ALTER TABLE question_options ADD COLUMN option_index INT NOT NULL DEFAULT 0');
            }
            if (!optionColumns.some(column => column.Field === 'option_image_url')) {
                await connection.execute('ALTER TABLE question_options ADD COLUMN option_image_url VARCHAR(500) NULL AFTER option_text');
            }
            if (!optionColumns.some(column => column.Field === 'option_alt_text')) {
                await connection.execute('ALTER TABLE question_options ADD COLUMN option_alt_text VARCHAR(500) NULL AFTER option_image_url');
            }
        } catch (schemaError) {
            console.log('Schema check skipped:', schemaError.message);
        }

        let demoQuizId = null;

        try {
            const [quizRows] = await connection.execute(
                'SELECT id FROM quizzes WHERE title = ? ORDER BY id LIMIT 1',
                ['Quizzy Demo']
            );

            demoQuizId = quizRows.length > 0 ? quizRows[0].id : null;
            if (!demoQuizId) {
                const [quizInsert] = await connection.execute(
                    'INSERT INTO quizzes (title, description, image_url) VALUES (?, ?, ?)',
                    ['Quizzy Demo', 'Vier abwechslungsreiche Fragen aus Allgemeinwissen, Technik und Logik.', 'assets/quizzy-demo.svg']
                );
                demoQuizId = quizInsert.insertId;
            }

            await connection.execute(
                'UPDATE quizzes SET description = ?, image_url = ? WHERE id = ?',
                ['Vier abwechslungsreiche Fragen aus Allgemeinwissen, Technik und Logik.', 'assets/quizzy-demo.svg', demoQuizId]
            );

            const demoQuestions = [
                {
                    question_type: 'single_choice',
                    text: 'Was ist die Hauptstadt von Frankreich?',
                    correct_option_index: 0,
                    answer_payload: JSON.stringify([0]),
                    options: ['Paris', 'Berlin', 'Rom', 'Madrid']
                },
                {
                    question_type: 'true_false',
                    text: 'Die Erde ist eine Scheibe.',
                    correct_option_index: 1,
                    answer_payload: JSON.stringify([1]),
                    options: ['Wahr', 'Falsch']
                },
                {
                    question_type: 'multiple_choice',
                    text: 'Welche Systeme sind relationale Datenbanken?',
                    correct_option_index: 0,
                    answer_payload: JSON.stringify([0, 2]),
                    options: ['MySQL', 'Redis', 'PostgreSQL', 'MongoDB']
                },
                {
                    question_type: 'short_text',
                    text: 'Wie heißt die Programmiersprache dieses Projekts?',
                    correct_option_index: 0,
                    answer_payload: JSON.stringify(['php', 'PHP']),
                    options: []
                }
            ];

            for (let index = 0; index < demoQuestions.length; index++) {
                const question = demoQuestions[index];
                const [existingRows] = await connection.execute('SELECT id FROM questions WHERE quiz_id = ? AND text = ?', [demoQuizId, question.text]);
                if (existingRows.length > 0) {
                    continue;
                }

                const [insertResult] = await connection.execute(
                    'INSERT INTO questions (quiz_id, question_text, image_url, position, text, question_type, correct_option_index, answer_payload, time_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [demoQuizId, question.text, null, index + 1, question.text, question.question_type, question.correct_option_index, question.answer_payload, 15]
                );

                const questionId = insertResult.insertId;
                for (const [index, option] of question.options.entries()) {
                    await connection.execute(
                        'INSERT INTO question_options (question_id, option_text, option_index) VALUES (?, ?, ?)',
                        [questionId, option, index]
                    );
                }
            }
        } catch (seedError) {
            console.log('Demo questions seed skipped:', seedError.message);
        }

        try {
            const [existingSession] = await connection.execute('SELECT pin FROM sessions WHERE pin = ?', ['123456']);
            if (existingSession.length === 0) {
                await connection.execute('INSERT INTO sessions (pin, quiz_id, state, current_question_index) VALUES (?, ?, ?, ?)', ['123456', demoQuizId, 'lobby', 0]);
            } else {
                await connection.execute('UPDATE sessions SET quiz_id = ? WHERE pin = ?', [demoQuizId, '123456']);
            }
        } catch (sessionError) {
            console.log('Demo session seed skipped:', sessionError.message);
        }
    } finally {
        await connection.end();
    }
}

module.exports = { initDb, createDbPool, getDbPool, closeDbPool };
