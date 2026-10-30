const mysql = require('mysql2/promise');
const WebSocket = require('ws');

function utilsFactory(dbConfig) {
    async function getConnection() {
        return mysql.createConnection(dbConfig);
    }

    async function getColumnNames(connection, tableName) {
        const [rows] = await connection.execute(`SHOW COLUMNS FROM ${tableName}`);
        return new Set(rows.map((row) => row.Field));
    }

    function normalizeOptionText(option) {
        if (typeof option.text === 'string') return option.text;
        if (typeof option.option_text === 'string') return option.option_text;
        if (typeof option.label === 'string') return option.label;
        return String(option.id ?? '');
    }

    function normalizeCorrectIndex(question, options) {
        if (Number.isInteger(question.correct_option_index)) {
            return question.correct_option_index;
        }

        const byFlag = options.findIndex((opt) => opt.is_correct === 1 || opt.is_correct === true);
        return byFlag >= 0 ? byFlag : 0;
    }

    async function loadQuizQuestions(connection, quizId) {
        const questionColumns = await getColumnNames(connection, 'questions');
        const optionColumns = await getColumnNames(connection, 'question_options');

        const questionOrder = questionColumns.has('position') ? '`position`, id' : 'id';
        const optionOrder = optionColumns.has('option_index')
            ? 'option_index, id'
            : optionColumns.has('position')
                ? '`position`, id'
                : 'id';

        const [questionRows] = await connection.execute(
            `SELECT * FROM questions WHERE quiz_id = ? ORDER BY ${questionOrder}`,
            [quizId]
        );

        const questions = [];
        for (const questionRow of questionRows) {
            const [optionRows] = await connection.execute(
                `SELECT * FROM question_options WHERE question_id = ? ORDER BY ${optionOrder}`,
                [questionRow.id]
            );

            const options = optionRows.map((opt) => normalizeOptionText(opt));
            const correct_option_index = normalizeCorrectIndex(questionRow, optionRows);

            questions.push({
                id: questionRow.id,
                text: questionRow.text,
                options,
                correct_option_index
            });
        }

        return questions;
    }

    async function loadSessionData(sessionPin) {
        try {
            const connection = await getConnection();
            const [rows] = await connection.execute('SELECT * FROM sessions WHERE pin = ? LIMIT 1', [sessionPin]);

            if (rows.length === 0) {
                await connection.end();
                return null;
            }

            const sessionRow = rows[0];
            const currentIndex = Number(sessionRow.current_question_index || 0);
            const quizId = sessionRow.quiz_id ?? null;

            let questions = [];
            if (quizId !== null) {
                questions = await loadQuizQuestions(connection, quizId);
            }

            await connection.end();

            const session = {
                pin: sessionPin,
                state: sessionRow.state || 'lobby',
                quiz_id: quizId,
                current_question_index: currentIndex,
                players: {},
                hosts: [],
                displays: [],
                questions,
                question: null,
                answerStartTime: null
            };

            if (questions.length > currentIndex) {
                session.question = questions[currentIndex];
            }

            return session;
        } catch (e) {
            console.log('DB unavailable, using demo');
            return null;
        }
    }

    async function createDemoSession(sessionPin) {
        const questions = [
            {
                id: 1,
                text: 'Welche Farbe hat der Himmel?',
                options: ['Blau', 'Grun', 'Rot', 'Gelb'],
                correct_option_index: 0
            },
            {
                id: 2,
                text: 'Katze oder Hund?',
                options: ['Katze', 'Hund', 'Maus', 'Fisch'],
                correct_option_index: 1
            }
        ];

        return {
            pin: sessionPin,
            state: 'lobby',
            quiz_id: null,
            players: {},
            hosts: [],
            displays: [],
            current_question_index: 0,
            questions,
            question: questions[0],
            answerStartTime: null
        };
    }

    async function loadNextQuestion(sessionPin, session) {
        if (!Array.isArray(session.questions) || session.questions.length === 0) {
            if (session.quiz_id != null) {
                try {
                    const connection = await getConnection();
                    session.questions = await loadQuizQuestions(connection, session.quiz_id);
                    await connection.end();
                } catch (e) {
                    session.questions = [];
                }
            }
        }

        const index = Number(session.current_question_index || 0);
        if (Array.isArray(session.questions) && index < session.questions.length) {
            session.question = session.questions[index];
            session.answerStartTime = Date.now();
            return true;
        }

        session.question = null;
        session.state = 'finished';
        return false;
    }

    function broadcastToSession(sessionPin, message, sessions) {
        const session = sessions[sessionPin];
        if (!session) {
            console.log(`Session ${sessionPin} nicht gefunden`);
            return;
        }

        const clients = [];

        if (session.hosts && session.hosts.length > 0) {
            session.hosts.forEach((host) => {
                if (host.readyState === WebSocket.OPEN) {
                    clients.push(host);
                }
            });
        }

        Object.values(session.players).forEach((player) => {
            if (player.ws && player.ws.readyState === WebSocket.OPEN) {
                clients.push(player.ws);
            }
        });

        if (session.displays && session.displays.length > 0) {
            session.displays.forEach((display) => {
                if (display.readyState === WebSocket.OPEN) {
                    clients.push(display);
                }
            });
        }

        const payload = JSON.stringify(message);
        clients.forEach((client) => {
            try {
                client.send(payload);
            } catch (e) {
                console.log(`Client ${client.clientId} Fehler:`, e.message);
            }
        });
    }

    function handleClientDisconnect(ws, sessions) {
        const sessionPin = ws.sessionPin;
        if (!sessionPin || !sessions[sessionPin]) return;

        const session = sessions[sessionPin];
        if (ws.role === 'player') {
            delete session.players[ws.clientId];
        } else if (ws.role === 'host') {
            session.hosts = session.hosts.filter((h) => h !== ws);
        } else if (ws.role === 'display') {
            session.displays = session.displays.filter((d) => d !== ws);
        }

        const lobbyData = {
            type: 'lobby_update',
            data: {
                playerCount: Object.keys(session.players).length,
                playerList: Object.values(session.players).map((p) => ({ id: p.id, name: p.name })),
                state: session.state || 'lobby'
            }
        };
        broadcastToSession(sessionPin, lobbyData, sessions);
    }

    return {
        loadSessionData,
        createDemoSession,
        loadNextQuestion,
        broadcastToSession,
        handleClientDisconnect
    };
}

module.exports = utilsFactory;
