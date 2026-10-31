// realtime-node/quiz.js KOMPLETT ersetzen:
const { loadConfig } = require('./config');
const questionTypes = require('./question-types');
const { getDbPool } = require('./db');
const rankingUtils = require('./ranking');
const roundResults = require('./round-results');
const runtimeConfig = loadConfig();

async function getConnection() {
    return getDbPool(runtimeConfig.db).getConnection();
}

function getFinalSessionState() {
    return runtimeConfig?.gameplay?.useEndresultState ? 'endresult' : 'finished';
}

function getQuestionType(question) {
    return questionTypes.getQuestionType(question).type;
}

function getQuestionTimeLimit(question) {
    return Number(question?.time_limit || 15);
}

function getAnswerTimeMs(answerStartTime, receivedAtMs = Date.now()) {
    return Math.max(0, Math.trunc(Number(receivedAtMs) - Number(answerStartTime)));
}

function buildPublicQuestion(question) {
    return questionTypes.buildPublicQuestion(question);
}

function getSubmittedAnswer(msg, questionType) {
    return questionTypes.getQuestionType(questionType).normalizeSubmission(msg);
}

function getPhaseDuration(session, phase) {
    const values = {
        start: session.quiz_start_phase_seconds,
        question: session.quiz_question_phase_seconds,
        options: session.quiz_options_phase_seconds,
        answer: getQuestionTimeLimit(session.question),
        solution: session.quiz_solution_phase_seconds
    };
    return Math.max(1, Number(values[phase] || 2));
}

function clearAutomaticTimer(session) {
    if (session?.automaticTimer) {
        clearTimeout(session.automaticTimer);
        session.automaticTimer = null;
    }
}

async function runSessionTransition(session, ws, operation) {
    if (session.transitioning || session.finishingPromise) {
        if (ws?.readyState === 1) {
            ws.send(JSON.stringify({
                type: 'action_rejected',
                data: { reason: 'Ein Phasenwechsel wird noch verarbeitet. Bitte kurz warten.' }
            }));
        }
        return;
    }
    session.transitioning = true;
    try {
        return await operation();
    } finally {
        session.transitioning = false;
    }
}

async function waitForPendingAnswers(session) {
    while (session.pendingAnswers?.size) {
        await Promise.all(Array.from(session.pendingAnswers));
    }
}

async function runSessionFinishing(session, operation) {
    const pending = operation();
    session.finishingPromise = pending;
    try {
        return await pending;
    } finally {
        if (session.finishingPromise === pending) delete session.finishingPromise;
    }
}

async function beginPhaseTiming(sessionPin, session, phase) {
    const startedAt = Date.now();
    const deadlineAt = startedAt + getPhaseDuration(session, phase) * 1000;
    session.phaseStartedAt = startedAt;
    session.phaseDeadlineAt = deadlineAt;
    if (phase === 'answer') {
        session.answerStartTime = startedAt;
    }
    await updateSessionState(sessionPin, {
        phase_started_ms: startedAt,
        phase_deadline_ms: deadlineAt
    });
}

function scheduleAutomaticTransition(session, expectedState, transition) {
    clearAutomaticTimer(session);
    if (!session?.quiz_automatic_mode) return;

    const deadlineAt = Number(session.phaseDeadlineAt || 0);
    const remainingMs = deadlineAt > 0
        ? Math.max(0, deadlineAt - Date.now())
        : getPhaseDuration(session, expectedState) * 1000;
    session.automaticTimer = setTimeout(async () => {
        session.automaticTimer = null;
        if (session.state !== expectedState) return;
        try {
            await transition();
        } catch (error) {
            console.error(`Automatic ${expectedState} transition failed:`, error.message);
            for (const host of session.hosts || []) {
                if (host.readyState === 1) {
                    host.send(JSON.stringify({
                        type: 'action_rejected',
                        data: { reason: 'Der automatische Phasenwechsel ist fehlgeschlagen. Bitte erneut versuchen.' }
                    }));
                }
            }
        }
    }, remainingMs);
}

