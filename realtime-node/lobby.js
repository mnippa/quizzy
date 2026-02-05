async function handleJoinLobby(ws, msg, sessions, utils) {
    const { sessionPin } = msg;
    console.log(`👥 ${ws.role} '${ws.nickname}' joinet ${sessionPin}`);
    
    // Session laden/erstellen
    let session = sessions[sessionPin];
    if (!session) {
        session = await utils.createDemoSession(sessionPin);
        sessions[sessionPin] = session;
    }
    
    // *** KRITISCH: session.players mit ws-Referenz ***
    if (ws.role === 'player') {
        session.players[ws.clientId] = { 
            id: ws.clientId, 
            name: ws.nickname, 
            points: 0, 
            answered: false,
            ws: ws  // ← WebSocket-Referenz HIER!
        };
        console.log(`✅ Player ${ws.clientId} ws-Referenz gesetzt`);
    } else if (ws.role === 'host') {
        if (!session.hosts) session.hosts = [];
        session.hosts.push(ws);
    }
    
    // Lobby Update
    const lobbyData = {
        type: 'lobby_update',
        data: {
            playerCount: Object.keys(session.players).length,
            playerList: Object.values(session.players).map(p => ({ id: p.id, name: p.name })),
            state: session.state || 'lobby'
        }
    };
    utils.broadcastToSession(sessionPin, lobbyData, sessions);
    
    // Bestätigung
    ws.send(JSON.stringify({
        type: 'lobby_joined',
        data: { 
            sessionPin, 
            playerCount: Object.keys(session.players).length,
            state: session.state || 'lobby'
        }
    }));
    
    console.log(`✅ ${ws.role} in ${sessionPin} (${Object.keys(session.players).length} Spieler)`);
}

module.exports = { handleJoinLobby };
