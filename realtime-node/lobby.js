const crypto = require('node:crypto');
const { loadConfig } = require('./config');
const { buildPublicQuestion } = require('./question-types');
const rankingUtils = require('./ranking');
const roundResults = require('./round-results');
const runtimeConfig = loadConfig();
const allowJoinAfterStart = Boolean(runtimeConfig?.gameplay?.allowJoinAfterStart);
const pendingSessionLoads = new Map();

function resolveHostName(session) {
    if (session.hostName) {
        return session.hostName;
    }

    if (Array.isArray(session.hosts) && session.hosts.length > 0) {
        return session.hosts[0].nickname || 'Spielleiter';
    }

    return 'Spielleiter';
}

function buildLobbyData(session, includeQuizSolutions = false) {
    const playerList = Object.values(session.players || {}).map(p => ({ id: p.id, name: p.name }));
    const blockedPlayers = Array.from(session.kickedPlayers?.values() || []);
    return {
        playerCount: playerList.length,
        playerList,
        blockedPlayers,
        blockedPlayerCount: blockedPlayers.length,
        hostName: resolveHostName(session),
        quizTitle: session.quiz_title || session.quiz_name || 'Quiz',
        quizDescription: session.quiz_description || session.description || '',
        quizImage: session.quiz_image_url || '',
        questionCount: Number(session.quiz_question_count || 0),
        automaticMode: Boolean(session.quiz_automatic_mode),
        phaseDurations: {
            start: Number(session.quiz_start_phase_seconds || 2),
            question: Number(session.quiz_question_phase_seconds || 2),
            options: Number(session.quiz_options_phase_seconds || 2),
            answer: Number(session.question?.time_limit || 10),
            solution: Number(session.quiz_solution_phase_seconds || 2)
        },
        ...(includeQuizSolutions ? { quizPreview: Array.isArray(session.quiz_preview) ? session.quiz_preview : [] } : {}),
        statusLiteral: session.statusLiteral || 'offen',
        state: session.state || 'lobby'
    };
}

function normalizeNickname(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeFingerprint(ws) {
    return String(ws?.clientFingerprint || '').trim().toLowerCase();
}

function isValidHostToken(token, expectedHash) {
    const normalizedHash = String(expectedHash || '').trim().toLowerCase();
    if (!token || !/^[a-f0-9]{64}$/.test(normalizedHash)) {
        return false;
    }

    const actualHash = crypto.createHash('sha256').update(String(token)).digest();
    const expectedBuffer = Buffer.from(normalizedHash, 'hex');
    return actualHash.length === expectedBuffer.length && crypto.timingSafeEqual(actualHash, expectedBuffer);
}

function getRemainingPhaseTime(session) {
    const persistedDeadline = Number(session.phaseDeadlineAt || session.phase_deadline_ms || 0);
    if (persistedDeadline > 0) {
        return Math.max(0, Math.ceil((persistedDeadline - Date.now()) / 1000));
    }

    const state = String(session.state || '').toLowerCase();
    const durations = {
        start: Number(session.quiz_start_phase_seconds || 2),
        question: Number(session.quiz_question_phase_seconds || 2),
        options: Number(session.quiz_options_phase_seconds || 2),
        answer: Number(session.question?.time_limit || 15),
        solution: Number(session.quiz_solution_phase_seconds || 2)
    };
    const duration = Math.max(0, Number(durations[state] || 0));
    const startedAt = state === 'answer' ? session.answerStartTime : session.phaseStartedAt;
    if (!startedAt) return duration;

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return Math.max(0, duration - elapsedSeconds);
}

function ensureKickLists(session) {
    if (!session.kickedNicknames) {
        session.kickedNicknames = new Set();
    }
    if (!session.kickedFingerprints) {
        session.kickedFingerprints = new Set();
    }
    if (!session.kickedPlayers) {
        session.kickedPlayers = new Map();
    }
    return session;
}

function findPlayerByName(session, nickname) {
    const target = String(nickname || '').trim().toLowerCase();
    if (!target) return null;

    const entry = Object.entries(session.players || {}).find(([, player]) => {
        const current = String(player?.name || '').trim().toLowerCase();
        return current !== '' && current === target;
    });

    if (!entry) return null;
    return { key: entry[0], player: entry[1] };
}

function findPlayerByToken(session, playerToken) {
    const target = String(playerToken || '').trim();
    if (!target) return null;

    const entry = Object.entries(session.players || {}).find(([, player]) => player?.playerToken === target);
    if (!entry) return null;
    return { key: entry[0], player: entry[1] };
}

function isSessionFinished(session) {
    return ['finished', 'endresult'].includes(String(session?.state || '').toLowerCase());
}

function rejectFinishedPlayerManagement(ws, session) {
    if (!isSessionFinished(session)) return false;
    if (ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'action_rejected',
            data: { reason: 'Teilnehmer koennen nach Quizende nicht mehr entfernt oder freigegeben werden.' }
        }));
    }
    return true;
}