function calculateDynamicPoints(question, answerTimeSeconds) {
    const totalTimeSeconds = Math.max(1, Number(question?.time_limit || 15));
    const maxPoints = Math.max(0, Number(question?.points_max || question?.max_points || 100));
    const minPoints = Math.max(0, Number(question?.points_min || question?.min_points || 40));
    const pointsDelay = Math.max(0, Number(question?.points_delay || question?.delay || 0));
    const pointsDecayTime = Math.max(1, Number(question?.points_decay_time || question?.decay_time || totalTimeSeconds));

    const effectiveDelay = Math.min(pointsDelay, totalTimeSeconds);
    const decayWindow = Math.max(1, pointsDecayTime);
    const elapsed = Math.max(0, Number(answerTimeSeconds || 0));

    if (elapsed <= effectiveDelay) {
        return maxPoints;
    }

    const timeSinceDelay = Math.min(Math.max(0, elapsed - effectiveDelay), decayWindow);
    const decayProgress = decayWindow > 0 ? timeSinceDelay / decayWindow : 1;
    const interpolated = maxPoints - ((maxPoints - minPoints) * decayProgress);
    return Math.round(Math.max(minPoints, interpolated));
}

function isCorrectAnswer(question, msg) {
    const definition = questionTypes.getQuestionType(question);
    return definition.evaluate(question, definition.normalizeSubmission(msg));
}

function buildSolutionPayload(session) {
    const question = session.question || null;
    if (!question) {
        return {};
    }

    return questionTypes.buildSolution(question);
}

function broadcastLiveAnswerStats(sessionPin, session, sessions, utils) {
    const stats = utils.buildLiveAnswerStats(session);
    const threshold = Math.max(1, Number(session.live_tracking_threshold || 1));
    utils.broadcastToSession(sessionPin, {
        type: 'live_answer_stats',
        data: {
            ...stats,
            enabled: Boolean(session.live_tracking_enabled),
            threshold,
            correctnessVisible: true
        }
    }, sessions, ['host']);

    utils.broadcastToSession(sessionPin, {
        type: 'live_answer_stats',
        data: utils.buildDisplayLiveAnswerStats(stats, session.live_tracking_enabled, threshold)
    }, sessions, ['display']);
}

function broadcastQuizFinished(sessionPin, session, data, sessions, utils, ranking) {
    const rankingData = ranking.getRankingData(session.players);
    const message = {
        type: 'quiz_finished',
        data: {
            ...data,
            ranking: rankingData.ranking.length ? rankingData.ranking : (data.ranking || []),
            ...(rankingData.ranking.length
                ? { rankingTrend: roundResults.buildRankingTrend(session, rankingData).trend }
                : {})
        }
    };
    utils.broadcastToSession(sessionPin, message, sessions, ['host', 'display']);
    for (const [player, ownPlacement] of rankingData.placements) {
        if (player.ws?.readyState === 1) {
            player.ws.send(JSON.stringify({
                ...message,
                data: { ...message.data, ownPlacement }
            }));
        }
    }
}

async function updateSessionState(sessionPin, values, options = {}) {
    let connection;
    try {
        connection = await getConnection();

        const fields = [];
        const params = [];

        if (Object.prototype.hasOwnProperty.call(values, 'state')) {
            fields.push('state = ?');
            params.push(values.state);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'current_question_index')) {
            fields.push('current_question_index = ?');
            params.push(values.current_question_index);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'presentation_view')) {
            fields.push('presentation_view = ?');
            params.push(values.presentation_view);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'live_tracking_enabled')) {
            fields.push('live_tracking_enabled = ?');
            params.push(values.live_tracking_enabled ? 1 : 0);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'live_tracking_threshold')) {
            fields.push('live_tracking_threshold = ?');
            params.push(values.live_tracking_threshold);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'phase_started_ms')) {
            fields.push('phase_started_ms = ?');
            params.push(values.phase_started_ms);
        }

        if (Object.prototype.hasOwnProperty.call(values, 'phase_deadline_ms')) {
            fields.push('phase_deadline_ms = ?');
            params.push(values.phase_deadline_ms);
        }

        if (fields.length > 0) {
            params.push(sessionPin);
            const [result] = await connection.execute(`UPDATE sessions SET ${fields.join(', ')} WHERE pin = ?`, params);
            if (options.throwOnError && result.affectedRows === 0) {
                throw new Error(`Session ${sessionPin} was not found while updating its state.`);
            }
        }

    } catch (dbError) {
        console.log('Session state update skipped:', dbError.message);
        if (options.throwOnError) throw dbError;
    } finally {
        connection?.release();
    }
}

