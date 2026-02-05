const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const PORT = 8080;
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'start123',
    database: 'quizgame'
};

const sessions = {};

const demoSessions = {
    '123456': {
        state: 'lobby',
        question: {
            id: 1,
            text: 'Welche Farbe hat der Himmel?',
            image: null,
            options: [
                { id: 1, text: 'Blau', isCorrect: true },
                { id: 2, text: 'Rot', isCorrect: false },
                { id: 3, text: 'Grün', isCorrect: false },
                { id: 4, text: 'Gelb', isCorrect: false }
            ]
        },
        players: {},
        hosts: [],
        displays: []
    }
};

let clientCounter = 0;

console.log('🚀 WebSocket-Server startet...');

async function loadSessionData(sessionPin) {
    console.log(`📂 Lade Session-Daten für PIN: ${sessionPin}`);

    if (demoSessions[sessionPin]) {
        console.log(`✅ Demo-Session gefunden: ${sessionPin}`);
        return demoSessions[sessionPin];
    }

    try {
        const connection = await mysql.createConnection(dbConfig);

        const [sessionsResult] = await connection.execute(
            "SELECT s.*, q.name FROM sessions s JOIN quizzes q ON s.quiz_id = q.id WHERE s.pin = ?",
            [sessionPin]
        );

        if (sessionsResult.length === 0) {
            await connection.end();
            console.log(`❌ Keine Session für PIN ${sessionPin} in DB`);
            return null;
        }

        const sessionData = sessionsResult[0];
        const questionIndex = sessionData.current_question_index || 0;

        const [questionsResult] = await connection.execute(
            "SELECT * FROM questions WHERE quiz_id = ? ORDER BY id LIMIT 1 OFFSET ?",
            [sessionData.quiz_id, questionIndex]
        );

        if (questionsResult.length === 0) {
            await connection.end();
            console.log(`❌ Keine Fragen für Session ${sessionPin}`);
            return null;
        }

        const question = questionsResult[0];
        const [optionsResult] = await connection.execute(
            "SELECT * FROM question_options WHERE question_id = ? ORDER BY id",
            [question.id]
        );

        const result = {
            ...sessionData,
            question: {
                id: question.id,
                text: question.text,
                image: question.image_path || null,
                options: optionsResult.map(row => ({
                    id: row.id,
                    text: row.text,
                    isCorrect: !!row.is_correct
                }))
            }
        };

        await connection.end();
        console.log(`✅ DB-Session geladen: ${sessionPin} (Frage ${questionIndex + 1})`);
        return result;
    } catch (error) {
        console.error('💥 DB Error:', error.message);
        return null;
    }
}

const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`✅ WebSocket-Server läuft auf Port ${PORT}`);
});

wss.on('connection', function (ws) {
    const clientId = ++clientCounter;
    ws.clientId = clientId;
    ws.sessionPin = null;
    ws.role = null;

    console.log(`\n🔗 NEUE VERBINDUNG #${clientId}`);

    ws.on('message', function (message) {
        let msg;
        try {
            msg = JSON.parse(message.toString());
            console.log(`📨 Client #${clientId}:`, msg.type, msg.sessionPin, msg.role);
        } catch (e) {
            console.error(`❌ Client #${clientId}: Ungültiges JSON`);
            return;
        }
        handleMessage(ws, msg);
    });

    ws.on('close', function () {
        console.log(`🔌 Client #${clientId} (${ws.role || 'unknown'}) disconnected`);
        handleDisconnect(ws);
    });

    ws.on('error', function(err) {
        console.error(`💥 Client #${clientId} error:`, err);
    });
});