async function handleJoinLobby(ws, msg, sessions, utils) {
    const sessionPin = String(msg.sessionPin || '').trim();
    const requestedRole = String(msg.role || '').trim().toLowerCase();
    const requestedNickname = String(msg.data?.nickname || msg.nickname || '').trim()
        || (requestedRole === 'host' ? 'Host' : `Player_${ws.clientId}`);
    const requestedPlayerToken = String(msg.data?.playerToken || '').trim();
    const requestedHostToken = String(msg.data?.hostToken || '').trim();
    const rejectJoin = (reason, extraData = {}) => {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({
                type: 'join_rejected',
                data: { reason, ...extraData }
            }));
        }
    };

    if (!/^\d{6}$/.test(sessionPin)) {
        rejectJoin('Die Session-PIN muss sechsstellig sein.');
        return;
    }

    if (!['player', 'host', 'display'].includes(requestedRole)) {
        rejectJoin('Die angeforderte Rolle ist ungueltig.');
        return;
    }

    console.log(`👥 ${requestedRole} '${requestedNickname}' joinet ${sessionPin}`);
    
    let session = sessions[sessionPin];
    if (!session) {
        let pendingLoad = pendingSessionLoads.get(sessionPin);
        if (!pendingLoad) {
            pendingLoad = utils.loadSessionData(sessionPin, sessions);
            pendingSessionLoads.set(sessionPin, pendingLoad);
        }

        try {
            session = await pendingLoad;
            if (session) {
                sessions[sessionPin] = session;
            }
        } finally {
            if (pendingSessionLoads.get(sessionPin) === pendingLoad) {
                pendingSessionLoads.delete(sessionPin);
            }
        }
    }

    if (!session || !session.pin) {
        rejectJoin('Die Session wurde nicht gefunden. Bitte pruefe die PIN.');
        return;
    }

    if (requestedRole === 'host') {
        const hostTokenHash = await utils.loadSessionHostTokenHash(sessionPin);
        if (ws.readyState !== 1) return;
        if (!isValidHostToken(requestedHostToken, hostTokenHash)) {
            rejectJoin('Die Host-Autorisierung ist ungueltig oder abgelaufen.');
            return;
        }
    }

    if (utils.hydrateSessionQuizMeta) {
        await utils.hydrateSessionQuizMeta(session);
    }
    if (ws.readyState !== 1) return;
    if (session.finishingPromise) {
        await session.finishingPromise;
        if (ws.readyState !== 1) return;
    }
    session.statusLiteral = utils.mapStateToStatusLiteral ? utils.mapStateToStatusLiteral(session.state) : (session.state || 'lobby');
    
    let isNewPlayer = false;
    if (requestedRole === 'player') {
        ensureKickLists(session);
        let finished = isSessionFinished(session);
        let tokenPlayer = findPlayerByToken(session, requestedPlayerToken);
        let existingPlayer = tokenPlayer || (!finished ? findPlayerByName(session, requestedNickname) : null);
        while (existingPlayer?.player.pendingAnswers?.size) {
            await Promise.all(Array.from(existingPlayer.player.pendingAnswers));
            if (ws.readyState !== 1) return;
            if (session.finishingPromise) {
                await session.finishingPromise;
                if (ws.readyState !== 1) return;
            }
            finished = isSessionFinished(session);
            tokenPlayer = findPlayerByToken(session, requestedPlayerToken);
            existingPlayer = tokenPlayer || (!finished ? findPlayerByName(session, requestedNickname) : null);
        }
        if (finished && !tokenPlayer) {
            rejectJoin('Diese Session ist bereits geschlossen. Nur bisherige Teilnehmer koennen ihren Endstand wiederherstellen.', {
                state: session.state
            });
            return;
        }

        const playerName = finished ? existingPlayer.player.name : requestedNickname;
        const kickedNicknames = session.kickedNicknames;
        const kickedFingerprints = session.kickedFingerprints;
        const normalizedNickname = normalizeNickname(playerName);
        const normalizedFingerprint = normalizeFingerprint(ws);
        if ((normalizedNickname && kickedNicknames.has(normalizedNickname)) || (normalizedFingerprint && kickedFingerprints.has(normalizedFingerprint))) {
            rejectJoin('Du wurdest fuer diese Session entfernt und kannst nicht erneut beitreten.', {
                state: session.state || 'lobby',
                blockedByKick: true
            });
            return;
        }

        const isActiveState = Boolean(session.state && session.state !== 'lobby');

        if (isActiveState && !allowJoinAfterStart && !existingPlayer) {
            rejectJoin('Das Quiz hat bereits begonnen. Ein spaeter Beitritt ist aktuell nicht erlaubt.', {
                state: session.state,
                allowJoinAfterStart: false
            });
            return;
        }

        ws.role = requestedRole;
        ws.sessionPin = sessionPin;
        ws.nickname = playerName;
        ws.playerToken = finished ? existingPlayer.player.playerToken : requestedPlayerToken;

        if (existingPlayer) {
            if (existingPlayer.player.ws && existingPlayer.player.ws.readyState === 1 && existingPlayer.player.ws !== ws) {
                try {
                    existingPlayer.player.ws.close(4000, 'reconnected');
                } catch (error) {
                    console.log('Previous player socket close skipped:', error.message);
                }
            }

            delete session.players[existingPlayer.key];

            session.players[ws.clientId] = {
                ...existingPlayer.player,
                id: ws.clientId,
                name: playerName,
                playerToken: finished ? existingPlayer.player.playerToken : (requestedPlayerToken || existingPlayer.player.playerToken),
                ws
            };
        } else {
            isNewPlayer = true;
            session.players[ws.clientId] = {
                id: ws.clientId,
                name: requestedNickname,
                playerToken: requestedPlayerToken,
                points: 0,
                answered: false,
                ws: ws
            };
        }

        if (!finished) {
            const joiningPlayer = session.players[ws.clientId];
            joiningPlayer.databaseId = await utils.saveSessionPlayer(sessionPin, joiningPlayer);
            if (session.players[ws.clientId] !== joiningPlayer || ws.readyState !== 1) return;
        }

        console.log(`✅ Player ${ws.clientId} ws-Referenz gesetzt`);
    } else if (requestedRole === 'host') {
        ws.role = requestedRole;
        ws.sessionPin = sessionPin;
        ws.nickname = requestedNickname;
        ws.hostAuthorized = true;
        if (!session.hosts) session.hosts = [];
        session.hosts.push(ws);
        session.hostName = requestedNickname || session.hostName || 'Spielleiter';
    } else if (requestedRole === 'display') {
        ws.role = requestedRole;
        ws.sessionPin = sessionPin;
        ws.nickname = requestedNickname;
        if (!session.displays) session.displays = [];
        session.displays.push(ws);
    }

    if (isNewPlayer) {
        utils.broadcastToSession(sessionPin, {
            type: 'player_joined',
            data: { playerName: requestedNickname || 'Spieler' }
        }, sessions, ['host', 'display']);
    }
    
    // Lobby Update
    const lobbyData = {
        type: 'lobby_update',
        data: buildLobbyData(session)
    };
    utils.broadcastToSession(sessionPin, lobbyData, sessions);
    
    // Bestätigung
    ws.send(JSON.stringify({
        type: 'lobby_joined',
        data: {
            sessionPin,
            ...buildLobbyData(session, requestedRole === 'host')
        }
    }));

    if (session.state && session.state !== 'lobby') {
        const timeLeft = getRemainingPhaseTime(session);
        const persistedResults = utils.loadSessionResults
            ? await utils.loadSessionResults(sessionPin, { throwOnError: true })
            : [];
        const finished = isSessionFinished(session);
        const rankingData = rankingUtils.getRankingData(session.players);
        const ranking = rankingData.ranking.length > 0
            ? rankingData.ranking
            : persistedResults.map(entry => ({ rank: entry.rank, name: entry.name, points: entry.points }));
        const players = Object.values(session.players || {});
        const answeredCount = players.filter(player => player.answered).length;
        const currentPlayer = requestedRole === 'player' ? session.players[ws.clientId] : null;
        const presentationView = session.presentation_view || 'solution';
        const freeTextAnswers = session.state === 'solution' && presentationView === 'free_text' && utils.loadAnonymousShortTextAnswers
            ? await utils.loadAnonymousShortTextAnswers(sessionPin, session.question?.id || null)
            : [];
        const questionStats = session.state === 'solution' && utils.loadQuestionStats
            ? await utils.loadQuestionStats(sessionPin, session.question?.id || null)
            : null;
        const liveAnswerStats = utils.buildLiveAnswerStats ? utils.buildLiveAnswerStats(session) : null;
        const liveTrackingEnabled = Boolean(session.live_tracking_enabled);
        const liveTrackingThreshold = Math.max(1, Number(session.live_tracking_threshold || 1));
        const displayLiveAnswerStats = utils.buildDisplayLiveAnswerStats(
            liveAnswerStats,
            liveTrackingEnabled,
            liveTrackingThreshold
        );
        const isSolution = session.state === 'solution';
        const isPlayer = requestedRole === 'player';
        const roundData = isSolution ? roundResults.buildRoundData(session) : null;
        const currentRoundAnswer = isSolution
            && Number(currentPlayer?.currentAnswer?.questionId) === Number(session.question?.id)
            ? currentPlayer.currentAnswer
            : null;
        const playerRoundPayload = isPlayer && isSolution && currentPlayer
            ? roundResults.buildPlayerRoundPayload(session, currentPlayer, { rankingData, roundData })
            : null;
        const playerSeesStandings = !isPlayer || finished;

        ws.send(JSON.stringify({
            type: 'session_state_sync',
            data: {
                state: session.state,
                question: session.state === 'start' || finished
                    ? null
                    : (isSolution ? session.question || null : buildPublicQuestion(session.question)),
                timeLeft,
                ...buildLobbyData(session),
                ...(playerSeesStandings ? { ranking, results: persistedResults } : {}),
                ...(!isPlayer && (isSolution || finished) && rankingData.ranking.length
                    ? { rankingTrend: roundResults.buildRankingTrend(session, rankingData).trend }
                    : {}),
                answeredCount,
                playerAnswered: Boolean(currentPlayer?.answered),
                presentationView,
                freeTextAnswers,
                questionStats,
                liveAnswerStats: requestedRole === 'host'
                    ? {
                        ...liveAnswerStats,
                        enabled: true,
                        threshold: liveTrackingThreshold,
                        correctnessVisible: true
                    }
                    : requestedRole === 'display' ? displayLiveAnswerStats : null,
                ...(currentPlayer?.answered && session.state !== 'solution' && !finished ? {
                    playerSubmission: currentPlayer.currentAnswer ? {
                        submittedAnswer: currentPlayer.currentAnswer.submittedAnswer,
                        answerTimeMs: currentPlayer.currentAnswer.answerTimeMs
                    } : null
                } : {}),
                ...(isSolution ? {
                    correctOptionIndex: session.question?.correct_option_index,
                    correctOptionIndices: session.question?.correct_option_indices,
                    acceptedAnswers: session.question?.accepted_answers,
                    playerResult: currentRoundAnswer,
                    ...(isPlayer ? {} : roundResults.buildPublicRoundPayload(session, rankingData, roundData))
                } : {}),
                ...(playerRoundPayload || {}),
                ...(isPlayer && finished ? {
                    ownPlacement: rankingData.placements.get(currentPlayer) || null
                } : {})
            }
        }));
    }
    
    console.log(`✅ ${requestedRole} in ${sessionPin} (${Object.keys(session.players).length} Spieler)`);
}

