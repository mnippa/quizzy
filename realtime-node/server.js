const WebSocket = require('ws');
const { loadConfig } = require('./config');
const { initDb, getDbPool, closeDbPool } = require('./db');

const config = loadConfig();
const host = process.env.HOST || config.server.host || '127.0.0.1';
const preferredPort = Number(process.env.PORT || config.server.port || 8081);
const dbConfig = {
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: config.db.charset,
    connectionLimit: config.db.connectionLimit
};

// Module laden
const lobby = require('./lobby');
const quiz = require('./quiz');
const ranking = require('./ranking');
const utils = require('./utils')(dbConfig);

const sessions = {};
const hostEventTypes = new Set([
    'host_kick_player',
    'host_unban_player',
    'host_start_quiz',
    'host_show_first_question',
    'host_show_answer_options',
    'host_start_answer_phase',
    'host_end_answer_phase',
    'host_next_question',
    'host_end_quiz',
    'host_select_presentation_view',
    'host_configure_live_tracking',
    'review_short_text_answer'
]);
let clientCounter = 0;
let wss;
let sessionMonitorInterval = null;

async function watchPersistedSessionState() {
    const finalStates = new Set(['endresult', 'finished']);
    const activePins = Object.keys(sessions).filter(pin => sessions[pin] && !finalStates.has(String(sessions[pin].state || '').toLowerCase()));
    if (activePins.length === 0) {
        return;
    }

    let connection;
    try {
        connection = await getDbPool(dbConfig).getConnection();
        const placeholders = activePins.map(() => '?').join(', ');
        const [rows] = await connection.execute(
            `SELECT pin, state FROM sessions WHERE pin IN (${placeholders})`,
            activePins
        );
        connection.release();
        connection = null;
        const persistedStates = new Map(rows.map(row => [String(row.pin), String(row.state || '')]));
        for (const sessionPin of activePins) {
            const persistedState = persistedStates.get(String(sessionPin));
            if (!finalStates.has(String(persistedState || '').toLowerCase())) {
                continue;
            }

            const session = sessions[sessionPin];
            if (!session || session.transitioning || finalStates.has(String(session.state || '').toLowerCase())) {
                continue;
            }

            session.transitioning = true;
            try {
                await quiz.runSessionFinishing(session, async () => {
                    await quiz.waitForPendingAnswers(session);
                    await utils.flushSessionPlayerWrites(sessionPin);
                    const results = utils.loadSessionResults
                        ? await utils.loadSessionResults(sessionPin, { throwOnError: true })
                        : [];
                    session.state = persistedState;
                    session.statusLiteral = utils.mapStateToStatusLiteral ? utils.mapStateToStatusLiteral(session.state) : 'geschlossen';
                    const rankingPayload = results.map(entry => ({
                        rank: entry.rank,
                        name: entry.name,
                        points: entry.points
                    }));

                    quiz.broadcastQuizFinished(sessionPin, session, {
                        ranking: rankingPayload,
                        results,
                        message: 'Das aktuelle Quiz ist beendet.'
                    }, sessions, utils, ranking);
                });
            } finally {
                session.transitioning = false;
            }
        }
    } catch (error) {
        console.error('⚠️ Session monitor failed:', error.message);
    } finally {
        connection?.release();
    }
}