async function handleHostStartQuiz(ws, msg, sessions, utils, ranking) {
    console.log(`🔍 DEBUG: ws.role='${ws.role}', expected='host'`);
    
    if (ws.role !== 'host') {
        console.log(`❌ NICHT Host: role='${ws.role}'`);
        return;
    }
    
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    
    if (!session) {
        console.log(`❌ Session ${sessionPin} nicht gefunden`);
        return;
    }

    if (session.state !== 'lobby') return;

    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);
        console.log(`🎯 Quiz START in ${sessionPin} (${Object.keys(session.players).length} Spieler)`);

        session.state = 'start';
        session.current_question_index = 0;
        session.answerStartTime = null;
        session.question = null;
        session.phaseStartedAt = null;
        session.phaseDeadlineAt = null;

        const stateUpdate = {
            state: session.state,
            current_question_index: session.current_question_index
        };
        if (session.quiz_automatic_mode) {
            await updateSessionState(sessionPin, stateUpdate);
            await beginPhaseTiming(sessionPin, session, 'start');
        } else {
            await updateSessionState(sessionPin, {
                ...stateUpdate,
                phase_started_ms: null,
                phase_deadline_ms: null
            });
        }

        utils.broadcastToSession(sessionPin, {
            type: 'quiz_starting',
            data: {
                state: 'start',
                automaticMode: Boolean(session.quiz_automatic_mode),
                phaseDurations: {
                    start: getPhaseDuration(session, 'start'),
                    question: getPhaseDuration(session, 'question'),
                    answer: getPhaseDuration(session, 'answer'),
                    options: getPhaseDuration(session, 'options'),
                    solution: getPhaseDuration(session, 'solution')
                },
                quizTitle: session.quiz_title || session.quiz_name || 'Quiz',
                quizDescription: session.quiz_description || session.description || '',
                quizImage: session.quiz_image_url || '',
                questionCount: Number(session.quiz_question_count || 0),
                timeLeft: session.quiz_automatic_mode ? getPhaseDuration(session, 'start') : null,
                playerCount: Object.keys(session.players || {}).length,
                playerList: Object.values(session.players || {}).map(player => ({ id: player.id, name: player.name })),
                hostName: session.hostName || ws.nickname || 'Spielleiter'
            },
        }, sessions);
        scheduleAutomaticTransition(session, 'start', () => handleHostShowFirstQuestion(ws, msg, sessions, utils, ranking));
    });
}

async function handleHostShowFirstQuestion(ws, msg, sessions, utils, ranking) {
    if (ws.role !== 'host') return;

    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session || session.state !== 'start') return;

    await runSessionTransition(session, ws, async () => {
        session.state = 'question';
        session.current_question_index = 0;
        await utils.loadNextQuestion(sessionPin, session);

        if (!session.question) {
            console.log(`❌ Keine Frage für ${sessionPin} geladen`);
            session.state = getFinalSessionState();
            await runSessionFinishing(session, async () => {
                try {
                    await updateSessionState(sessionPin, { state: session.state }, { throwOnError: true });
                } catch (error) {
                    session.state = 'start';
                    throw error;
                }
                broadcastQuizFinished(sessionPin, session, {
                    message: 'Keine gültigen Fragen für diese Session gefunden.'
                }, sessions, utils, ranking);
            });
            return;
        }

        console.log(`📋 Frage: ${session.question.text}`);

        await beginPhaseTiming(sessionPin, session, 'question');

        await updateSessionState(sessionPin, {
            state: session.state,
            current_question_index: session.current_question_index
        });

        const quizStartMsg = {
            type: 'quiz_started',
            data: {
                question: buildPublicQuestion(session.question),
                timeLeft: getPhaseDuration(session, 'question'),
                state: 'question'
            }
        };

        utils.broadcastToSession(sessionPin, quizStartMsg, sessions);
        broadcastLiveAnswerStats(sessionPin, session, sessions, utils);
        console.log(`📤 quiz_started an ${Object.keys(session.players).length} Spieler gesendet`);
        scheduleAutomaticTransition(session, 'question', () => handleHostShowAnswerOptions(ws, msg, sessions, utils, ranking));
    });
}

async function handleHostStartAnswerPhase(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];

    if (ws.role !== 'host' || !session || session.state !== 'options' || !session.question) return;

    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);

        session.state = 'answer';
        await beginPhaseTiming(sessionPin, session, 'answer');
        Object.values(session.players).forEach(player => {
            player.answered = false;
        });

        await Promise.all(Object.values(session.players).map(player => utils.saveSessionPlayer(sessionPin, player)));

        await updateSessionState(sessionPin, { state: session.state });

        utils.broadcastToSession(sessionPin, {
            type: 'answer_phase_started',
            data: {
                question: buildPublicQuestion(session.question),
                timeLeft: getQuestionTimeLimit(session.question),
                state: 'answer'
            }
        }, sessions);
        scheduleAutomaticTransition(session, 'answer', () => handleHostEndAnswerPhase(ws, msg, sessions, utils, ranking));
    });
}

