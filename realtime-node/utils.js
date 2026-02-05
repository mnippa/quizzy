const mysql = require('mysql2/promise');
const WebSocket = require('ws');

function utilsFactory(dbConfig) {
    
    async function loadSessionData(sessionPin, sessions) {
        try {
            const connection = await mysql.createConnection(dbConfig);
            const [rows] = await connection.execute(
                'SELECT * FROM sessions WHERE pin = ?', [sessionPin]
            );
            await connection.end();
            
            if (rows.length > 0) {
                return { ...rows[0], players: {}, hosts: [], displays: [] };
            }
        } catch (e) {
            console.log('DB unavailable, using demo');
        }
        return null;
    }
    
    async function createDemoSession(sessionPin) {
        return {
            pin: sessionPin,
            state: 'lobby',
            players: {},
            hosts: [],
            displays: [],
            current_question_index: 0
        };
    }
    
    async function loadNextQuestion(sessionPin, session) {
        const demoQuestions = [
            {
                id: 1,
                text: 'Welche Farbe hat der Himmel?',
                options: ['Blau', 'Grün', 'Rot', 'Gelb'],
                correct_option_index: 0
            },
            {
                id: 2,
                text: 'Katze oder Hund?',
                options: ['Katze', 'Hund', 'Maus', 'Fisch'],
                correct_option_index: 1
            }
        ];
        
        if (session.current_question_index < demoQuestions.length) {
            session.question = demoQuestions[session.current_question_index];
            session.answerStartTime = Date.now();
        } else {
            session.state = 'finished';
        }
    }
    
    // *** KRITISCHER BROADCAST-FIX ***
    function broadcastToSession(sessionPin, message, sessions) {
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
            try {
                client.send(JSON.stringify(message));
                console.log(`  → Client ${client.clientId} (${client.role || 'unknown'}) OK`);
            } catch (e) {
                console.log(`  ❌ Client ${client.clientId} Fehler:`, e.message);
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
            session.hosts = session.hosts.filter(h => h !== ws);
        } else if (ws.role === 'display') {
            session.displays = session.displays.filter(d => d !== ws);
        }
        
        // Lobby Update nach Disconnect
        const lobbyData = {
            type: 'lobby_update',
            data: {
                playerCount: Object.keys(session.players).length,
                playerList: Object.values(session.players).map(p => ({ id: p.id, name: p.name }))
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