async function startServer(options = {}) {
    try {
        await initDb(dbConfig);
        console.log('✅ Datenbank initialisiert');
    } catch (error) {
        console.error('⚠️ Datenbank-Initialisierung fehlgeschlagen:', error.message);
    }

    if (wss) {
        return wss;
    }

    const serverHost = options.host || host;
    const serverPort = options.port === undefined ? preferredPort : Number(options.port);
    const allowPortFallback = options.allowPortFallback === undefined
        ? options.port === undefined
        : Boolean(options.allowPortFallback);
    const candidatePorts = allowPortFallback
        ? Array.from(new Set([serverPort, serverPort + 1, serverPort + 2, serverPort + 3, serverPort + 4, serverPort + 5]))
        : [serverPort];

    const startWithPort = async () => {
        for (const port of candidatePorts) {
            try {
                const candidateServer = new WebSocket.Server({ host: serverHost, port });
                await new Promise((resolve, reject) => {
                    const handleListening = () => {
                        candidateServer.off('error', handleStartupError);
                        resolve();
                    };
                    const handleStartupError = (error) => {
                        candidateServer.off('listening', handleListening);
                        reject(error);
                    };
                    candidateServer.once('listening', handleListening);
                    candidateServer.once('error', handleStartupError);
                });
                wss = candidateServer;
                const address = wss.address();
                const activePort = typeof address === 'object' && address ? address.port : port;
                console.log(`✅ WebSocket-Server läuft auf ${serverHost}:${activePort}`);
                return activePort;
            } catch (error) {
                if (error && error.code === 'EADDRINUSE') {
                    console.log(`⚠️ Port ${port} belegt, versuche nächsten...`);
                    continue;
                }
                throw error;
            }
        }
        throw new Error('Kein freier WebSocket-Port verfügbar');
    };

    try {
        await startWithPort();
    } catch (error) {
        console.error('⚠️ WebSocket-Server Fehler:', error.message);
        throw error;
    }

    wss.on('error', (error) => {
        console.error('⚠️ WebSocket-Server Fehler:', error.message);
    });

    wss.on('connection', function(ws, req) {
    const clientId = ++clientCounter;
    ws.clientId = clientId;
    const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const remoteAddress = forwardedFor || req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
    const userAgent = String(req?.headers?.['user-agent'] || '').trim();
    ws.clientIp = remoteAddress;
    ws.userAgent = userAgent;
    ws.clientFingerprint = `${remoteAddress}|${userAgent}`.toLowerCase();
    console.log(`🔗 Client ${clientId} verbunden`);
    
    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
            
            if (msg.data && msg.data.nickname) {
                msg.nickname = msg.data.nickname;
            }
            
            const clientType = msg.type || 'unknown';
            const clientRole = msg.role || 'unknown';
            console.log(`📨 ${clientType} von Client ${clientId} (${clientRole})`);

            if (hostEventTypes.has(msg.type)) {
                const requestedPin = String(msg.sessionPin || '').trim();
                const authorized = ws.role === 'host'
                    && ws.hostAuthorized === true
                    && requestedPin !== ''
                    && requestedPin === String(ws.sessionPin || '');
                if (!authorized) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'action_rejected',
                            data: { reason: 'Die Host-Autorisierung fuer diese Aktion fehlt.' }
                        }));
                    }
                    console.warn(`Host-Aktion abgelehnt: Client ${clientId}, Typ ${msg.type}`);
                    return;
                }
            }
            
            if (msg.type === 'join' || msg.type === 'join_lobby') {
                await lobby.handleJoinLobby(ws, msg, sessions, utils);
                if (ws.sessionPin && sessions[ws.sessionPin]) {
                    quiz.restoreAutomaticTransition(ws.sessionPin, sessions[ws.sessionPin], utils, ranking);
                    if (ws.role === 'host' && sessions[ws.sessionPin].state !== 'lobby') {
                        await quiz.sendReviewQueue(ws.sessionPin, sessions, utils);
                    }
                }
            } else if (msg.type === 'host_kick_player') {
                await lobby.handleHostKickPlayer(ws, msg, sessions, utils);
            } else if (msg.type === 'host_unban_player') {
                await lobby.handleHostUnbanPlayer(ws, msg, sessions, utils);
            } else if (msg.type === 'host_start_quiz') {
                await quiz.handleHostStartQuiz(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_show_first_question') {
                await quiz.handleHostShowFirstQuestion(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_show_answer_options') {
                await quiz.handleHostShowAnswerOptions(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_start_answer_phase') {
                await quiz.handleHostStartAnswerPhase(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'player_answer_single' || msg.type === 'player_submit_answer' || msg.type === 'player_answer_multi' || msg.type === 'player_answer_text') {
                await quiz.handlePlayerAnswerSingle(ws, msg, sessions, utils);
            } else if (msg.type === 'host_end_answer_phase') {
                await quiz.handleHostEndAnswerPhase(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_next_question') {
                await quiz.handleHostNextQuestion(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_end_quiz') {
                await quiz.handleHostEndQuiz(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_select_presentation_view') {
                await quiz.handleHostSelectPresentationView(ws, msg, sessions, utils);
            } else if (msg.type === 'host_configure_live_tracking') {
                await quiz.handleHostConfigureLiveTracking(ws, msg, sessions, utils);
            } else if (msg.type === 'review_short_text_answer') {
                await quiz.handleReviewShortTextAnswer(ws, msg, sessions, utils);
            } else {
                console.log(`❓ Unbekannter Typ: ${msg.type}`);
            }
        } catch (e) {
            console.error('❌ WebSocket-Nachricht fehlgeschlagen:', e);
            if (ws.readyState === WebSocket.OPEN) {
                const isJoin = msg?.type === 'join' || msg?.type === 'join_lobby';
                ws.send(JSON.stringify({
                    type: isJoin ? 'join_rejected' : 'action_rejected',
                    data: {
                        reason: isJoin
                            ? 'Der gespeicherte Spielstand konnte nicht geladen werden. Bitte erneut versuchen.'
                            : 'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.'
                    }
                }));
                if (isJoin) ws.close(1011, 'Session state unavailable');
            }
        }
    });
    
        ws.on('close', async () => {
            try {
                await utils.handleClientDisconnect(ws, sessions);
            } catch (error) {
                console.error('Teilnehmer konnte nicht aus der Lobby entfernt werden:', error.message);
                if (ws.sessionPin && sessions[ws.sessionPin]) {
                    utils.broadcastToSession(ws.sessionPin, {
                        type: 'action_rejected',
                        data: { reason: 'Ein Teilnehmer konnte nicht dauerhaft aus der Lobby entfernt werden. Bitte erneut versuchen.' }
                    }, sessions, ['host']);
                }
            }
            console.log(`🔌 Client ${clientId} getrennt`);
        });
    });

    if (!sessionMonitorInterval) {
        sessionMonitorInterval = setInterval(() => {
            watchPersistedSessionState();
        }, 2000);
    }

    return wss;
}

async function stopServer() {
    if (sessionMonitorInterval) {
        clearInterval(sessionMonitorInterval);
        sessionMonitorInterval = null;
    }

    if (wss) {
        const activeServer = wss;
        wss = null;
        activeServer.clients.forEach(client => client.terminate());

        await new Promise((resolve, reject) => {
            activeServer.close(error => error ? reject(error) : resolve());
        });

        Object.keys(sessions).forEach(sessionPin => {
            delete sessions[sessionPin];
        });
    }

    try {
        await utils.flushSessionPlayerWrites();
    } finally {
        await closeDbPool();
    }
}

if (require.main === module) {
    startServer().catch(() => {
        process.exitCode = 1;
    });
}

module.exports = { startServer, stopServer, sessions };
