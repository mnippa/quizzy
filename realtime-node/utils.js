const WebSocket = require('ws');
const questionTypes = require('./question-types');
const { getDbPool } = require('./db');

function utilsFactory(dbConfig) {
    const pendingPlayerWrites = new Map();

    async function getConnection() {
        return getDbPool(dbConfig).getConnection();
    }

    async function loadSessionHostTokenHash(sessionPin) {
        const connection = await getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT host_token_hash FROM sessions WHERE pin = ? LIMIT 1',
                [sessionPin]
            );
            if (!rows.length) throw new Error(`Session ${sessionPin} was not found.`);
            return rows[0].host_token_hash;
        } finally {
            connection.release();
        }
    }

    function queuePlayerWrite(sessionPin, identity, operation) {
        const key = `${sessionPin}:${identity}`;
        const previous = pendingPlayerWrites.get(key);
        // A reconnect must not overtake an earlier lobby removal for the same player.
        const run = () => operation();
        const promise = previous ? previous.promise.then(run, run) : Promise.resolve().then(run);
        const entry = { key, sessionPin, identity, operation, promise, error: null };
        pendingPlayerWrites.set(key, entry);
        promise.then(
            () => {
                if (pendingPlayerWrites.get(key) === entry) pendingPlayerWrites.delete(key);
            },
            error => { entry.error = error; }
        );
        return promise;
    }

    async function flushSessionPlayerWrites(sessionPin = null) {
        while (true) {
            const entries = Array.from(pendingPlayerWrites.values())
                .filter(entry => sessionPin === null || entry.sessionPin === sessionPin);
            if (!entries.length) return;

            await Promise.all(entries.map(async entry => {
                if (pendingPlayerWrites.get(entry.key) !== entry) return;
                try {
                    await entry.promise;
                } catch (error) {
                    if (pendingPlayerWrites.get(entry.key) !== entry) return;
                    console.warn(`Retrying player persistence for session ${entry.sessionPin}:`, (entry.error || error).message);
                    await queuePlayerWrite(entry.sessionPin, entry.identity, entry.operation);
                }
            }));
        }
    }

    function buildLiveAnswerStats(session) {
        const players = Object.values(session?.players || {});
        const currentQuestionId = Number(session?.question?.id || 0);
        const answered = players.filter(player => Number(player.currentAnswer?.questionId) === currentQuestionId);
        const requiresReview = Boolean(questionTypes.getQuestionType(session?.question).requiresReview);
        const pendingReview = requiresReview
            ? answered.filter(player => !player.currentAnswer?.isReviewed).length
            : 0;
        const reviewedAnswers = requiresReview
            ? answered.filter(player => player.currentAnswer?.isReviewed)
            : answered;
        const correct = reviewedAnswers.filter(player => player.currentAnswer?.isCorrect).length;
        return {
            total: players.length,
            answered: answered.length,
            correct,
            incorrect: Math.max(0, answered.length - correct - pendingReview),
            pendingReview
        };
    }

    function buildDisplayLiveAnswerStats(stats, enabled, threshold) {
        if (!enabled) return { enabled: false };

        const safeThreshold = Math.max(1, Number(threshold || 1));
        const correctnessVisible = Number(stats?.answered || 0) >= safeThreshold;
        return {
            ...stats,
            ...(correctnessVisible ? {} : { correct: 0, incorrect: 0, pendingReview: 0 }),
            enabled: true,
            threshold: safeThreshold,
            correctnessVisible
        };
    }

    async function loadQuizMetaById(quizId) {
        if (!quizId) return null;

        let connection;
        try {
            connection = await getConnection();
            const [rows] = await connection.execute(`
                SELECT q.title, q.description, q.image_url, q.automatic_mode,
                    q.start_phase_seconds, q.question_phase_seconds, q.options_phase_seconds, q.solution_phase_seconds,
                    COUNT(que.id) AS question_count
                FROM quizzes q
                LEFT JOIN questions que ON que.quiz_id = q.id
                WHERE q.id = ?
                GROUP BY q.id, q.title, q.description, q.image_url, q.automatic_mode,
                    q.start_phase_seconds, q.question_phase_seconds, q.options_phase_seconds, q.solution_phase_seconds
                LIMIT 1
            `, [quizId]);
            if (rows.length > 0) {
                const row = rows[0];
                return {
                    title: row.title || null,
                    description: row.description || '',
                    imageUrl: row.image_url || '',
                    questionCount: Number(row.question_count || 0),
                    automaticMode: Boolean(row.automatic_mode),
                    startPhaseSeconds: Math.max(1, Number(row.start_phase_seconds || 2)),
                    questionPhaseSeconds: Math.max(1, Number(row.question_phase_seconds || 2)),
                    optionsPhaseSeconds: Math.max(1, Number(row.options_phase_seconds || 2)),
                    solutionPhaseSeconds: Math.max(1, Number(row.solution_phase_seconds || 2))
                };
            }
        } catch (error) {
            console.log('Quiz metadata lookup skipped:', error.message);
        } finally {
            connection?.release();
        }

        return null;
    }

    async function loadQuizPreview(quizId) {
        if (!quizId) return [];

        let connection;
        try {
            connection = await getConnection();
            const [questions] = await connection.execute(`
                SELECT id, COALESCE(NULLIF(text, ''), question_text) AS text,
                    question_type, correct_option_index, answer_payload
                FROM questions
                WHERE quiz_id = ?
                ORDER BY position, id
            `, [quizId]);

            const preview = [];
            for (const question of questions) {
                const [optionRows] = await connection.execute(
                    'SELECT option_text, option_image_url, option_alt_text, option_index FROM question_options WHERE question_id = ? ORDER BY option_index',
                    [question.id]
                );
                let answerPayload = null;
                try {
                    answerPayload = question.answer_payload ? JSON.parse(question.answer_payload) : null;
                } catch (error) {
                    answerPayload = null;
                }
                preview.push({
                    id: Number(question.id),
                    text: question.text || '',
                    type: questionTypes.getQuestionType(question.question_type).type,
                    options: optionRows.map(option => option.option_text),
                    optionMedia: optionRows.map(option => ({
                        text: option.option_text || '',
                        imageUrl: option.option_image_url || '',
                        altText: option.option_alt_text || ''
                    })),
                    correctOptionIndex: Number(question.correct_option_index || 0),
                    correctOptionIndices: Array.isArray(answerPayload) ? answerPayload : null,
                    acceptedAnswers: question.question_type === 'short_text' && Array.isArray(answerPayload)
                        ? answerPayload.map(String)
                        : null
                });
            }
            return preview;
        } catch (error) {
            console.log('Quiz preview lookup skipped:', error.message);
            return [];
        } finally {
            connection?.release();
        }
    }

        function mapStateToStatusLiteral(state) {
            const value = String(state || '').toLowerCase();
            if (value === 'lobby') return 'offen';
            if (value === 'start') return 'Start';
            if (value === 'question') return 'Frage';
            if (value === 'options') return 'Antwortmöglichkeiten';
            if (value === 'answer') return 'Antwort';
            if (value === 'solution') return 'Ergebnis';
            if (value === 'endresult') return 'Endergebnis';
            if (value === 'finished') return 'geschlossen';
            return value || 'offen';
        }

        async function loadSessionResults(sessionPin, options = {}) {
            let connection;
            try {
                connection = await getConnection();
                const [rows] = await connection.execute(
                    'SELECT session_pin, player_id, nickname, points, correct_answers, answered_questions FROM session_results WHERE session_pin = ? ORDER BY points DESC, updated_at DESC',
                    [sessionPin]
                );
                return rows.map((row, index) => ({
                    rank: index + 1,
                    player_id: row.player_id,
                    name: row.nickname,
                    nickname: row.nickname,
                    points: Number(row.points || 0),
                    correct_answers: Number(row.correct_answers || 0),
                    answered_questions: Number(row.answered_questions || 0)
                }));
            } catch (error) {
                console.error('Session result lookup failed:', error.message);
                if (options.throwOnError) throw error;
                return [];
            } finally {
                connection?.release();
            }
        }

        async function loadAnonymousShortTextAnswers(sessionPin, questionId = null) {
            const connection = await getConnection();
            try {
                const params = [sessionPin];
                const questionFilter = questionId ? ' AND review.question_id = ?' : '';
                if (questionId) params.push(Number(questionId));
                const [rows] = await connection.execute(`
                    SELECT review.answer_text
                    FROM short_text_reviews review
                    WHERE review.session_pin = ?${questionFilter}
                    ORDER BY review.created_at ASC, review.id ASC
                `, params);
                return rows.map(row => ({
                    answerText: String(row.answer_text || '')
                }));
            } finally {
                connection.release();
            }
        }

        async function loadQuestionStats(sessionPin, questionId) {
            if (!questionId) return null;
            const connection = await getConnection();
            try {
                const [[row]] = await connection.execute(`
                    SELECT COUNT(*) AS answer_count,
                        COALESCE(SUM(is_correct), 0) AS correct_count,
                        COALESCE(ROUND(AVG(answer_time_ms)), 0) AS average_time_ms,
                        COALESCE(SUM(points_awarded), 0) AS points_awarded
                    FROM session_answers
                    WHERE session_pin = ? AND question_id = ?
                `, [sessionPin, Number(questionId)]);
                return {
                    answerCount: Number(row.answer_count || 0),
                    correctCount: Number(row.correct_count || 0),
                    averageTimeMs: Number(row.average_time_ms || 0),
                    pointsAwarded: Number(row.points_awarded || 0)
                };
            } finally {
                connection.release();
            }
        }

    async function hydrateSessionQuizMeta(session) {
        if (!session) return session;

        if (!session.quiz_id) {
            return session;
        }

        const meta = session.quiz_title && session.quiz_description !== undefined && session.quiz_question_count !== undefined
            ? {
                title: session.quiz_title,
                description: session.quiz_description || '',
                imageUrl: session.quiz_image_url || '',
                questionCount: Number(session.quiz_question_count || 0),
                automaticMode: Boolean(session.quiz_automatic_mode),
                startPhaseSeconds: Number(session.quiz_start_phase_seconds || 2),
                questionPhaseSeconds: Number(session.quiz_question_phase_seconds || 2),
                optionsPhaseSeconds: Number(session.quiz_options_phase_seconds || 2),
                solutionPhaseSeconds: Number(session.quiz_solution_phase_seconds || 2)
            }
            : await loadQuizMetaById(session.quiz_id);

        if (meta) {
            session.quiz_title = meta.title || session.quiz_title || 'Quiz';
            session.quiz_description = meta.description || session.quiz_description || '';
            session.quiz_image_url = meta.imageUrl || session.quiz_image_url || '';
            session.quiz_question_count = Number(meta.questionCount || session.quiz_question_count || 0);
            session.quiz_automatic_mode = Boolean(meta.automaticMode);
            session.quiz_start_phase_seconds = Math.max(1, Number(meta.startPhaseSeconds || 2));
            session.quiz_question_phase_seconds = Math.max(1, Number(meta.questionPhaseSeconds || 2));
            session.quiz_options_phase_seconds = Math.max(1, Number(meta.optionsPhaseSeconds || 2));
            session.quiz_solution_phase_seconds = Math.max(1, Number(meta.solutionPhaseSeconds || 2));
        }

        if (!Array.isArray(session.quiz_preview)) {
            session.quiz_preview = await loadQuizPreview(session.quiz_id);
        }

        return session;
    }

    async function loadSessionPlayers(sessionPin) {
        const connection = await getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT id, player_token, nickname, points, answered FROM session_players WHERE session_pin = ? ORDER BY id',
                [sessionPin]
            );
            return rows.map(row => ({
                id: -Number(row.id), // Restored players cannot collide with positive socket IDs.
                databaseId: Number(row.id),
                playerToken: row.player_token,
                name: row.nickname,
                points: Number(row.points || 0),
                answered: Boolean(row.answered),
                ws: null
            }));
        } finally {
            connection.release();
        }
    }

    async function hydrateCurrentAnswers(sessionPin, session) {
        if (!session?.question?.id) return session;

        const connection = await getConnection();
        try {
            const [rows] = await connection.execute(`
                SELECT answer.player_token, answer.answer_payload, answer.answer_time_ms,
                    answer.is_correct, answer.points_awarded, review.reviewed
                FROM session_answers answer
                LEFT JOIN short_text_reviews review
                    ON review.session_pin = answer.session_pin
                    AND review.player_token = answer.player_token
                    AND review.question_id = answer.question_id
                WHERE answer.session_pin = ? AND answer.question_id = ?
            `, [sessionPin, session.question.id]);
            const answersByToken = new Map(rows.map(row => [row.player_token, row]));

            Object.values(session.players || {}).forEach(player => {
                const row = answersByToken.get(player.playerToken);
                if (!row) return;

                let submittedAnswer = null;
                try {
                    submittedAnswer = JSON.parse(row.answer_payload);
                } catch (error) {
                    submittedAnswer = null;
                }
                player.answered = true;
                player.currentAnswer = {
                    questionId: Number(session.question.id),
                    submittedAnswer,
                    answerTimeMs: Number(row.answer_time_ms),
                    isCorrect: Boolean(row.is_correct),
                    pointsAwarded: Number(row.points_awarded),
                    ...(row.reviewed !== null ? { isReviewed: Boolean(row.reviewed) } : {})
                };
            });
            return session;
        } finally {
            connection.release();
        }
    }

    async function saveSessionPlayer(sessionPin, player) {
        if (!player?.playerToken) return player?.id || null;

        return queuePlayerWrite(sessionPin, `token:${player.playerToken}`, async () => {
            const connection = await getConnection();
            try {
                await connection.execute(`
                    INSERT INTO session_players (session_pin, player_token, nickname, points, answered)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        nickname = VALUES(nickname),
                        points = VALUES(points),
                        answered = VALUES(answered)
                `, [sessionPin, player.playerToken, player.name, Number(player.points || 0), player.answered ? 1 : 0]);
                const [rows] = await connection.execute(
                    'SELECT id FROM session_players WHERE session_pin = ? AND player_token = ? LIMIT 1',
                    [sessionPin, player.playerToken]
                );
                return rows.length ? Number(rows[0].id) : null;
            } finally {
                connection.release();
            }
        });
    }

    async function saveSessionAnswer(sessionPin, player, question, answer) {
        if (!player?.playerToken || !question?.id || !answer) return;

        const connection = await getConnection();
        try {
            await connection.execute(`
                INSERT INTO session_answers (
                    session_pin, player_token, question_id, answer_payload,
                    answer_time_ms, is_correct, points_awarded
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    answer_payload = VALUES(answer_payload),
                    answer_time_ms = VALUES(answer_time_ms),
                    is_correct = VALUES(is_correct),
                    points_awarded = VALUES(points_awarded),
                    submitted_at = CURRENT_TIMESTAMP(3)
            `, [
                sessionPin,
                player.playerToken,
                question.id,
                JSON.stringify(answer.submittedAnswer),
                answer.answerTimeMs,
                answer.isCorrect ? 1 : 0,
                answer.pointsAwarded
            ]);
        } finally {
            connection.release();
        }
    }

    async function persistCanonicalAnswer(sessionPin, player, question, answer) {
        if (!player?.playerToken || !question?.id || !answer) {
            throw new Error('Incomplete canonical answer data.');
        }

        const connection = await getConnection();
        try {
            await connection.beginTransaction();

            const [playerRows] = await connection.execute(
                'SELECT id, nickname FROM session_players WHERE session_pin = ? AND player_token = ? FOR UPDATE',
                [sessionPin, player.playerToken]
            );
            if (!playerRows.length) {
                throw new Error('Persisted player not found.');
            }

            const [insertResult] = await connection.execute(`
                INSERT IGNORE INTO session_answers (
                    session_pin, player_token, question_id, answer_payload,
                    answer_time_ms, is_correct, points_awarded
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                sessionPin,
                player.playerToken,
                question.id,
                JSON.stringify(answer.submittedAnswer),
                Math.max(0, Math.trunc(Number(answer.answerTimeMs || 0))),
                answer.isCorrect ? 1 : 0,
                Math.max(0, Math.trunc(Number(answer.pointsAwarded || 0)))
            ]);

            const persistedPlayer = playerRows[0];
            await connection.execute(`
                UPDATE session_players player
                LEFT JOIN (
                    SELECT session_pin, player_token, COALESCE(SUM(points_awarded), 0) AS points
                    FROM session_answers
                    WHERE session_pin = ? AND player_token = ?
                    GROUP BY session_pin, player_token
                ) totals ON totals.session_pin = player.session_pin
                    AND totals.player_token = player.player_token
                SET player.points = COALESCE(totals.points, 0), player.answered = 1
                WHERE player.session_pin = ? AND player.player_token = ?
            `, [sessionPin, player.playerToken, sessionPin, player.playerToken]);

            await connection.execute(`
                INSERT INTO session_results (
                    session_pin, player_id, nickname, points, correct_answers, answered_questions
                )
                SELECT player.session_pin, player.id, player.nickname,
                    COALESCE(SUM(answer.points_awarded), 0),
                    COALESCE(SUM(answer.is_correct), 0),
                    COUNT(answer.id)
                FROM session_players player
                LEFT JOIN session_answers answer
                    ON answer.session_pin = player.session_pin
                    AND answer.player_token = player.player_token
                WHERE player.session_pin = ? AND player.player_token = ?
                GROUP BY player.session_pin, player.id, player.nickname
                ON DUPLICATE KEY UPDATE
                    nickname = VALUES(nickname),
                    points = VALUES(points),
                    correct_answers = VALUES(correct_answers),
                    answered_questions = VALUES(answered_questions)
            `, [sessionPin, player.playerToken]);

            const [stateRows] = await connection.execute(
                'SELECT points, answered FROM session_players WHERE id = ?',
                [persistedPlayer.id]
            );
            const [answerRows] = await connection.execute(`
                SELECT answer_payload, answer_time_ms, is_correct, points_awarded
                FROM session_answers
                WHERE session_pin = ? AND player_token = ? AND question_id = ?
                LIMIT 1
            `, [sessionPin, player.playerToken, question.id]);
            await connection.commit();

            const storedAnswer = answerRows[0];
            let submittedAnswer = null;
            try {
                submittedAnswer = JSON.parse(storedAnswer.answer_payload);
            } catch (error) {
                submittedAnswer = null;
            }

            return {
                inserted: insertResult.affectedRows === 1,
                playerId: Number(persistedPlayer.id),
                points: Number(stateRows[0]?.points || 0),
                answered: Boolean(stateRows[0]?.answered),
                answer: {
                    questionId: Number(question.id),
                    submittedAnswer,
                    answerTimeMs: Number(storedAnswer.answer_time_ms),
                    isCorrect: Boolean(storedAnswer.is_correct),
                    pointsAwarded: Number(storedAnswer.points_awarded)
                }
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function rebuildSessionResults(sessionPin) {
        const connection = await getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(`
                UPDATE session_players player
                LEFT JOIN (
                    SELECT player_token, COALESCE(SUM(points_awarded), 0) AS points
                    FROM session_answers
                    WHERE session_pin = ?
                    GROUP BY player_token
                ) totals ON totals.player_token = player.player_token
                SET player.points = COALESCE(totals.points, 0)
                WHERE player.session_pin = ?
            `, [sessionPin, sessionPin]);
            await connection.execute('DELETE FROM session_results WHERE session_pin = ?', [sessionPin]);
            await connection.execute(`
                INSERT INTO session_results (
                    session_pin, player_id, nickname, points, correct_answers, answered_questions
                )
                SELECT player.session_pin, player.id, player.nickname,
                    COALESCE(SUM(answer.points_awarded), 0),
                    COALESCE(SUM(answer.is_correct), 0),
                    COUNT(answer.id)
                FROM session_players player
                LEFT JOIN session_answers answer
                    ON answer.session_pin = player.session_pin
                    AND answer.player_token = player.player_token
                WHERE player.session_pin = ?
                GROUP BY player.session_pin, player.id, player.nickname
            `, [sessionPin]);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function deleteSessionPlayer(sessionPin, player) {
        if (!player) return;
        const identity = player.playerToken ? `token:${player.playerToken}` : `id:${player.databaseId || player.id}`;

        return queuePlayerWrite(sessionPin, identity, async () => {
            const connection = await getConnection();
            try {
                if (player.playerToken) {
                    await connection.execute(
                        'DELETE FROM session_players WHERE session_pin = ? AND player_token = ?',
                        [sessionPin, player.playerToken]
                    );
                } else if (player.databaseId || player.id) {
                    await connection.execute(
                        'DELETE FROM session_players WHERE session_pin = ? AND id = ?',
                        [sessionPin, player.databaseId || player.id]
                    );
                }
            } finally {
                connection.release();
            }
        });
    }
    
    async function loadSessionData(sessionPin, sessions) {
        let connection;
        try {
            connection = await getConnection();
            const [rows] = await connection.execute(
                'SELECT * FROM sessions WHERE pin = ?', [sessionPin]
            );
            connection.release();
            connection = null;
            
            if (rows.length > 0) {
                const persistedPlayers = await loadSessionPlayers(sessionPin);
                const session = {
                    ...rows[0],
                    phaseStartedAt: rows[0].phase_started_ms === null ? null : Number(rows[0].phase_started_ms),
                    phaseDeadlineAt: rows[0].phase_deadline_ms === null ? null : Number(rows[0].phase_deadline_ms),
                    answerStartTime: String(rows[0].state || '').toLowerCase() === 'answer' && rows[0].phase_started_ms !== null
                        ? Number(rows[0].phase_started_ms)
                        : null,
                    players: Object.fromEntries(persistedPlayers.map(player => [player.id, player])),
                    hosts: [],
                    displays: []
                };
                await hydrateSessionQuizMeta(session);
                if (['question', 'options', 'answer', 'solution'].includes(String(session.state || '').toLowerCase())) {
                    await loadNextQuestion(sessionPin, session, { preserveState: true });
                    await hydrateCurrentAnswers(sessionPin, session);
                }
                return session;
            }
        } catch (e) {
            console.error('Session lookup failed:', e.message);
            throw e;
        } finally {
            connection?.release();
        }
        return null;
    }
    
    async function loadNextQuestion(sessionPin, session, options = {}) {
        const preserveState = options.preserveState === true;
        const persistedState = session.state;

        let connection;
        try {
            connection = await getConnection();
            let quizId = session.quiz_id;

            if (!quizId) {
                session.state = 'finished';
                return;
            }

            const offset = Math.max(0, Number(session.current_question_index || 0));
            const [questionRows] = await connection.execute(
                'SELECT id, quiz_id, COALESCE(NULLIF(text, ""), question_text) AS text, image_url, question_type, correct_option_index, answer_payload, time_limit, points_max, points_min, points_delay, points_decay_time FROM questions WHERE quiz_id = ? ORDER BY position, id LIMIT 1 OFFSET ?',
                [quizId, offset]
            );

            if (questionRows.length === 0) {
                session.state = 'finished';
                return;
            }

            const question = questionRows[0];
            const [optionRows] = await connection.execute(
                'SELECT option_text, option_image_url, option_alt_text, option_index FROM question_options WHERE question_id = ? ORDER BY option_index ASC',
                [question.id]
            );
            if (!question || !question.text || String(question.text).trim() === '') {
                session.question = null;
                session.state = 'finished';
                return;
            }

            let parsedPayload = null;
            if (question.answer_payload) {
                try {
                    parsedPayload = JSON.parse(question.answer_payload);
                } catch (payloadError) {
                    parsedPayload = null;
                }
            }

            const options = optionRows.map(option => option.option_text);
            const optionMedia = optionRows.map(option => ({
                text: option.option_text || '',
                imageUrl: option.option_image_url || '',
                altText: option.option_alt_text || ''
            }));
            const questionType = (question.question_type || 'single_choice').toLowerCase();
            const correctOptionIndices = Array.isArray(parsedPayload) ? parsedPayload : null;
            const acceptedAnswers = questionType === 'short_text' && Array.isArray(parsedPayload)
                ? parsedPayload.map(answer => String(answer).trim().toLowerCase())
                : null;

            session.question = {
                id: question.id,
                quiz_id: question.quiz_id,
                text: question.text,
                image_url: question.image_url || '',
                type: questionType,
                options,
                optionMedia,
                correct_option_index: question.correct_option_index,
                answer_payload: parsedPayload,
                time_limit: Number(question.time_limit || 15),
                points_max: Number(question.points_max || 100),
                points_min: Number(question.points_min || 40),
                points_delay: Number(question.points_delay || 0),
                points_decay_time: Number(question.points_decay_time || Number(question.time_limit || 15)),
                correct_option_indices: correctOptionIndices,
                accepted_answers: acceptedAnswers
            };
            const definition = questionTypes.getQuestionType(session.question);
            if (!definition.validateQuestion(session.question)) {
                throw new Error(`Invalid ${definition.type} question configuration: ${question.id}`);
            }
            if (!preserveState) {
                session.answerStartTime = Date.now();
            }
            session.state = preserveState ? persistedState : 'question';
        } catch (error) {
            console.error('❌ Fehler beim Laden der Frage aus der DB:', error.message);
            if (options.throwOnError) throw error;
            session.state = 'finished';
        } finally {
            connection?.release();
        }
    }
    
    // *** KRITISCHER BROADCAST-FIX ***
    function broadcastToSession(sessionPin, message, sessions, allowedRoles = null) {
        const session = sessions[sessionPin];
        if (!session) {
            console.log(`❌ Session ${sessionPin} nicht gefunden`);
            return;
        }
        
        const clients = [];
        
        // 1. HOSTS
        if (session.hosts && session.hosts.length > 0) {
            session.hosts.forEach(host => {
                if (host.readyState === WebSocket.OPEN) {
                    clients.push(host);
                    console.log(`✅ Host ${host.clientId} bereit`);
                }
            });
        }
        
        // 2. PLAYERS (über gespeicherte ws-Referenz)
        console.log(`🔍 ${Object.keys(session.players).length} Spieler gefunden`);
        Object.values(session.players).forEach(player => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                clients.push(player.ws);
                console.log(`✅ Player ${player.id} (${player.name}) ws bereit`);
            } else {
                console.log(`❌ Player ${player.id} (${player.name || 'unknown'}) ws FEHLT/closed`);
            }
        });
        
        // 3. DISPLAYS
        if (session.displays && session.displays.length > 0) {
            session.displays.forEach(display => {
                if (display.readyState === WebSocket.OPEN) {
                    clients.push(display);
                }
            });
        }
        
        console.log(`📤 ${message.type} an ${clients.length} Clients:`, JSON.stringify(message));
        
        clients.forEach((client, index) => {
            if (Array.isArray(allowedRoles) && !allowedRoles.includes(client.role)) {
                return;
            }
            try {
                client.send(JSON.stringify(message));
                console.log(`  → Client ${client.clientId} (${client.role || 'unknown'}) OK`);
            } catch (e) {
                console.log(`  ❌ Client ${client.clientId} Fehler:`, e.message);
            }
        });
    }
    
    async function handleClientDisconnect(ws, sessions) {
        const sessionPin = ws.sessionPin;
        if (!sessionPin || !sessions[sessionPin]) return;
        
        const session = sessions[sessionPin];
        let playerRemoval = null;
        if (ws.role === 'player') {
            const player = session.players[ws.clientId];
            if (player && player.ws === ws && session.state && session.state !== 'lobby') {
                player.ws = null;
            } else if (player && player.ws === ws) {
                delete session.players[ws.clientId];
                if (player.playerToken) playerRemoval = deleteSessionPlayer(sessionPin, player);
            }
        } else if (ws.role === 'host') {
            session.hosts = session.hosts.filter(h => h !== ws);
            if (session.hosts.length > 0) {
                session.hostName = session.hosts[0].nickname || session.hostName || 'Spielleiter';
            } else {
                session.hostName = 'Spielleiter';
            }
        } else if (ws.role === 'display') {
            session.displays = session.displays.filter(d => d !== ws);
        }
        
        // Lobby Update nach Disconnect
        const statusLiteral = mapStateToStatusLiteral(session.state);
        session.statusLiteral = statusLiteral;
        const lobbyData = {
            type: 'lobby_update',
            data: {
                playerCount: Object.keys(session.players).length,
                playerList: Object.values(session.players).map(p => ({ id: p.id, name: p.name })),
                blockedPlayers: Array.from(session.kickedNicknames || []),
                blockedPlayerCount: Array.from(session.kickedNicknames || []).length,
                hostName: session.hostName || (session.hosts && session.hosts[0] ? session.hosts[0].nickname : 'Spielleiter'),
                quizTitle: session.quiz_title || session.quiz_name || 'Quiz',
                quizDescription: session.quiz_description || session.description || '',
                quizImage: session.quiz_image_url || '',
                questionCount: Number(session.quiz_question_count || 0),
                state: session.state || 'lobby',
                statusLiteral
            }
        };
        broadcastToSession(sessionPin, lobbyData, sessions, ['player', 'display']);
        broadcastToSession(sessionPin, {
            ...lobbyData,
            data: {
                ...lobbyData.data,
                quizPreview: Array.isArray(session.quiz_preview) ? session.quiz_preview : []
            }
        }, sessions, ['host']);
        if (playerRemoval) await playerRemoval;
    }
    
    return {
        loadSessionData,
        loadSessionHostTokenHash,
        buildLiveAnswerStats,
        buildDisplayLiveAnswerStats,
        saveSessionPlayer,
        flushSessionPlayerWrites,
        saveSessionAnswer,
        persistCanonicalAnswer,
        rebuildSessionResults,
        deleteSessionPlayer,
        hydrateSessionQuizMeta,
            loadSessionResults,
            loadAnonymousShortTextAnswers,
            loadQuestionStats,
            mapStateToStatusLiteral,
        loadNextQuestion,
        broadcastToSession,
        handleClientDisconnect
    };
}

module.exports = utilsFactory;