async function handleMessage(ws, msg) {
    const type = msg.type;
    const sessionPin = msg.sessionPin;
    const data = msg.data || {};
    const role = msg.role;

    console.log(`🔄 Processing: ${type} für Client #${ws.clientId}`);

    if (type === 'join') {
        await handleJoin(ws, sessionPin, role, data);
    } else if (type === 'host_start_quiz') {
        handleHostStartQuiz(ws);
    } else if (type === 'host_start_answer_phase') {
        handleHostStartAnswerPhase(ws);
    } else if (type === 'host_end_answer_phase') {
        handleHostEndAnswerPhase(ws);
    } else if (type === 'player_answer_single') {
        handlePlayerAnswerSingle(ws, data);
    } else if (type === 'host_next_question') {
        await handleHostNextQuestion(ws);
    } else {
        console.log(`❓ Unbekannter Event-Typ: ${type}`);
    }
}

async function handleJoin(ws, sessionPin, role, data) {
    console.log(`👋 JOIN: PIN=${sessionPin}, Role=${role}`);

    const sessionData = await loadSessionData(sessionPin);
    if (!sessionData) {
        ws.send(JSON.stringify({
            type: 'error',
            data: { message: `Session ${sessionPin} nicht gefunden!` }
        }));
        return;
    }

    if (!sessions[sessionPin]) {
        sessions[sessionPin] = {
            state: sessionData.state || 'lobby',
            question: sessionData.question,
            current_question_index: sessionData.current_question_index || 0,
            players: {},
            hosts: [],
            displays: [],
            dbSessionId: sessionData.id,
            dbQuizId: sessionData.quiz_id
        };
        console.log(`💾 Session ${sessionPin} in Memory geladen`);
    }

    const session = sessions[sessionPin];
    ws.sessionPin = sessionPin;
    ws.role = role;

    if (role === 'player') {
        const nickname = data.nickname || ('Spieler-' + ws.clientId);
        session.players[ws.clientId] = {
            ws: ws,
            nickname: nickname,
            answered: false,
            answerOptionId: null,
            answerTimeMs: null,
            points: 0
        };
        broadcastLobbyUpdate(sessionPin);

        console.log(`👤 Spieler "${nickname}" joined (${Object.keys(session.players).length} total)`);
    } else if (role === 'host') {
        session.hosts.push(ws);
        console.log(`🎮 Host joined (${session.hosts.length} total)`);
    } else if (role === 'display') {
        session.displays.push(ws);
        console.log(`📺 Display joined (${session.displays.length} total)`);
    }

    ws.send(JSON.stringify({
        type: 'joined',
        data: { role: role, state: session.state, pin: sessionPin }
    }));

    broadcastStateUpdate(sessionPin);
}

function handleHostStartQuiz(ws) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;

    console.log(`🎮 Host startet Quiz: ${sessionPin}`);
    session.state = 'question_info';

    const q = session.question;
    broadcastToSession(sessionPin, {
        type: 'show_question_info',
        data: {
            questionId: q.id,
            text: q.text,
            image: q.image,
            timeShowInfo: 5
        }
    });

    broadcastStateUpdate(sessionPin);
    broadcastToHosts(sessionPin, { type: 'enable_answer_buttons', data: {} });
}

function handleHostStartAnswerPhase(ws) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;

    console.log(`⏰ Antwortphase startet: ${sessionPin}`);
    session.state = 'answer_phase';

    const q = session.question;
    Object.values(session.players).forEach(p => {
        p.answered = false;
        p.answerOptionId = null;
        p.answerTimeMs = null;
    });

    broadcastToSession(sessionPin, {
        type: 'start_answer_phase',
        data: {
            questionId: q.id,
            text: q.text,
            options: q.options,
            timeAnswer: 15
        }
    });

    broadcastStateUpdate(sessionPin);
    broadcastToHosts(sessionPin, { type: 'answer_phase_started', data: {} });
    sendAnswerCountUpdate(sessionPin);
}

