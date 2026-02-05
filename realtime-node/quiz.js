// realtime-node/quiz.js KOMPLETT ersetzen:
async function handleHostStartQuiz(ws, msg, sessions, utils) {
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
    
    console.log(`🎯 Quiz START in ${sessionPin} (${Object.keys(session.players).length} Spieler)`);
    
    session.state = 'question';
    session.current_question_index = 0;
    session.answerStartTime = Date.now();
    
    await utils.loadNextQuestion(sessionPin, session);
    
    console.log(`📋 Frage: ${session.question.text}`);
    
    const quizStartMsg = {
        type: 'quiz_started',
        data: { 
            question: session.question, 
            timeLeft: 15,
            state: 'question'
        }
    };
    
    utils.broadcastToSession(sessionPin, quizStartMsg, sessions);
    console.log(`📤 quiz_started an ${Object.keys(session.players).length} Spieler gesendet`);
}

async function handlePlayerAnswerSingle(ws, msg, sessions, utils) {
    const { sessionPin, answerIndex } = msg;
    const session = sessions[sessionPin];
    const player = session.players[ws.clientId];
    
    if (!player || player.answered || session.state !== 'question') {
        return;
    }
    
    const answerTime = Date.now() - session.answerStartTime;
    const points = Math.max(40, 100 - (answerTime / 1000) * 4);
    
    if (answerIndex === session.question.correct_option_index) {
        player.points += Math.round(points);
        console.log(`✅ ${ws.nickname}: ${Math.round(points)} Punkte!`);
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
    
    if (ws.role !== 'host' || session.state !== 'question') return;
    
    console.log(`📊 Ergebnis-Phase Ende`);
    
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
    
    if (ws.role !== 'host' || session.state !== 'solution') return;
    
    console.log(`➡️ Nächste Frage`);
    
    session.current_question_index++;
    
    if (session.current_question_index >= 2) {
        session.state = 'finished';
        const finalRanking = ranking.getRanking(session.players);
        utils.broadcastToSession(sessionPin, {
            type: 'quiz_finished',
            data: { ranking: finalRanking }
        }, sessions);
        return;
    }
    
    await utils.loadNextQuestion(sessionPin, session);
    Object.values(session.players).forEach(p => p.answered = false);
    session.answerStartTime = Date.now();
    session.state = 'question';
    
    utils.broadcastToSession(sessionPin, {
        type: 'next_question',
        data: { question: session.question, timeLeft: 15 }
    }, sessions);
}

async function handleHostEndQuiz(ws, msg, sessions, utils, ranking) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    
    if (ws.role !== 'host') return;
    
    console.log(`🏁 Quiz ENDE`);
    session.state = 'finished';
    
    const finalRanking = ranking.getRanking(session.players);
    utils.broadcastToSession(sessionPin, {
        type: 'quiz_finished',
        data: { ranking: finalRanking }
    }, sessions);
}

// *** KRITISCH: ALLE FUNKTIONEN EXPORTIEREN ***
module.exports = {
    handleHostStartQuiz,
    handlePlayerAnswerSingle,
    handleHostEndAnswerPhase,
    handleHostNextQuestion,
    handleHostEndQuiz
};
