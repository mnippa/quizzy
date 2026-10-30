async function handleJoinLobby(ws, msg, sessions, utils) {
    const { sessionPin } = msg;
    console.log(`Join: ${ws.role} '${ws.nickname}' -> ${sessionPin}`);

    let session = sessions[sessionPin];
    if (!session) {
        session = await utils.loadSessionData(sessionPin);
        if (!session) {
            ws.send(JSON.stringify({
                type: 'error',
                data: {
                    code: 'SESSION_NOT_FOUND',
                    message: `Session mit PIN ${sessionPin} nicht gefunden`
                }
            }));
            return;
        }
        sessions[sessionPin] = session;
    }

    if (ws.role === 'player') {
        session.players[ws.clientId] = {
            id: ws.clientId,
            name: ws.nickname,
            points: 0,
            answered: false,
            ws
        };
    } else if (ws.role === 'host') {
        if (!session.hosts) session.hosts = [];
        session.hosts.push(ws);
    } else if (ws.role === 'display') {
        if (!session.displays) session.displays = [];
        session.displays.push(ws);
    }

    const lobbyData = {
        type: 'lobby_update',
        data: {
            playerCount: Object.keys(session.players).length,
            playerList: Object.values(session.players).map((p) => ({ id: p.id, name: p.name })),
            state: session.state || 'lobby'
        }
    };
    utils.broadcastToSession(sessionPin, lobbyData, sessions);

    ws.send(JSON.stringify({
        type: 'lobby_joined',
        data: {
            sessionPin,
            playerCount: Object.keys(session.players).length,
            state: session.state || 'lobby'
        }
    }));
}

module.exports = { handleJoinLobby };
