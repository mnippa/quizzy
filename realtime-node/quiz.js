async function handleHostStartQuiz(ws, msg, sessions, utils) {
    if (ws.role !== 'host') return;

    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;

    session.state = 'question';
    session.current_question_index = 0;

    const hasQuestion = await utils.loadNextQuestion(sessionPin, session);
    if (!hasQuestion || !session.question) {
        session.state = 'finished';
        utils.broadcastToSession(sessionPin, {
            type: 'quiz_finished',
            data: { ranking: [] }
        }, sessions);
        return;
    }

    const quizStartMsg = {
        type: 'quiz_started',
        data: {
            question: session.question,
            timeLeft: 15,
            state: 'question'
        }
    };

    utils.broadcastToSession(sessionPin, quizStartMsg, sessions);
}

async function handlePlayerAnswerSingle(ws, msg, sessions, utils) {
    const { sessionPin, answerIndex } = msg;
    const session = sessions[sessionPin];
    if (!session || !session.question) return;

    const player = session.players[ws.clientId];
    if (!player || player.answered || session.state !== 'question') return;

    const answerTime = Date.now() - (session.answerStartTime || Date.now());
    const points = Math.max(40, 100 - (answerTime / 1000) * 4);

    if (answerIndex === session.question.correct_option_index) {
        player.points += Math.round(points);
    }

    player.answered = true;

    utils.broadcastToSession(sessionPin, {
        type: 'player_answered',
        data: { playerId: ws.clientId, answered: true }
    }, sessions);
}

async function handleHostEndAnswerPhase(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];

    if (!session || ws.role !== 'host' || session.state !== 'question' || !session.question) return;

    const currentRanking = ranking.getRanking(session.players);
    utils.broadcastToSession(sessionPin, {
        type: 'show_solution',
        data: {
            correctAnswer: session.question.correct_option_index,
            ranking: currentRanking
        }
    }, sessions);

    session.state = 'solution';
}

async function handleHostNextQuestion(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];

    if (!session || ws.role !== 'host' || session.state !== 'solution') return;

    session.current_question_index += 1;
    const hasQuestion = await utils.loadNextQuestion(sessionPin, session);

    if (!hasQuestion || !session.question) {
        session.state = 'finished';
        const finalRanking = ranking.getRanking(session.players);
        utils.broadcastToSession(sessionPin, {
            type: 'quiz_finished',
            data: { ranking: finalRanking }
        }, sessions);
        return;
    }

    Object.values(session.players).forEach((p) => {
        p.answered = false;
    });

    session.state = 'question';

    utils.broadcastToSession(sessionPin, {
        type: 'next_question',
        data: { question: session.question, timeLeft: 15 }
    }, sessions);
}

async function handleHostEndQuiz(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];

    if (!session || ws.role !== 'host') return;

    session.state = 'finished';

    const finalRanking = ranking.getRanking(session.players);
    utils.broadcastToSession(sessionPin, {
        type: 'quiz_finished',
        data: { ranking: finalRanking }
    }, sessions);
}

module.exports = {
    handleHostStartQuiz,
    handlePlayerAnswerSingle,
    handleHostEndAnswerPhase,
    handleHostNextQuestion,
    handleHostEndQuiz
};