function handleHostEndAnswerPhase(ws) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;

    console.log(`✅ Antwortphase beendet: ${sessionPin}`);
    session.state = 'show_solution';

    const q = session.question;
    const correctIds = q.options.filter(o => o.isCorrect).map(o => o.id);
    const maxTimeMs = 15000; // 15 Sekunden

    Object.values(session.players).forEach(p => {
        if (p.answered && correctIds.includes(p.answerOptionId)) {
            const factor = 0.4 + 0.6 * (1 - Math.max(0, p.answerTimeMs / maxTimeMs)); // 40–100%
            const points = Math.round(1000 * factor);
            p.points += points;
            const currentRanking;
            const currentRanking = getRanking(session.players);
            console.log(`🏆 ${p.nickname}: ${points} Punkte (${p.answerTimeMs}ms)`);
        }
    });

    const distribution = {};
    q.options.forEach(opt => distribution[opt.id] = 0);
    Object.values(session.players).forEach(p => {
        if (p.answerOptionId) distribution[p.answerOptionId]++;
    });

    broadcastToSession(sessionPin, {
        type: 'show_solution',
        data: {
            questionId: q.id,
            correctOptionIds: correctIds,
            distribution: distribution
        }
    });

    Object.values(session.players).forEach(p => {
        if (p.answered) {
            const isCorrect = correctIds.includes(p.answerOptionId);
            const points = isCorrect ? Math.round(1000 * (0.4 + 0.6 * (1 - Math.max(0, p.answerTimeMs / maxTimeMs)))) : 0;
            p.ws.send(JSON.stringify({
                type: 'show_solution',
                data: {
                    questionId: q.id,
                    isCorrect: isCorrect,
                    points: points,
                    totalPoints: p.points
                }
            }));
        }
    });

    broadcastToHosts(sessionPin, { type: 'answer_phase_ended', data: {} });
    broadcastStateUpdate(sessionPin);
}

async function handleHostNextQuestion(ws) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;

    console.log(`➡️ Host fordert nächste Frage für ${sessionPin}`);

    const newIndex = (session.current_question_index || 0) + 1;

    try {
        const connection = await mysql.createConnection(dbConfig);

        const [countResult] = await connection.execute(
            "SELECT COUNT(*) as total FROM questions WHERE quiz_id = ?",
            [session.dbQuizId]
        );
        const totalQuestions = countResult[0].total;

        console.log(`📊 Fragen gesamt: ${totalQuestions}, aktuelle: ${newIndex}`);

        if (newIndex >= totalQuestions) {
            console.log(`🏁 Quiz beendet! (${totalQuestions} Fragen)`);

            session.state = 'finished';

            const finalRanking = getRanking(session.players);

            const finishedMsg = {
                type: 'quiz_finished',
                data: {
                    message: `Quiz beendet! ${totalQuestions} Fragen durchgespielt.`,
                    totalQuestions: totalQuestions,
                    finalRanking: finalRanking
                }
            };

            Object.values(session.players).forEach(p => {
                if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(JSON.stringify({
                        ...finishedMsg,
                        data: {
                            ...finishedMsg.data,
                            myTotalPoints: p.points
                        }
                    }));
                }
            });

            const hostDisplayMsg = {
                ...finishedMsg,
                data: {
                    ...finishedMsg.data,
                    showFullRanking: true
                }
            };

            [...session.hosts, ...session.displays].forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(hostDisplayMsg));
                }
            });

            await connection.execute(
                "UPDATE sessions SET current_question_index = ?, state = 'finished' WHERE pin = ?",
                [newIndex, sessionPin]
            );

            await connection.end();
            broadcastStateUpdate(sessionPin);
            return;
        }

        await connection.execute(
            "UPDATE sessions SET current_question_index = ? WHERE pin = ?",
            [newIndex, sessionPin]
        );

        const [questionsResult] = await connection.execute(
            "SELECT * FROM questions WHERE quiz_id = ? ORDER BY id LIMIT 1 OFFSET ?",
            [session.dbQuizId, newIndex]
        );

        const question = questionsResult[0];
        const [optionsResult] = await connection.execute(
            "SELECT * FROM question_options WHERE question_id = ? ORDER BY id",
            [question.id]
        );

        const nextQuestion = {
            id: question.id,
            text: question.text,
            image: question.image_path || null,
            options: optionsResult.map(row => ({
                id: row.id,
                text: row.text,
                isCorrect: !!row.is_correct
            }))
        };

        session.question = nextQuestion;
        session.current_question_index = newIndex;
        session.state = 'question_info';

        await connection.end();

        console.log(`✅ Frage ${newIndex + 1}/${totalQuestions} geladen: "${question.text.substring(0, 30)}..."`);

        broadcastToSession(sessionPin, {
            type: 'show_question_info',
            data: {
                questionId: nextQuestion.id,
                text: nextQuestion.text,
                image: nextQuestion.image,
                timeShowInfo: question.time_show_info || 5
            }
        });

        broadcastStateUpdate(sessionPin);
        broadcastToHosts(sessionPin, { type: 'enable_answer_buttons', data: {} });

    } catch (error) {
        console.error('💥 Next Question Error:', error.message);
    }
}