async function handleHostShowAnswerOptions(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];

    if (ws.role !== 'host' || !session || session.state !== 'question' || !session.question) return;

    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);

        session.state = 'options';
        await beginPhaseTiming(sessionPin, session, 'options');
        await updateSessionState(sessionPin, { state: session.state });

        utils.broadcastToSession(sessionPin, {
            type: 'answer_options_shown',
            data: {
                question: buildPublicQuestion(session.question),
                timeLeft: getPhaseDuration(session, 'options'),
                state: 'options'
            }
        }, sessions);
        scheduleAutomaticTransition(session, 'options', () => handleHostStartAnswerPhase(ws, msg, sessions, utils, ranking));
    });
}

async function upsertSessionResult(sessionPin, player, session, correct, points) {
    let connection;
    try {
        connection = await getConnection();

        const nickname = String(player.nickname || player.name || 'Player').slice(0, 100);
        const safePoints = Math.max(0, Number(points || 0));
        const safeCorrect = correct ? 1 : 0;
        const safeAnswered = 1;

        await connection.execute(`
            INSERT INTO session_results (session_pin, player_id, nickname, points, correct_answers, answered_questions)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                nickname = VALUES(nickname),
                points = points + VALUES(points),
                correct_answers = correct_answers + VALUES(correct_answers),
                answered_questions = answered_questions + VALUES(answered_questions)
        `, [sessionPin, player.clientId || player.id || 0, nickname, safePoints, safeCorrect, safeAnswered]);

    } catch (dbError) {
        console.log('Session result update skipped:', dbError.message);
    } finally {
        connection?.release();
    }
}

async function saveShortTextReview(sessionPin, ws, player, question, answerText) {
    let connection;
    try {
        connection = await getConnection();

        await connection.execute(`
            INSERT INTO short_text_reviews (session_pin, player_id, nickname, question_id, answer_text, player_token)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                answer_text = VALUES(answer_text),
                player_token = VALUES(player_token),
                reviewed = 0,
                approved = NULL,
                points_awarded = 0,
                review_comment = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL
        `, [sessionPin, player.databaseId, ws.nickname || 'Player', question.id, answerText, player.playerToken]);

    } catch (dbError) {
        console.log('Short text review save skipped:', dbError.message);
    } finally {
        connection?.release();
    }
}

async function sendReviewQueue(sessionPin, sessions, utils) {
    let connection;
    try {
        connection = await getConnection();

        const [rows] = await connection.execute(
            `SELECT review.id, review.session_pin, review.player_id, review.nickname,
                review.question_id, review.answer_text, review.reviewed, review.approved,
                question.points_max
             FROM short_text_reviews review
             INNER JOIN questions question ON question.id = review.question_id
             WHERE review.session_pin = ? AND review.reviewed = 0
             ORDER BY review.created_at ASC`,
            [sessionPin]
        );
        connection.release();
        connection = null;

        if (sessionPin && sessions[sessionPin] && sessions[sessionPin].hosts) {
            sessions[sessionPin].hosts.forEach(hostWs => {
                if (hostWs && hostWs.readyState === 1) {
                    hostWs.send(JSON.stringify({
                        type: 'review_queue_updated',
                        data: { reviews: rows }
                    }));
                }
            });
        }
    } catch (dbError) {
        console.error('Review queue send failed:', dbError.message);
        for (const hostWs of sessions[sessionPin]?.hosts || []) {
            if (hostWs.readyState === 1) {
                hostWs.send(JSON.stringify({
                    type: 'review_queue_error',
                    data: { reason: 'Offene Freitextbewertungen konnten nicht geladen werden.' }
                }));
            }
        }
    } finally {
        connection?.release();
    }
}