async function handleHostKickPlayer(ws, msg, sessions, utils) {
    if (ws.role !== 'host') return;

    const sessionPin = ws.sessionPin || msg.sessionPin;
    const session = sessions[sessionPin];
    if (!session || !session.players) return;
    if (rejectFinishedPlayerManagement(ws, session)) return;

    const playerId = Number(msg.playerId);
    const player = session.players[playerId];
    if (!player) return;

    ensureKickLists(session);
    const kickedNicknames = session.kickedNicknames;
    const kickedFingerprints = session.kickedFingerprints;
    const normalizedNickname = normalizeNickname(player.name);
    const normalizedFingerprint = normalizeFingerprint(player.ws);
    if (normalizedNickname) {
        kickedNicknames.add(normalizedNickname);
        session.kickedPlayers.set(normalizedNickname, {
            name: player.name || normalizedNickname,
            fingerprint: normalizedFingerprint
        });
    }
    if (normalizedFingerprint) {
        kickedFingerprints.add(normalizedFingerprint);
    }

    if (player.ws && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: 'kicked_from_session',
            data: {
                message: 'Du wurdest vom Spielleiter aus der Lobby entfernt.'
            }
        }));
        try {
            player.ws.close(4001, 'kicked by host');
        } catch (error) {
            console.log('Kick close failed:', error.message);
        }
    }

    delete session.players[playerId];
    await utils.deleteSessionPlayer(sessionPin, player);
    session.statusLiteral = utils.mapStateToStatusLiteral ? utils.mapStateToStatusLiteral(session.state) : (session.state || 'lobby');

    utils.broadcastToSession(sessionPin, {
        type: 'lobby_update',
        data: buildLobbyData(session)
    }, sessions);
}

async function handleHostUnbanPlayer(ws, msg, sessions, utils) {
    if (ws.role !== 'host') return;

    const sessionPin = ws.sessionPin || msg.sessionPin;
    const session = sessions[sessionPin];
    if (!session) return;
    if (rejectFinishedPlayerManagement(ws, session)) return;

    ensureKickLists(session);
    const normalizedNickname = normalizeNickname(msg.playerName);
    const blockedPlayer = session.kickedPlayers.get(normalizedNickname);
    if (!blockedPlayer) return;

    session.kickedNicknames.delete(normalizedNickname);
    if (blockedPlayer.fingerprint) {
        session.kickedFingerprints.delete(blockedPlayer.fingerprint);
    }
    session.kickedPlayers.delete(normalizedNickname);

    utils.broadcastToSession(sessionPin, {
        type: 'lobby_update',
        data: buildLobbyData(session)
    }, sessions);
}

module.exports = { getRemainingPhaseTime, handleJoinLobby, handleHostKickPlayer, handleHostUnbanPlayer };
