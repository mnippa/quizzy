// server.js KOMPLETT ersetzen:
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const PORT = 8080;
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'start123',
    database: 'quizgame'
};

// Module laden
const lobby = require('./lobby');
const quiz = require('./quiz');
const ranking = require('./ranking');
const utils = require('./utils')(dbConfig);

const sessions = {};
let clientCounter = 0;

const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`✅ WebSocket-Server läuft auf Port ${PORT}`);
});

wss.on('connection', function(ws) {
    const clientId = ++clientCounter;
    ws.clientId = clientId;
    console.log(`🔗 Client ${clientId} verbunden`);
    
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log(`📨 RAW:`, JSON.stringify(msg));
            
            // *** NICKNAME aus data extrahieren ***
            if (msg.data && msg.data.nickname) {
                msg.nickname = msg.data.nickname;
            }
            
            const clientType = msg.type || 'unknown';
            const clientRole = msg.role || 'unknown';
            console.log(`📨 ${clientType} von Client ${clientId} (${clientRole})`);
            
            // Role/Nickname/Session setzen
            if (msg.role) ws.role = msg.role;
            if (msg.sessionPin) ws.sessionPin = msg.sessionPin;
            if (msg.nickname) ws.nickname = msg.nickname;
            if (!ws.nickname) ws.nickname = ws.role === 'host' ? 'Host' : `Player_${clientId}`;
            
            console.log(`👤 Client ${clientId} → role: ${ws.role}, pin: ${ws.sessionPin}, name: ${ws.nickname}`);
            
            // *** JOIN ALIAS für alte Frontend ***
            if (msg.type === 'join' || msg.type === 'join_lobby') {
                await lobby.handleJoinLobby(ws, msg, sessions, utils);
            } else if (msg.type === 'host_start_quiz') {
                await quiz.handleHostStartQuiz(ws, msg, sessions, utils);
            } else if (msg.type === 'player_answer_single') {
                await quiz.handlePlayerAnswerSingle(ws, msg, sessions, utils);
            } else if (msg.type === 'host_end_answer_phase') {
                await quiz.handleHostEndAnswerPhase(ws, msg, sessions, utils, ranking);
            } else if (msg.type === 'host_next_question') {
                await quiz.handleHostNextQuestion(ws, msg, sessions, utils);
            } else if (msg.type === 'host_end_quiz') {
                await quiz.handleHostEndQuiz(ws, msg, sessions, utils, ranking);
            } else {
                console.log(`❓ Unbekannter Typ: ${msg.type}`);
            }
        } catch (e) {
            console.error('❌ Parse Error:', e);
        }
    });
    
    ws.on('close', () => {
        utils.handleClientDisconnect(ws, sessions);
        console.log(`🔌 Client ${clientId} getrennt`);
    });
});