async function handlePlayerSubmitAnswer(ws, msg, sessions, utils) {
    const { sessionPin } = msg;
    const session = sessions[sessionPin];
    if (!session || !session.question) {
        return;
    }

    const player = session.players[ws.clientId];
    
    if (!player || player.answered) {
        return;
    }

    if (session.state !== 'answer' || session.transitioning) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({
                type: 'answer_rejected',
                data: { reason: 'Die Antwortzeit ist abgelaufen.' }
            }));
        }
        return;
    }
    
    const receivedAtMs = Date.now();
    const answerTime = getAnswerTimeMs(session.answerStartTime, receivedAtMs);
    const answerDeadlineAt = Number(session.phaseDeadlineAt || 0);
    const answerDeadline = getQuestionTimeLimit(session.question) * 1000;
    if (!session.answerStartTime || (answerDeadlineAt > 0 ? receivedAtMs > answerDeadlineAt : answerTime > answerDeadline)) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({
                type: 'answer_rejected',
                data: { reason: 'Die Antwortzeit ist abgelaufen.' }
            }));
        }
        return;
    }
    const answerTimeSeconds = Math.max(0, answerTime / 1000);
    const points = calculateDynamicPoints(session.question, answerTimeSeconds);
    const questionDefinition = questionTypes.getQuestionType(session.question);
    const questionType = questionDefinition.type;
    const submittedAnswer = getSubmittedAnswer(msg, questionType);
    const requiresReview = Boolean(questionDefinition.requiresReview);
    
    let correct = false;
    if (!requiresReview) {
        correct = isCorrectAnswer(session.question, msg);
    }

    const currentAnswer = {
        questionId: Number(session.question.id),
        submittedAnswer,
        answerTimeMs: answerTime,
        isCorrect: correct,
        pointsAwarded: correct ? Math.round(points) : 0
    };
    const persistence = await utils.persistCanonicalAnswer(
        sessionPin,
        player,
        session.question,
        currentAnswer
    );

    player.databaseId = persistence.playerId;
    player.points = persistence.points;
    player.answered = persistence.answered;
    player.currentAnswer = persistence.answer;

    if (!persistence.inserted) {
        return;
    }

    if (requiresReview) {
        await saveShortTextReview(sessionPin, ws, player, session.question, msg.answerText || '');
        await sendReviewQueue(sessionPin, sessions, utils);
    } else if (correct) {
        console.log(`✅ ${ws.nickname}: ${Math.round(points)} Punkte!`);
    }
    
    utils.broadcastToSession(sessionPin, {
        type: 'player_answered',
        data: { playerId: ws.clientId, answered: true, reviewMode: requiresReview }
    }, sessions, ['host']);

    broadcastLiveAnswerStats(sessionPin, session, sessions, utils);
}

async function handleHostConfigureLiveTracking(ws, msg, sessions, utils) {
    const session = sessions[ws.sessionPin];
    if (!session) return;

    const threshold = Number(msg.threshold);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'action_rejected', data: { reason: 'Die Live-Schwelle muss zwischen 1 und 1000 liegen.' } }));
        }
        return;
    }

    session.live_tracking_enabled = Boolean(msg.enabled);
    session.live_tracking_threshold = threshold;
    await updateSessionState(ws.sessionPin, {
        live_tracking_enabled: session.live_tracking_enabled,
        live_tracking_threshold: threshold
    });

    broadcastLiveAnswerStats(ws.sessionPin, session, sessions, utils);
}

async function handlePlayerAnswerSingle(ws, msg, sessions, utils) {
    const session = sessions[msg.sessionPin];
    const player = session?.players?.[ws.clientId];
    const pending = handlePlayerSubmitAnswer(ws, msg, sessions, utils);
    if (!session) return pending;

    if (!session.pendingAnswers) session.pendingAnswers = new Set();
    session.pendingAnswers.add(pending);
    if (player) {
        if (!player.pendingAnswers) player.pendingAnswers = new Set();
        player.pendingAnswers.add(pending);
    }
    try {
        return await pending;
    } finally {
        session.pendingAnswers.delete(pending);
        player?.pendingAnswers?.delete(pending);
    }
}

async function handleHostEndAnswerPhase(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    
    if (ws.role !== 'host' || !session || session.state !== 'answer') return;

    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);
        await waitForPendingAnswers(session);

        console.log(`📊 Ergebnis-Phase Ende`);

        const rankingData = ranking.getRankingData(session.players);
        const currentRanking = rankingData.ranking;
        session.state = 'solution';
        session.presentation_view = 'solution';
        await beginPhaseTiming(sessionPin, session, 'solution');
        await updateSessionState(sessionPin, {
            state: session.state,
            presentation_view: session.presentation_view
        });
        const questionStats = utils.loadQuestionStats
            ? await utils.loadQuestionStats(sessionPin, session.question?.id)
            : null;
        const roundData = roundResults.buildRoundData(session);
        const solutionData = {
            ...buildSolutionPayload(session),
            timeLeft: getPhaseDuration(session, 'solution'),
            presentationView: session.presentation_view,
            questionStats
        };
        utils.broadcastToSession(sessionPin, {
            type: 'show_solution',
            data: {
                ...solutionData,
                ranking: currentRanking,
                ...roundResults.buildPublicRoundPayload(session, rankingData, roundData)
            }
        }, sessions, ['host', 'display']);

        Object.values(session.players).forEach(player => {
            if (!player.ws || player.ws.readyState !== 1) return;
            const currentAnswer = Number(player.currentAnswer?.questionId) === Number(session.question.id)
                ? player.currentAnswer
                : null;
            player.ws.send(JSON.stringify({
                type: 'show_solution',
                data: {
                    ...solutionData,
                    playerResult: currentAnswer,
                    ...roundResults.buildPlayerRoundPayload(session, player, { rankingData, roundData })
                }
            }));
        });

        scheduleAutomaticTransition(session, 'solution', () => handleHostNextQuestion(ws, msg, sessions, utils, ranking));
    });
}