function getRanking(players) {
    return Object.values(players)
        .filter(p => p.points > 0)
        .sort((a, b) => b.points - a.points)
        .map((p, index) => ({
            rank: index + 1,
            nickname: p.nickname,
            points: p.points
        }))
        .slice(0, 10);
}

function handlePlayerAnswerSingle(ws, data) {
    const sessionPin = ws.sessionPin;
    const session = sessions[sessionPin];
    if (!session || session.state !== 'answer_phase') return;

    const player = session.players[ws.clientId];
    if (!player || player.answered) return;

    player.answered = true;
    player.answerOptionId = data.optionId;
    player.answerTimeMs = data.answerTimeMs;

    console.log(`👆 ${player.nickname} antwortet Option ${data.optionId} (${data.answerTimeMs}ms)`);
    sendAnswerCountUpdate(sessionPin);
}

function sendAnswerCountUpdate(sessionPin) {
    const session = sessions[sessionPin];
    if (!session) return;

    const total = Object.keys(session.players).length;
    const answered = Object.values(session.players).filter(p => p.answered).length;
    broadcastToHosts(sessionPin, {
        type: 'answer_count_update',
        data: { answeredCount: answered, totalPlayers: total }
    });
    console.log(`📊 Antworten: ${answered}/${total}`);
}

function broadcastToSession(sessionPin, msg) {
    const session = sessions[sessionPin];
    if (!session) return;

    const all = [
        ...Object.values(session.players).map(p => p.ws),
        ...session.hosts,
        ...session.displays
    ];

    const payload = JSON.stringify(msg);
    let sent = 0;
    all.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
            sent++;
        }
    });
    console.log(`📢 Broadcast an ${sent}/${all.length} Clients`);
}

function broadcastToHosts(sessionPin, msg) {
    const session = sessions[sessionPin];
    if (!session) return;

    const payload = JSON.stringify(msg);
    session.hosts.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    });
}

function broadcastStateUpdate(sessionPin) {
    const session = sessions[sessionPin];
    if (!session) return;

    broadcastToHosts(sessionPin, {
        type: 'state_update',
        data: { state: session.state }
    });
}

function handleDisconnect(ws) {
    const sessionPin = ws.sessionPin;
    if (!sessionPin || !sessions[sessionPin]) return;

    const session = sessions[sessionPin];
    if (ws.role === 'player') {
        delete session.players[ws.clientId];
    } else if (ws.role === 'host') {
        session.hosts = session.hosts.filter(h => h !== ws);
    } else if (ws.role === 'display') {
        session.displays = session.displays.filter(d => d !== ws);
    }
}
function broadcastLobbyUpdate(sessionPin) {
    const session = sessions[sessionPin];
    if (!session) return;
    
    const playerCount = Object.keys(session.players).length;
    const playerList = Object.values(session.players).map(p => p.nickname);
    
    broadcastToSession(sessionPin, {
        type: 'lobby_update',
        data: { playerCount, playerList }
    });
}