async function handleHostNextQuestion(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    
    if (ws.role !== 'host' || !session || session.state !== 'solution') return;

    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);
        if (utils.flushSessionPlayerWrites) await utils.flushSessionPlayerWrites(sessionPin);

        console.log(`➡️ Nächste Frage`);

        const previousIndex = session.current_question_index;
        const previousQuestion = session.question;
        session.current_question_index++;
        try {
            await utils.loadNextQuestion(sessionPin, session, { throwOnError: true });
        } catch (error) {
            session.current_question_index = previousIndex;
            session.question = previousQuestion;
            session.state = 'solution';
            throw error;
        }

        if (session.state === 'finished' || session.state === 'endresult') {
            session.state = getFinalSessionState();
            await runSessionFinishing(session, async () => {
                try {
                    await updateSessionState(sessionPin, {
                        state: session.state,
                        current_question_index: session.current_question_index
                    }, { throwOnError: true });
                } catch (error) {
                    session.current_question_index = previousIndex;
                    session.question = previousQuestion;
                    session.state = 'solution';
                    throw error;
                }
                const results = utils.loadSessionResults
                    ? await utils.loadSessionResults(sessionPin, { throwOnError: true })
                    : [];
                broadcastQuizFinished(sessionPin, session, { results }, sessions, utils, ranking);
            });
            return;
        }

        await updateSessionState(sessionPin, { current_question_index: session.current_question_index });
        Object.values(session.players).forEach(p => p.answered = false);
        await Promise.all(Object.values(session.players).map(player => utils.saveSessionPlayer(sessionPin, player)));
        session.answerStartTime = null;
        session.state = 'question';
        await beginPhaseTiming(sessionPin, session, 'question');
        await updateSessionState(sessionPin, { state: session.state });

        utils.broadcastToSession(sessionPin, {
            type: 'next_question',
            data: { question: buildPublicQuestion(session.question), timeLeft: getPhaseDuration(session, 'question'), state: 'question' }
        }, sessions);
        broadcastLiveAnswerStats(sessionPin, session, sessions, utils);
        scheduleAutomaticTransition(session, 'question', () => handleHostShowAnswerOptions(ws, msg, sessions, utils, ranking));
    });
}

async function handleHostEndQuiz(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    
    if (ws.role !== 'host') return;

    if (!session) {
        await updateSessionState(sessionPin, { state: getFinalSessionState() }, { throwOnError: true });
        return;
    }
    await runSessionTransition(session, ws, async () => {
        clearAutomaticTimer(session);
        await runSessionFinishing(session, async () => {
            await waitForPendingAnswers(session);
            if (utils.flushSessionPlayerWrites) await utils.flushSessionPlayerWrites(sessionPin);

            const previousState = session.state;
            const previousStartedAt = session.phaseStartedAt;
            const previousDeadlineAt = session.phaseDeadlineAt;
            session.state = getFinalSessionState();
            session.phaseStartedAt = null;
            session.phaseDeadlineAt = null;
            try {
                await updateSessionState(sessionPin, {
                    state: session.state,
                    current_question_index: session.current_question_index,
                    phase_started_ms: null,
                    phase_deadline_ms: null
                }, { throwOnError: true });
            } catch (error) {
                session.state = previousState;
                session.phaseStartedAt = previousStartedAt;
                session.phaseDeadlineAt = previousDeadlineAt;
                throw error;
            }

            const results = utils.loadSessionResults
                ? await utils.loadSessionResults(sessionPin, { throwOnError: true })
                : [];
            broadcastQuizFinished(sessionPin, session, {
                results,
                message: 'Das aktuelle Quiz ist beendet.'
            }, sessions, utils, ranking);
        });
    });
}

function restoreAutomaticTransition(sessionPin, session, utils, ranking) {
    if (!session?.quiz_automatic_mode || session.automaticTimer) return;
    const systemHost = { role: 'host', sessionPin, nickname: 'System' };
    const transitions = {
        start: () => handleHostShowFirstQuestion(systemHost, {}, { [sessionPin]: session }, utils, ranking),
        question: () => handleHostShowAnswerOptions(systemHost, {}, { [sessionPin]: session }, utils, ranking),
        options: () => handleHostStartAnswerPhase(systemHost, {}, { [sessionPin]: session }, utils, ranking),
        answer: () => handleHostEndAnswerPhase(systemHost, {}, { [sessionPin]: session }, utils, ranking),
        solution: () => handleHostNextQuestion(systemHost, {}, { [sessionPin]: session }, utils, ranking)
    };
    const transition = transitions[session.state];
    if (transition) scheduleAutomaticTransition(session, session.state, transition);
}

async function handleHostSelectPresentationView(ws, msg, sessions, utils) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    const allowedViews = new Set(['solution', 'top10', 'ranking', 'free_text']);
    const requestedView = String(msg.view || '').toLowerCase();
    const allowedStates = new Set(['solution', 'endresult', 'finished']);

    if (ws.role !== 'host' || !session || !allowedStates.has(session.state) || !allowedViews.has(requestedView)) {
        return;
    }

    const results = utils.loadSessionResults ? await utils.loadSessionResults(sessionPin) : [];
    const rankingData = rankingUtils.getRankingData(session.players);
    const currentRanking = rankingData.ranking;
    const presentationRanking = currentRanking.length ? currentRanking : results;
    const visibleRanking = requestedView === 'top10' ? presentationRanking.slice(0, 10) : presentationRanking;
    const questionId = session.question?.id || null;
    const freeTextAnswers = requestedView === 'free_text' && utils.loadAnonymousShortTextAnswers
        ? await utils.loadAnonymousShortTextAnswers(sessionPin, questionId)
        : [];
    const questionStats = utils.loadQuestionStats
        ? await utils.loadQuestionStats(sessionPin, questionId)
        : null;

    session.presentation_view = requestedView;
    await updateSessionState(sessionPin, { presentation_view: requestedView });
    utils.broadcastToSession(sessionPin, {
        type: 'presentation_view_changed',
        data: {
            view: requestedView,
            ranking: visibleRanking,
            freeTextAnswers,
            questionStats,
            ...(currentRanking.length
                ? { rankingTrend: roundResults.buildRankingTrend(session, rankingData).trend.slice(0, visibleRanking.length) }
                : {})
        }
    }, sessions, ['host', 'display']);

    if (session.state !== 'solution') return;
    const roundData = roundResults.buildRoundData(session);
    const trendData = roundResults.buildRankingTrend(session, rankingData);
    Object.values(session.players || {}).forEach(player => {
        if (player.ws?.readyState !== 1) return;
        player.ws.send(JSON.stringify({
            type: 'presentation_view_changed',
            data: {
                view: requestedView,
                ...roundResults.buildPlayerRoundPayload(session, player, { rankingData, roundData, trendData })
            }
        }));
    });
}

async function handleReviewShortTextAnswer(ws, msg, sessions, utils) {
    if (ws.role !== 'host') return;

    let connection;
    try {
        connection = await getConnection();

        await connection.beginTransaction();
        const [reviewRows] = await connection.execute(`
            SELECT review.player_token, review.question_id, question.points_max
            FROM short_text_reviews review
            INNER JOIN questions question ON question.id = review.question_id
            WHERE review.id = ? AND review.session_pin = ?
            FOR UPDATE
        `, [msg.reviewId, ws.sessionPin]);
        if (!reviewRows.length) {
            await connection.rollback();
            connection.release();
            connection = null;
            return;
        }

        const review = reviewRows[0];
        const maximumPoints = Math.max(0, Number(review.points_max || 0));
        const requestedPoints = msg.points === undefined
            ? (msg.approved ? maximumPoints : 0)
            : Number(msg.points);
        if (!Number.isInteger(requestedPoints) || requestedPoints < 0 || requestedPoints > maximumPoints) {
            await connection.rollback();
            connection.release();
            connection = null;
            if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'review_rejected',
                    data: { reason: `Punkte muessen zwischen 0 und ${maximumPoints} liegen.` }
                }));
            }
            return;
        }

        await connection.execute(`
            UPDATE session_answers
            SET points_awarded = ?, is_correct = ?
            WHERE session_pin = ? AND player_token = ? AND question_id = ?
        `, [requestedPoints, requestedPoints === maximumPoints ? 1 : 0, ws.sessionPin, review.player_token, review.question_id]);
        await connection.execute(`
            UPDATE short_text_reviews
            SET reviewed = 1, approved = ?, points_awarded = ?, review_comment = ?,
                reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3)
            WHERE id = ? AND session_pin = ?
        `, [requestedPoints === maximumPoints ? 1 : 0, requestedPoints, String(msg.comment || '').slice(0, 2000), ws.nickname || 'Host', msg.reviewId, ws.sessionPin]);
        await connection.execute(`
            UPDATE session_players player
            LEFT JOIN (
                SELECT player_token, COALESCE(SUM(points_awarded), 0) AS points
                FROM session_answers
                WHERE session_pin = ? AND player_token = ?
                GROUP BY player_token
            ) totals ON totals.player_token = player.player_token
            SET player.points = COALESCE(totals.points, 0)
            WHERE player.session_pin = ? AND player.player_token = ?
        `, [ws.sessionPin, review.player_token, ws.sessionPin, review.player_token]);
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
        `, [ws.sessionPin, review.player_token]);
        await connection.commit();
        connection.release();
        connection = null;

        const sessionPin = ws.sessionPin;
        const session = sessions[sessionPin];
        const results = await utils.loadSessionResults(sessionPin);
        if (session && session.players) {
            const player = Object.values(session.players).find(entry => entry.playerToken === review.player_token);
            if (player) {
                const playerResult = results.find(entry => Number(entry.player_id) === Number(player.databaseId || player.id));
                player.points = Number(playerResult?.points || 0);
                if (Number(player.currentAnswer?.questionId) === Number(review.question_id)) {
                    player.currentAnswer.pointsAwarded = requestedPoints;
                    player.currentAnswer.isCorrect = requestedPoints === maximumPoints;
                    player.currentAnswer.isReviewed = true;
                }
                if (player.ws?.readyState === 1) {
                    player.ws.send(JSON.stringify({
                        type: 'short_text_reviewed',
                        data: {
                            questionId: Number(review.question_id),
                            pointsAwarded: requestedPoints,
                            pointsMaximum: maximumPoints,
                            comment: String(msg.comment || '').slice(0, 2000)
                        }
                    }));
                }
            }
        }
        if (session) {
            broadcastLiveAnswerStats(sessionPin, session, sessions, utils);
        }

        const rankingData = rankingUtils.getRankingData(session?.players);
        const updatedRanking = rankingData.ranking.length
            ? rankingData.ranking
            : results.map(result => ({ rank: result.rank, name: result.name, points: result.points }));
        const questionStats = session?.state === 'solution' && session.question?.id && utils.loadQuestionStats
            ? await utils.loadQuestionStats(sessionPin, session.question.id)
            : null;
        const isSolution = session?.state === 'solution';
        const roundData = isSolution ? roundResults.buildRoundData(session) : null;
        utils.broadcastToSession(sessionPin, {
            type: 'ranking_updated',
            data: {
                ranking: updatedRanking,
                results,
                questionStats,
                ...(isSolution ? roundResults.buildPublicRoundPayload(session, rankingData, roundData) : {})
            }
        }, sessions, ['host', 'display']);
        if (isSolution) {
            const trendData = roundResults.buildRankingTrend(session, rankingData);
            for (const rankedPlayer of rankingData.placements.keys()) {
                if (rankedPlayer.ws?.readyState === 1) {
                    rankedPlayer.ws.send(JSON.stringify({
                        type: 'ranking_updated',
                        data: {
                            questionStats,
                            ...roundResults.buildPlayerRoundPayload(session, rankedPlayer, { rankingData, roundData, trendData })
                        }
                    }));
                }
            }
        } else if (['finished', 'endresult'].includes(session?.state)) {
            for (const [rankedPlayer, ownPlacement] of rankingData.placements) {
                if (rankedPlayer.ws?.readyState === 1) {
                    rankedPlayer.ws.send(JSON.stringify({
                        type: 'ranking_updated',
                        data: { ranking: updatedRanking, ownPlacement, questionStats }
                    }));
                }
            }
        }

        await sendReviewQueue(ws.sessionPin, sessions, utils);
    } catch (dbError) {
        if (connection) {
            await connection.rollback().catch(() => {});
            connection.release();
        }
        console.log('Short text review update skipped:', dbError.message);
    }
}

// *** KRITISCH: ALLE FUNKTIONEN EXPORTIEREN ***
module.exports = {
    calculateDynamicPoints,
    getAnswerTimeMs,
    buildPublicQuestion,
    handleHostStartQuiz,
    handleHostShowFirstQuestion,
    handleHostShowAnswerOptions,
    handleHostStartAnswerPhase,
    handlePlayerAnswerSingle,
    handleHostEndAnswerPhase,
    handleHostNextQuestion,
    handleHostEndQuiz,
    waitForPendingAnswers,
    runSessionFinishing,
    handleHostSelectPresentationView,
    handleHostConfigureLiveTracking,
    broadcastLiveAnswerStats,
    broadcastQuizFinished,
    sendReviewQueue,
    restoreAutomaticTransition,
    handleReviewShortTextAnswer
};
