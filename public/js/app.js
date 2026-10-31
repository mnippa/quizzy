// *** GLOBALE FUNKTIONEN ZUR VERFÜGUNG STELLEN ***
let socket = null;
let role = null;
let sessionPin = null;
let nickname = null;
let playerToken = null;
let hostToken = null;
let answered = false;
let timerInterval = null;
let currentQuestion = null;
let selectedMultiChoice = new Set();
let reconnectAttempts = 0;
let reconnectTimer = null;
let currentRawState = 'lobby';
let shouldAutoReconnect = true;
let automaticPhaseTimers = false;
let submittedAnswer = null;
let currentResultRanking = [];
let currentLobbyPlayers = [];
let displayPageTimer = null;
let currentPresentationView = 'solution';
let currentRankingTrend = [];
let lastDisplayCelebration = '';

const MAX_JOIN_ACTIVITY = 5;
const DISPLAY_PAGE_INTERVAL_MS = 10000;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderOptionContent(question, index) {
    const fallbackText = String(question?.options?.[index] || '');
    const media = Array.isArray(question?.optionMedia) ? question.optionMedia[index] || {} : {};
    const text = String(media.text || fallbackText).trim();
    const imageUrl = String(media.imageUrl || '').trim();
    const altText = String(media.altText || text || `Antwort ${index + 1}`).trim();
    const image = imageUrl
        ? `<img class="answer-option-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}">`
        : '';
    const label = text ? `<span class="answer-option-text">${escapeHtml(text)}</span>` : '';
    return `<span class="answer-option-content">${image}${label}</span>`;
}

function getOptionLabel(question, index) {
    const fallbackText = String(question?.options?.[index] || '').trim();
    const media = Array.isArray(question?.optionMedia) ? question.optionMedia[index] || {} : {};
    return String(media.text || fallbackText || media.altText || `Antwort ${index + 1}`).trim();
}

function getQuestionType(question) {
    return question?.type || question?.question_type || 'single_choice';
}

function phaseTimersEnabled() {
    return window.PHASE_TIMERS_ENABLED === true || automaticPhaseTimers;
}

function updatePhaseTimerMode(data) {
    automaticPhaseTimers = Boolean(data?.automaticMode);
    const playerTimerPanel = document.getElementById('playerTimerPanel');
    if (playerTimerPanel) {
        playerTimerPanel.classList.toggle('hidden', !phaseTimersEnabled());
    }
}

function getQuestionTypeLabel(question) {
    const type = getQuestionType(question);
    if (type === 'single_choice') return 'Single Choice';
    if (type === 'multiple_choice') return 'Multiple Choice';
    if (type === 'true_false') return 'Wahr/Falsch';
    if (type === 'short_text') return 'Freitext';
    return type;
}

function updateQuestionImages(question) {
    const imageUrl = String(question?.image_url || question?.imageUrl || '').trim();
    ['player-question-image', 'host-question-image', 'display-question-image', 'display-answer-question-image'].forEach(id => {
        const image = document.getElementById(id);
        if (!image) return;

        image.classList.toggle('hidden', imageUrl === '');
        if (imageUrl) {
            image.src = imageUrl;
            image.alt = `Bild zur Frage: ${question?.text || ''}`;
        } else {
            image.removeAttribute('src');
            image.alt = '';
        }
    });
}

function renderRanking(entries) {
    const normalizedEntries = Array.isArray(entries)
        ? entries
        : (entries && typeof entries === 'object' ? Object.values(entries) : []);

    if (!Array.isArray(normalizedEntries) || normalizedEntries.length === 0) {
        return '<p class="small">Noch keine Daten.</p>';
    }

    return normalizedEntries.map(item => {
        const rank = typeof item.rank === 'number' ? item.rank : '-';
        const name = escapeHtml(item.name || item.nickname || 'Spieler');
        const points = Number(item.points || item.score || 0);
        return `<div class="ranking-row"><span>#${rank} ${name}</span><strong>${points} P</strong></div>`;
    }).join('');
}

function showHostRanking(ranking) {
    const rankingBox = document.getElementById('host-ranking');
    const rankingList = document.getElementById('ranking-list');
    if (!rankingBox || !rankingList) return;

    rankingList.innerHTML = renderRanking(ranking);
    rankingBox.classList.remove('hidden');
}

function showHostResults(results) {
    const resultsBox = document.getElementById('host-results');
    const resultsList = document.getElementById('results-list');
    if (!resultsBox || !resultsList) return;

    const normalizedResults = Array.isArray(results)
        ? results
        : (results && typeof results === 'object' ? Object.values(results) : []);

    if (!normalizedResults.length) {
        resultsList.innerHTML = '<p class="small">Noch keine Detaildaten.</p>';
        resultsBox.classList.remove('hidden');
        return;
    }

    resultsList.innerHTML = normalizedResults.map(item => {
        const name = escapeHtml(item.name || item.nickname || 'Spieler');
        const points = Number(item.points || item.score || 0);
        const correct = Number(item.correct_answers || item.correctAnswers || 0);
        const answered = Number(item.answered_questions || item.answeredQuestions || 0);
        return `<div class="ranking-row"><span>${name}</span><strong>${points} P · ${correct}✓ · ${answered}✉</strong></div>`;
    }).join('');
    resultsBox.classList.remove('hidden');
}

function showReviewQueue(reviews) {
    const reviewPanel = document.getElementById('review-panel');
    const reviewList = document.getElementById('review-list');
    if (!reviewPanel || !reviewList) return;
    document.getElementById('review-error')?.classList.add('hidden');

    const normalizedReviews = Array.isArray(reviews) ? reviews : [];
    if (!normalizedReviews.length) {
        reviewList.innerHTML = '<p class="small">Keine offenen Freitext-Antworten.</p>';
        reviewPanel.classList.remove('hidden');
        return;
    }

    const previousInputs = new Map(Array.from(reviewList.querySelectorAll('input[id]'), input => [input.id, input.value]));
    const focusedInput = reviewList.contains(document.activeElement) ? document.activeElement : null;
    const focusedId = focusedInput?.id;
    const selectionStart = focusedInput?.type === 'text' ? focusedInput.selectionStart : null;
    const selectionEnd = focusedInput?.type === 'text' ? focusedInput.selectionEnd : null;
    const scrollTop = reviewList.scrollTop;

    reviewList.innerHTML = normalizedReviews.map(review => `
        <div class="ranking-row" style="display:block;">
            <div><strong>${escapeHtml(review.nickname || 'Spieler')}</strong></div>
            <div class="small">${escapeHtml(review.answer_text || '')}</div>
            <div style="display:grid;grid-template-columns:minmax(100px, 160px) 1fr;gap:8px;margin-top:8px;">
                <label class="small">Punkte
                    <input id="review-points-${review.id}" type="number" min="0" max="${Number(review.points_max || 0)}" value="${escapeHtml(previousInputs.get(`review-points-${review.id}`) ?? Number(review.points_max || 0))}">
                </label>
                <label class="small">Kommentar
                    <input id="review-comment-${review.id}" type="text" maxlength="2000" value="${escapeHtml(previousInputs.get(`review-comment-${review.id}`) || '')}">
                </label>
            </div>
            <div style="margin-top:6px;">
                <button onclick="reviewShortTextAnswer(${review.id}, ${Number(review.points_max || 0)})" class="primary">Volle Punkte</button>
                <button onclick="reviewShortTextAnswer(${review.id}, 0)" class="secondary">0 Punkte</button>
                <button onclick="reviewShortTextAnswer(${review.id})" class="secondary">Teilpunkte speichern</button>
            </div>
        </div>
    `).join('');
    reviewList.scrollTop = scrollTop;
    const replacement = focusedId ? document.getElementById(focusedId) : null;
    if (replacement && reviewList.contains(replacement)) {
        replacement.focus({ preventScroll: true });
        if (replacement.type === 'text' && selectionStart !== null && selectionEnd !== null) {
            replacement.setSelectionRange(selectionStart, selectionEnd);
        }
    }
    reviewPanel.classList.remove('hidden');
}

function updateLobbyHostName(hostName) {
    const resolvedName = hostName ? String(hostName) : '-';
    const playerHostElement = document.getElementById('lobbyHostName');
    if (playerHostElement) {
        playerHostElement.textContent = resolvedName;
    }

    const questionHostElement = document.getElementById('questionHostName');
    if (questionHostElement) {
        questionHostElement.textContent = resolvedName;
    }

    const hostHostElement = document.getElementById('host-lobby-hostname');
    if (hostHostElement) {
        hostHostElement.textContent = resolvedName;
    }
}

function updateLobbyQuizTitle(quizTitle) {
    const resolvedTitle = quizTitle ? String(quizTitle) : '-';

    const playerQuizElement = document.getElementById('lobbyQuizTitle');
    if (playerQuizElement) {
        playerQuizElement.textContent = resolvedTitle;
    }

    const questionQuizElement = document.getElementById('questionQuizTitle');
    if (questionQuizElement) {
        questionQuizElement.textContent = resolvedTitle;
    }

    const hostQuizElement = document.getElementById('host-quiz-title');
    if (hostQuizElement) {
        hostQuizElement.textContent = resolvedTitle;
    }
}

function updateLobbyPlayers(playerList) {
    currentLobbyPlayers = Array.isArray(playerList) ? playerList : [];
    renderParticipantLists();
}

function renderParticipantLists() {
    const playerListElement = document.getElementById('playerList');
    if (playerListElement) {
        const query = document.getElementById('player-search')?.value || '';
        const visiblePlayers = window.QuizGroupView.filterParticipants(currentLobbyPlayers, query);
        const count = document.getElementById('player-search-count');
        if (count) count.textContent = query.trim() ? `${visiblePlayers.length} von ${currentLobbyPlayers.length} Spielern` : '';
        playerListElement.innerHTML = visiblePlayers.length
            ? visiblePlayers.map(({ player, index }) => `<tr><td class="participant-index">${index + 1}</td><td>${escapeHtml(player.name || 'Spieler')}</td></tr>`).join('')
            : `<tr><td colspan="2" class="participant-empty">${currentLobbyPlayers.length ? 'Keine passenden Spieler gefunden.' : 'Noch keine Spieler beigetreten.'}</td></tr>`;
    }

    const hostPlayerCount = document.getElementById('host-player-count');
    if (hostPlayerCount) {
        hostPlayerCount.textContent = String(currentLobbyPlayers.length);
    }

    const hostPlayerList = document.getElementById('host-player-list');
    if (hostPlayerList) {
        const query = document.getElementById('host-player-search')?.value || '';
        const visiblePlayers = window.QuizGroupView.filterParticipants(currentLobbyPlayers, query);
        const disabled = ['finished', 'endresult'].includes(currentRawState) ? ' disabled' : '';
        const count = document.getElementById('host-player-search-count');
        if (count) count.textContent = query.trim() ? `${visiblePlayers.length} von ${currentLobbyPlayers.length} Spielern` : '';
        hostPlayerList.innerHTML = visiblePlayers.length
            ? visiblePlayers.map(({ player, index }) => {
                const playerId = Number(player.id);
                const playerName = escapeHtml(player.name || 'Spieler');
                return `<tr><td class="participant-index">${index + 1}</td><td>${playerName}</td><td><button class="danger compact-action" onclick="kickPlayer(${playerId})"${disabled}>Entfernen</button></td></tr>`;
            }).join('')
            : `<tr><td colspan="3" class="participant-empty">${currentLobbyPlayers.length ? 'Keine passenden Spieler gefunden.' : 'Noch keine Spieler beigetreten.'}</td></tr>`;
    }
}

function setupParticipantSearch() {
    ['player-search', 'host-player-search'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderParticipantLists);
    });
}

function updateBlockedPlayers(blockedPlayers) {
    const normalizedBlocked = Array.isArray(blockedPlayers) ? blockedPlayers : [];

    const blockedCount = document.getElementById('host-blocked-count');
    if (blockedCount) {
        blockedCount.textContent = String(normalizedBlocked.length);
    }

    const blockedList = document.getElementById('host-blocked-list');
    if (blockedList) {
        const disabled = ['finished', 'endresult'].includes(currentRawState) ? ' disabled' : '';
        blockedList.innerHTML = normalizedBlocked.length
            ? normalizedBlocked.map((entry, index) => {
                const name = typeof entry === 'string' ? entry : entry?.name;
                const nameArgument = escapeHtml(JSON.stringify(name || ''));
                return `<tr><td class="participant-index">${index + 1}</td><td>${escapeHtml(name || 'Spieler')}</td><td><button class="ghost compact-action" onclick="unbanPlayer(${nameArgument})"${disabled}>Freigeben</button></td></tr>`;
            }).join('')
            : '<tr><td colspan="3" class="participant-empty">Niemand gesperrt.</td></tr>';
    }
}

function getPreviewAnswer(question) {
    if (question.type === 'short_text') {
        return Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.join(', ') : '-';
    }

    const indices = Array.isArray(question.correctOptionIndices) && question.correctOptionIndices.length
        ? question.correctOptionIndices.map(Number)
        : [Number(question.correctOptionIndex || 0)];
    return indices.map(index => question.options?.[index]).filter(Boolean).join(', ') || '-';
}

function renderHostQuestionPreview(questions) {
    const preview = document.getElementById('host-question-preview');
    if (!preview) return;

    const normalizedQuestions = Array.isArray(questions) ? questions : [];
    preview.innerHTML = normalizedQuestions.length
        ? normalizedQuestions.map((question, index) => `
            <article class="question-preview-item">
                <div class="small">Frage ${index + 1} · ${escapeHtml(getQuestionTypeLabel(question))}</div>
                <strong>${escapeHtml(question.text || '')}</strong>
                <div class="question-preview-answer"><span>Lösung</span>${escapeHtml(getPreviewAnswer(question))}</div>
            </article>
        `).join('')
        : '<p class="participant-empty">Keine Fragen vorhanden.</p>';
}

function showJoinActivity(playerName) {
    ['host-join-activity', 'display-join-activity'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;

        const entry = document.createElement('div');
        entry.className = 'join-activity-entry';
        entry.textContent = `${playerName || 'Spieler'} ist beigetreten`;
        container.prepend(entry);
        while (container.children.length > MAX_JOIN_ACTIVITY) {
            container.lastElementChild.remove();
        }
        window.setTimeout(() => entry.remove(), 5000);
    });
}

function updateLobbySnapshot(data) {
    const playerList = Array.isArray(data?.playerList) ? data.playerList : [];
    const playerCount = Number.isFinite(Number(data?.playerCount)) ? Number(data.playerCount) : playerList.length;
    const quizTitle = data?.quizTitle || 'Quiz';
    const quizDescription = data?.quizDescription || '';
    const quizImage = data?.quizImage || '';
    const questionCount = Number(data?.questionCount || 0);

    updatePhaseTimerMode(data);

    updateLobbyCount(playerCount);
    updateLobbyHostName(data?.hostName || 'Spielleiter');
    updateLobbyQuizTitle(quizTitle);
    updateLobbyPlayers(playerList);
    updateBlockedPlayers(data?.blockedPlayers || []);
    if (Array.isArray(data?.quizPreview)) {
        renderHostQuestionPreview(data.quizPreview);
    }

    const joinedTitle = document.getElementById('lobbyQuizTitleJoined');
    if (joinedTitle) joinedTitle.textContent = quizTitle;

    const joinedHost = document.getElementById('lobbyHostNameJoined');
    if (joinedHost) joinedHost.textContent = data?.hostName || 'Spielleiter';

    const descriptionBox = document.getElementById('playerLobbyDescription');
    if (descriptionBox) {
        descriptionBox.textContent = quizDescription ? quizDescription : 'Keine Beschreibung für dieses Quiz vorhanden.';
    }

    const playerImage = document.getElementById('playerLobbyImage');
    if (playerImage) {
        playerImage.src = quizImage;
        playerImage.alt = quizImage ? `Titelbild zu ${quizTitle}` : '';
        playerImage.classList.toggle('hidden', !quizImage);
    }

    const playerQuestionCount = document.getElementById('playerLobbyQuestionCount');
    if (playerQuestionCount) playerQuestionCount.textContent = String(questionCount);

    const playerLobbyPlayerCount = document.getElementById('playerLobbyPlayerCount');
    if (playerLobbyPlayerCount) playerLobbyPlayerCount.textContent = String(playerCount);

    const joinedMessage = document.getElementById('playerLobbyMessage');
    if (joinedMessage) {
        joinedMessage.textContent = 'Bitte warten Sie, bis der Spielleiter das Quiz startet.';
    }

    if (!data?.state || data.state === 'lobby') {
        updateDisplayLobbyState(data);
    }
}

function setPlayerLobbyVisible(isJoined) {
    const joinCard = document.getElementById('playerJoinCard');
    const joinedCard = document.getElementById('playerLobbyCard');

    if (joinCard) {
        joinCard.classList.toggle('hidden', isJoined);
    }

    if (joinedCard) {
        joinedCard.classList.toggle('hidden', !isJoined);
    }
}

function updateHostAnswerProgress(answeredCount, totalCount) {
    const answered = document.getElementById('host-answers');
    const total = document.getElementById('host-total');
    if (answered) answered.textContent = String(answeredCount || 0);
    if (total) total.textContent = String(totalCount || 0);

    const safeAnswered = Math.max(0, Number(answeredCount || 0));
    const safeTotal = Math.max(0, Number(totalCount || 0));
    const percent = safeTotal > 0 ? Math.min(100, Math.round((safeAnswered / safeTotal) * 100)) : 0;

    const progressPercent = document.getElementById('host-progress-percent');
    if (progressPercent) {
        progressPercent.textContent = `${percent}%`;
    }

    const progressFill = document.getElementById('host-progress-fill');
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

function updateLiveAnswerStats(data) {
    if (!data) return;
    updateHostAnswerProgress(data.answered, data.total);

    const hostStats = document.getElementById('host-live-answer-stats');
    if (hostStats) {
        hostStats.textContent = `${Number(data.correct || 0)} richtig · ${Number(data.incorrect || 0)} falsch · ${Number(data.pendingReview || 0)} offen`;
    }
    const enabledInput = document.getElementById('live-tracking-enabled');
    const thresholdInput = document.getElementById('live-tracking-threshold');
    if (enabledInput && data.enabled !== undefined) enabledInput.checked = Boolean(data.enabled);
    if (thresholdInput && data.threshold) thresholdInput.value = String(data.threshold);

    const panel = document.getElementById('display-live-tracking');
    if (!panel) return;
    panel.classList.toggle('hidden', !data.enabled);
    if (!data.enabled) {
        ['display-live-answered', 'display-live-total', 'display-live-correct', 'display-live-incorrect', 'display-live-pending']
            .forEach(id => {
                const element = document.getElementById(id);
                if (element) element.textContent = '0';
            });
        const correctness = document.getElementById('display-live-correctness');
        if (correctness) correctness.classList.add('hidden');
        return;
    }

    const answered = document.getElementById('display-live-answered');
    const total = document.getElementById('display-live-total');
    if (answered) answered.textContent = String(Number(data.answered || 0));
    if (total) total.textContent = String(Number(data.total || 0));
    const correctness = document.getElementById('display-live-correctness');
    if (correctness) correctness.classList.toggle('hidden', !data.correctnessVisible);
    const correct = document.getElementById('display-live-correct');
    const incorrect = document.getElementById('display-live-incorrect');
    const pending = document.getElementById('display-live-pending');
    if (correct) correct.textContent = String(Number(data.correct || 0));
    if (incorrect) incorrect.textContent = String(Number(data.incorrect || 0));
    if (pending) pending.textContent = String(Number(data.pendingReview || 0));
    const threshold = document.getElementById('display-live-threshold');
    if (threshold) threshold.textContent = data.correctnessVisible ? '' : `Auswertung ab ${Number(data.threshold || 1)} Abgaben`;
}

function updateQuestionStats(stats) {
    const hasStats = stats && Number(stats.answerCount) > 0;
    const text = hasStats
        ? `${Number(stats.answerCount)} Antworten · ${Number(stats.correctCount)} richtig · Ø ${Number(stats.averageTimeMs)} ms · ${Number(stats.pointsAwarded)} Punkte`
        : '';
    ['host-question-stats', 'player-question-stats', 'display-question-stats', 'display-presentation-stats'].forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.textContent = text;
        element.classList.toggle('hidden', !hasStats);
    });
}

function resolveHostPhaseHint(rawState) {
    const state = String(rawState || '').toLowerCase();
    if (state === 'start') return 'Alle sind bereit. Gib die erste Frage frei.';
    if (state === 'question') return 'Fragetext und Bild prüfen, dann Antwortmöglichkeiten zeigen.';
    if (state === 'options') return 'Antwortmöglichkeiten sind sichtbar und gesperrt. Starte die Antwortphase.';
    if (state === 'answer') return 'Antwortphase aktiv. Beobachte Fortschritt und beende bei Bedarf.';
    if (state === 'solution') return 'Ergebnisse besprechen und naechste Frage freigeben.';
    if (state === 'finished' || state === 'endresult') return 'Session abgeschlossen. Ergebnisse sichern und Quiz schliessen.';
    return 'Warte auf Teilnehmende oder starte das Quiz.';
}

function connect() {
    const url = getQuizWebSocketUrl(window.location, WS_HOST, WS_PORT, window.WS_PATH);
    console.log('🔌 Connecting to:', url);
    setConnectionMessage('Verbindung zum Quiz-Server wird hergestellt ...', 'connecting');
    socket = new WebSocket(url);

    socket.onopen = function () {
        console.log('✅ WebSocket verbunden');
        shouldAutoReconnect = true;
        reconnectAttempts = 0;
        setConnectionMessage('', 'online');
        setStatus('Verbunden', 'online');
        if (role === 'player' && sessionPin && nickname) {
            joinLobby();
        } else if (role === 'host' && sessionPin) {
            joinLobby();
        } else if (role === 'display' && sessionPin) {
            joinLobby();
        }
    };

    socket.onmessage = function (event) {
        try {
            const msg = JSON.parse(event.data);
            console.log('📨 RAW EVENT:', JSON.stringify(msg));
            console.log('📨 Event Type:', msg.type);
            handleMessage(msg);
        } catch (e) {
            console.error('❌ Parse Error:', e);
        }
    };

    socket.onclose = function (event) {
        console.log('❌ WebSocket getrennt');
        const closeCode = Number(event?.code || 0);
        const blockedByCloseCode = closeCode === 4000 || closeCode === 4001;
        if (shouldAutoReconnect && !blockedByCloseCode) {
            setConnectionMessage('Verbindung zum Quiz-Server verloren. Wiederverbindung läuft ...', 'offline');
            setStatus('Verbindung getrennt', 'offline');
            scheduleReconnect();
        }
    };

    socket.onerror = function (error) {
        console.error('❌ WebSocket Error:', error);
        setConnectionMessage('Der Quiz-Server ist nicht erreichbar. Wiederverbindung läuft ...', 'offline');
        setStatus('Verbindungsfehler', 'offline');
    };
}

function setConnectionMessage(text, state) {
    document.querySelectorAll('[data-connection-message]').forEach(element => {
        element.textContent = text;
        element.dataset.state = state || 'offline';
        element.classList.toggle('hidden', !text);
    });
}

function scheduleReconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }

    if (!role || !sessionPin) {
        return;
    }

    reconnectAttempts += 1;
    const delay = Math.min(3000, 500 + reconnectAttempts * 500);
    console.log(`🔄 Wiederverbindung in ${delay}ms (Versuch ${reconnectAttempts})`);

    reconnectTimer = setTimeout(() => {
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
            connect();
        }
    }, delay);
}

function handleMessage(msg) {
    console.log(`🔍 Processing: "${msg.type}"`);
    
    if (msg.type === 'lobby_joined') {
        console.log(`✅ lobby_joined: ${msg.data.playerCount}`);
        updateLobbySnapshot(msg.data || {});
        setPlayerLobbyVisible(true);
        setStatus('Lobby', 'ready');
        updateDisplayLobbyState(msg.data || {});
    } 
    else if (msg.type === 'lobby_update') {
        updateLobbySnapshot(msg.data || {});
        if (msg.data?.state === 'start') {
            showStartState(msg.data || {});
            return;
        }
        if (role === 'player' && (!msg.data?.state || msg.data.state === 'lobby')) {
            setPlayerLobbyVisible(true);
            setStatus('Lobby', 'ready');
        }
        if (document.getElementById('playerStatus') && (!msg.data?.state || msg.data.state === 'lobby')) {
            setStatus('Lobby', 'ready');
        }
    } 
    else if (msg.type === 'quiz_starting') {
        updateLobbySnapshot(msg.data || {});
        showStartState(msg.data || {});
        if (phaseTimersEnabled() && msg.data?.timeLeft) startTimer(msg.data.timeLeft);
    }
    else if (msg.type === 'quiz_started') {
        console.log('🎯 QUIZ_STARTED ERHALTEN!');
        setStatus('Frage wird angezeigt', 'question');
        showQuestion(msg.data.question, msg.data.timeLeft, false);
        if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
        answered = false;
        updateDisplayQuestion(msg.data.question, msg.data.timeLeft);
    }
    else if (msg.type === 'answer_options_shown') {
        setStatus('Antwortmöglichkeiten', 'options');
        showQuestion(msg.data.question, msg.data.timeLeft, false, true);
        if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
        updateDisplayQuestion(msg.data.question, msg.data.timeLeft, true);
    }
    else if (msg.type === 'answer_phase_started') {
        setStatus('Antwortphase läuft', 'answer');
        showQuestion(msg.data.question, msg.data.timeLeft, true);
        if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
        answered = false;
        updateDisplayQuestion(msg.data.question, msg.data.timeLeft, true);
    }
    else if (msg.type === 'next_question') {
        setStatus('Neue Frage wird angezeigt', 'question');
        showQuestion(msg.data.question, msg.data.timeLeft, false);
        if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
        answered = false;
        updateDisplayQuestion(msg.data.question, msg.data.timeLeft);
    } 
    else if (msg.type === 'show_solution') {
        currentResultRanking = Array.isArray(msg.data?.ranking) ? msg.data.ranking : [];
        updateQuestionStats(msg.data?.questionStats);
        setStatus('Lösung wird angezeigt', 'solution');
        if (phaseTimersEnabled()) startTimer(msg.data?.timeLeft);
        if (role === 'player' && !answered) lockAnswerControls('Antwortzeit abgelaufen.');
        if (role === 'player') {
            revealPlayerSolution(msg.data || {});
        }
        updateDisplaySolution(msg.data?.question || null, msg.data || {});
        updateHostRoundSummary(msg.data || {});
        updatePresentationView({ view: 'solution', questionStats: msg.data?.questionStats, rankingTrend: msg.data?.rankingTrend });
        showHostRanking(msg.data?.ranking || []);
        showHostResults(msg.data?.results || []);
    } 
    else if (msg.type === 'quiz_finished') {
        const finishMessage = msg.data?.message || 'Quiz beendet';
        setStatus(finishMessage, 'finished');
        showPlayerFinished(msg.data || {});
        updateDisplayFinished(msg.data || {});
        showHostRanking(msg.data?.ranking || []);
        showHostResults(msg.data?.results || []);
    }
    else if (msg.type === 'presentation_view_changed') {
        if (role === 'player') {
            if (currentRawState === 'solution') renderPlayerStanding(msg.data || {});
        } else {
            updatePresentationView(msg.data || {});
        }
    }
    else if (msg.type === 'player_answered') {
        const totalPlayers = Number(document.getElementById('host-total')?.textContent || 0) || Number(document.getElementById('playerCount')?.textContent?.replace(/\D+/g, '') || 0);
        const currentAnswered = Number(document.getElementById('host-answers')?.textContent || 0);
        updateHostAnswerProgress(currentAnswered + 1, totalPlayers);
    }
    else if (msg.type === 'live_answer_stats') {
        updateLiveAnswerStats(msg.data || {});
    }
    else if (msg.type === 'answer_rejected') {
        lockAnswerControls(msg.data?.reason || 'Die Antwort konnte nicht mehr angenommen werden.');
    }
    else if (msg.type === 'player_joined') {
        showJoinActivity(msg.data?.playerName || 'Spieler');
    }
    else if (msg.type === 'review_queue_updated') {
        showReviewQueue(msg.data?.reviews || []);
    }
    else if (msg.type === 'review_queue_error') {
        const error = document.getElementById('review-error');
        if (error) {
            error.textContent = msg.data?.reason || 'Freitextbewertungen konnten nicht geladen werden.';
            error.classList.remove('hidden');
            document.getElementById('review-panel')?.classList.remove('hidden');
        }
    }
    else if (msg.type === 'ranking_updated') {
        if (Object.prototype.hasOwnProperty.call(msg.data || {}, 'questionStats')) updateQuestionStats(msg.data.questionStats);
        if (role === 'player' && currentRawState === 'solution') {
            renderPlayerRound(msg.data || {});
            renderPlayerStanding(msg.data || {});
        } else if (role === 'player' && currentRawState === 'finished') {
            currentResultRanking = Array.isArray(msg.data?.ranking) ? msg.data.ranking : [];
            showPlayerFinished(msg.data || {});
        } else if (role === 'display' && currentRawState === 'solution') {
            if (msg.data?.rankingTrend) currentRankingTrend = msg.data.rankingTrend;
            updateDisplayRoundSummary(msg.data || {});
            refreshVisibleDisplayRanking(msg.data?.ranking);
        } else if (role === 'display' && currentRawState === 'finished') {
            updateDisplayFinished(msg.data || {}, true);
        }
        if (role === 'host' && currentRawState === 'solution') updateHostRoundSummary(msg.data || {});
        showHostRanking(msg.data?.ranking || []);
        showHostResults(msg.data?.results || []);
    }
    else if (msg.type === 'short_text_reviewed') {
        const points = Number(msg.data?.pointsAwarded || 0);
        const maximum = Number(msg.data?.pointsMaximum || 0);
        const comment = msg.data?.comment ? ` ${msg.data.comment}` : '';
        setStatus(`Freitext bewertet: ${points}/${maximum} Punkte.${comment}`, currentRawState);
    }
    else if (msg.type === 'kicked_from_session') {
        shouldAutoReconnect = false;
        localStorage.removeItem('quizzy_nickname');
        if (socket) {
            socket.close();
        }
        window.location.replace(`removed.php?pin=${encodeURIComponent(sessionPin || '')}`);
    }
    else if (msg.type === 'join_rejected') {
        const message = msg.data?.reason || 'Beitritt aktuell nicht möglich.';
        shouldAutoReconnect = false;
        setConnectionMessage(message, 'offline');
        setStatus('Beitritt abgelehnt', 'offline');
        if (socket) {
            socket.close();
        }
    }
    else if (msg.type === 'action_rejected') {
        setConnectionMessage(msg.data?.reason || 'Die Aktion wurde abgelehnt.', 'offline');
    }
    else if (msg.type === 'session_state_sync') {
        updateLiveAnswerStats(msg.data?.liveAnswerStats);
        updatePhaseTimerMode(msg.data || {});
        if (msg.data.state === 'start') {
            updateLobbySnapshot(msg.data || {});
            showStartState(msg.data || {});
            if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
        } else if (msg.data.state === 'question' && msg.data.question) {
            setStatus('Frage wird angezeigt', 'question');
            showQuestion(msg.data.question, msg.data.timeLeft, false);
            if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
            updateDisplayQuestion(msg.data.question, msg.data.timeLeft);
            updateHostAnswerProgress(0, Array.isArray(msg.data.ranking) ? msg.data.ranking.length : 0);
        } else if (msg.data.state === 'options' && msg.data.question) {
            setStatus('Antwortmöglichkeiten', 'options');
            showQuestion(msg.data.question, msg.data.timeLeft, false, true);
            if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
            updateDisplayQuestion(msg.data.question, msg.data.timeLeft, true);
            updateHostAnswerProgress(0, Array.isArray(msg.data.ranking) ? msg.data.ranking.length : 0);
        } else if (msg.data.state === 'answer' && msg.data.question) {
            setStatus('Antwortphase läuft', 'answer');
            showQuestion(msg.data.question, msg.data.timeLeft, true);
            answered = Boolean(msg.data.playerAnswered);
            if (answered) {
                submittedAnswer = msg.data.playerSubmission?.submittedAnswer || null;
                markPendingAnswer(submittedAnswer);
                lockAnswerControls();
            }
            if (phaseTimersEnabled()) startTimer(msg.data.timeLeft);
            updateDisplayQuestion(msg.data.question, msg.data.timeLeft, true);
            updateHostAnswerProgress(msg.data.answeredCount || 0, msg.data.playerCount || 0);
        } else if (msg.data.state === 'solution') {
            currentResultRanking = Array.isArray(msg.data?.ranking) ? msg.data.ranking : [];
            updateQuestionStats(msg.data?.questionStats);
            setStatus('Lösung wird angezeigt', 'solution');
            if (role === 'player') {
                if (msg.data.question) showQuestion(msg.data.question, msg.data.timeLeft, false, true);
                lockAnswerControls(msg.data.playerAnswered ? 'Antwort bereits abgegeben.' : 'Antwortzeit abgelaufen.');
                revealPlayerSolution(msg.data || {});
            }
            updateDisplaySolution(msg.data.question || null, msg.data || {});
            updateHostRoundSummary(msg.data || {});
            updatePresentationView({
                view: msg.data.presentationView || 'solution',
                ranking: msg.data.ranking || [],
                rankingTrend: msg.data.rankingTrend,
                freeTextAnswers: msg.data.freeTextAnswers || [],
                questionStats: msg.data.questionStats
            });
            showHostRanking(msg.data?.ranking || []);
            showHostResults(msg.data?.results || []);
        } else if (msg.data.state === 'finished' || msg.data.state === 'endresult') {
            setStatus('Quiz beendet', 'finished');
            showPlayerFinished(msg.data || {});
            updateDisplayFinished(msg.data || {});
            showHostRanking(msg.data?.ranking || []);
            showHostResults(msg.data?.results || []);
        } else {
            updateLobbySnapshot(msg.data || {});
            updateDisplayLobbyState(msg.data || {});
        }
    } 
    else {
        console.log('❓ UNKNOWN:', msg.type);
    }
}

// *** GLOBALE FUNKTIONEN - DIREKT IM WINDOW! ***
window.initPlayer = function(pin, name) {
    role = 'player';
    sessionPin = pin;
    nickname = name || 'Player';
    const tokenStorageKey = `quizzy_player_token_${pin}`;
    playerToken = localStorage.getItem(tokenStorageKey);
    if (!playerToken) {
        playerToken = typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(tokenStorageKey, playerToken);
    }
    shouldAutoReconnect = true;
    console.log('👥 initPlayer:', pin, name);
    setupParticipantSearch();
    connect();
};

window.initHost = function(pin, hostName, sessionHostToken) {
    role = 'host';
    sessionPin = pin;
    nickname = hostName || 'Host';
    hostToken = sessionHostToken || null;
    shouldAutoReconnect = true;
    console.log('🎛️ initHost:', pin, nickname);
    connect();
    setupHostControls();
    setupHostTabs();
    setupParticipantSearch();
};

window.initDisplay = function(pin) {
    role = 'display';
    sessionPin = pin;
    nickname = 'Display';
    shouldAutoReconnect = true;
    connect();
};

window.startQuiz = function() {
    console.log('🔘 startQuiz:', sessionPin);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('Keine Verbindung zum Server', 'offline');
        return;
    }
    socket.send(JSON.stringify({
        type: 'host_start_quiz',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname
    }));
};

window.showFirstQuestion = function() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('Keine Verbindung zum Server', 'offline');
        return;
    }
    socket.send(JSON.stringify({
        type: 'host_show_first_question',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname
    }));
};

window.selectPresentationView = function(view) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: 'host_select_presentation_view',
        role: 'host',
        sessionPin,
        view
    }));
};

window.endQuiz = function() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('Keine Verbindung zum Server', 'offline');
        return;
    }
    socket.send(JSON.stringify({
        type: 'host_end_quiz',
        role: 'host',
        sessionPin
    }));
};

window.sendAnswer = function(answerIndex) {
    if (answered || !socket) return;
    console.log('✅ sendAnswer:', answerIndex);
    socket.send(JSON.stringify({
        type: 'player_submit_answer',
        role: 'player',
        sessionPin: sessionPin,
        answerType: getQuestionType(currentQuestion),
        answerIndex: answerIndex
    }));
    answered = true;
    submittedAnswer = { answerIndex };
    markPendingAnswer(submittedAnswer);
    lockAnswerControls();
};

window.toggleMultiChoice = function(index) {
    if (selectedMultiChoice.has(index)) {
        selectedMultiChoice.delete(index);
    } else {
        selectedMultiChoice.add(index);
    }

    const checkbox = document.querySelector(`[data-choice-index="${index}"]`);
    if (checkbox) {
        checkbox.checked = selectedMultiChoice.has(index);
    }
};

window.submitMultiChoice = function() {
    if (answered || !socket) return;
    const selectedIndices = Array.from(selectedMultiChoice).sort((a, b) => a - b);
    socket.send(JSON.stringify({
        type: 'player_submit_answer',
        role: 'player',
        sessionPin: sessionPin,
        answerType: 'multiple_choice',
        selectedIndices
    }));
    answered = true;
    submittedAnswer = { selectedIndices };
    markPendingAnswer(submittedAnswer);
    lockAnswerControls();
};

window.submitTextAnswer = function() {
    if (answered || !socket) return;
    const input = document.getElementById('textAnswerInput');
    const answerText = input ? input.value.trim() : '';
    if (!answerText) return;

    socket.send(JSON.stringify({
        type: 'player_submit_answer',
        role: 'player',
        sessionPin: sessionPin,
        answerType: 'short_text',
        answerText: answerText
    }));
    answered = true;
    submittedAnswer = { answerText };
    const textInput = document.getElementById('textAnswerInput');
    if (textInput) textInput.classList.add('is-pending');
    lockAnswerControls();
};

function getSelectedAnswerIndices(answer) {
    if (Array.isArray(answer?.selectedIndices)) return answer.selectedIndices.map(Number);
    if (Number.isInteger(Number(answer?.answerIndex))) return [Number(answer.answerIndex)];
    return [];
}

function markPendingAnswer(answer) {
    const selectedIndices = getSelectedAnswerIndices(answer);
    document.querySelectorAll('#answerOptions [data-answer-index]').forEach(tile => {
        tile.classList.toggle('is-pending', selectedIndices.includes(Number(tile.dataset.answerIndex)));
    });
}

function revealPlayerSolution(solutionData) {
    const result = solutionData?.playerResult || null;
    const selectedIndices = getSelectedAnswerIndices(result?.submittedAnswer || submittedAnswer);
    const correctIndices = Array.isArray(solutionData?.correctOptionIndices)
        ? solutionData.correctOptionIndices.map(Number)
        : (Number.isInteger(Number(solutionData?.correctOptionIndex)) ? [Number(solutionData.correctOptionIndex)] : []);

    document.querySelectorAll('#answerOptions [data-answer-index]').forEach(tile => {
        const index = Number(tile.dataset.answerIndex);
        tile.classList.remove('is-pending');
        tile.classList.toggle('is-correct', correctIndices.includes(index));
        tile.classList.toggle('is-incorrect', selectedIndices.includes(index) && !correctIndices.includes(index));
    });

    const confirmation = document.querySelector('[data-answer-confirmation]');
    if (confirmation) confirmation.remove();

    renderPlayerRound(solutionData || {});
    renderPlayerStanding(solutionData || {});
}

const ROUND_STATUS_TO_STAT = { correct: 'correct', partial: 'partial', incorrect: 'incorrect', pending: 'pendingReview', no_answer: 'noAnswer' };
let lastPlayerCelebration = '';
let lastPlayerRoundData = null;

function resetPlayerResultPanels() {
    lastPlayerRoundData = null;
    ['player-round-panel', 'player-standing-panel'].forEach(id => {
        const panel = document.getElementById(id);
        if (!panel) return;
        panel.innerHTML = '';
        panel.classList.add('hidden');
    });
}

function renderPlayerRound(data) {
    const panel = document.getElementById('player-round-panel');
    const visuals = window.QuizResultVisuals;
    if (!panel || !visuals || role !== 'player') return;
    if (!data.roundResult && !data.playerResult && !data.roundStats) return;
    lastPlayerRoundData = { ...(lastPlayerRoundData || {}), ...data };
    const roundResult = data.roundResult || null;
    const status = roundResult?.status || (data.playerResult ? (data.playerResult.isCorrect ? 'correct' : 'incorrect') : 'no_answer');
    panel.innerHTML = `
        ${visuals.verdictCard(roundResult, data.playerResult || null)}
        ${visuals.roundPlacement(roundResult)}
        ${data.roundStats ? `<h3 class="round-panel-title">So hat die Runde geantwortet</h3>${visuals.outcomeChart(data.roundStats, { highlight: ROUND_STATUS_TO_STAT[status] })}` : ''}
    `;
    panel.classList.remove('hidden');
    panel.querySelectorAll('[data-count-to]').forEach(element => visuals.countUp(element));

    const celebrationKey = `${data.roundStats?.questionId ?? data.question?.id ?? ''}:${status}:${roundResult?.points ?? ''}`;
    const isPodium = Number(roundResult?.rank) > 0 && Number(roundResult.rank) <= 3 && Number(roundResult.points) > 0;
    if ((status === 'correct' || isPodium) && celebrationKey !== lastPlayerCelebration) {
        lastPlayerCelebration = celebrationKey;
        visuals.burst(panel.querySelector('.verdict-card') || panel);
    }
}

function playerStandingEntries(ranking, standing) {
    const entries = Array.isArray(ranking) ? ranking.slice(0, 10) : [];
    const ownRank = Number(standing?.rank || 0);
    if (ownRank <= 10) return { entries, own: null };
    const own = (Array.isArray(ranking) && ranking[ownRank - 1])
        || { rank: ownRank, name: nickname || 'Du', points: Number(standing?.points || 0) };
    return { entries, own };
}

function renderPlayerStanding(data) {
    const panel = document.getElementById('player-standing-panel');
    const visuals = window.QuizResultVisuals;
    if (!panel || !visuals || role !== 'player') return;
    if (!data.rankingReleased) {
        panel.innerHTML = '';
        panel.classList.add('hidden');
        return;
    }
    const ranking = Array.isArray(data.ranking) ? data.ranking : [];
    currentResultRanking = ranking;
    const standing = data.ownStanding || (data.ownPlacement ? { ...data.ownPlacement } : null);
    const trend = Array.isArray(data.rankingTrend) ? data.rankingTrend : [];
    const maxPoints = Number(ranking[0]?.points || 0);
    const { entries, own } = playerStandingEntries(ranking, standing);
    const ownRank = Number(standing?.rank || 0);
    panel.innerHTML = `
        <h3 class="round-panel-title">Gesamtstand</h3>
        ${visuals.standingSummary(standing)}
        ${visuals.rankingBars(entries, { trend, maxPoints, highlightRank: ownRank })}
        ${own ? `<div class="ranking-gap" aria-hidden="true">⋯</div>${visuals.rankingBars([own], { trend: [trend[ownRank - 1] || { roundPoints: standing?.roundPoints, movement: standing?.movement }], maxPoints, highlightRank: ownRank })}` : ''}
    `;
    panel.classList.remove('hidden');
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showPlayerFinished(data) {
    const finishedView = document.getElementById('player-finished-view');
    if (!finishedView || role !== 'player') return;

    ['lobbyView', 'playerStartView', 'questionView'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
    finishedView.classList.remove('hidden');
    const ranking = Array.isArray(data?.ranking) ? data.ranking : [];
    const placement = document.getElementById('player-finished-placement');
    const top10 = document.getElementById('player-finished-top10');
    const fullRanking = document.getElementById('player-finished-ranking');
    const visuals = window.QuizResultVisuals;
    const ownRank = Number(data?.ownPlacement?.rank || 0);
    const trend = Array.isArray(data?.rankingTrend) ? data.rankingTrend : [];
    const maxPoints = Number(ranking[0]?.points || 0);
    if (placement) {
        const ownEntry = ownRank > 0 ? ranking[ownRank - 1] : null;
        if (visuals && ownEntry) {
            placement.innerHTML = visuals.standingSummary({ rank: ownRank, total: data.ownPlacement.total, points: ownEntry.points });
        } else {
            placement.textContent = window.QuizGroupView.placementText(data?.ownPlacement) || 'Dein Platz ist derzeit nicht verfügbar.';
        }
    }
    if (top10) {
        top10.innerHTML = visuals
            ? visuals.rankingBars(ranking.slice(0, 10), { trend, maxPoints, highlightRank: ownRank })
            : renderRanking(ranking.slice(0, 10));
    }
    if (fullRanking) {
        fullRanking.innerHTML = visuals
            ? visuals.rankingBars(ranking, { trend, maxPoints, highlightRank: ownRank })
            : renderRanking(ranking);
    }
    if (visuals && ownRank > 0 && ownRank <= 3 && lastPlayerCelebration !== 'finished') {
        lastPlayerCelebration = 'finished';
        visuals.burst(finishedView);
    }
}

function lockAnswerControls(message = 'Antwort eingeloggt – die Auflösung folgt nach Ablauf der Zeit.') {
    const options = document.getElementById('answerOptions');
    if (!options) return;

    options.querySelectorAll('button, input').forEach(control => {
        control.disabled = true;
    });

    if (!options.querySelector('[data-answer-confirmation]')) {
        const confirmation = document.createElement('p');
        confirmation.className = 'small answer-confirmation';
        confirmation.dataset.answerConfirmation = 'true';
        confirmation.textContent = message;
        options.appendChild(confirmation);
    }
}

function joinLobby() {
    console.log('👥 joinLobby:', sessionPin, nickname, 'role=', role);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('Verbindung noch nicht bereit', 'offline');
        return;
    }

    const payload = {
        type: 'join',
        role: role || 'player',
        sessionPin: sessionPin,
        data: {
            nickname: nickname,
            playerToken: role === 'player' ? playerToken : null,
            hostToken: role === 'host' ? hostToken : null
        }
    };

    socket.send(JSON.stringify(payload));
}

// UI FUNCTIONS
function updateLobbyCount(count) {
    const elem = document.getElementById('playerCount');
    if (elem) elem.textContent = `Spieler (ohne Spielleiter): ${count}`;

    const questionCount = document.getElementById('questionPlayerCount');
    if (questionCount) {
        questionCount.textContent = `Spieler (ohne Spielleiter): ${count}`;
    }

    const hostCount = document.getElementById('host-player-count');
    if (hostCount) hostCount.textContent = String(count || 0);
    updateHostAnswerProgress(0, count);
}

function setStatus(text, state) {
    currentRawState = String(state || '').toLowerCase();
    const normalizedState = (typeof StatusUtils !== 'undefined' && StatusUtils.normalizeState)
        ? StatusUtils.normalizeState(state)
        : String(state || '').toLowerCase();
    const resolvedText = (typeof StatusUtils !== 'undefined' && StatusUtils.resolveStatusText)
        ? StatusUtils.resolveStatusText(text, normalizedState, role || 'player')
        : text;

    const playerStatus = document.getElementById('playerHeaderStatus');
    if (playerStatus) {
        playerStatus.textContent = resolvedText;
        playerStatus.dataset.state = normalizedState;
    }

    const playerLobbyStatus = document.getElementById('playerLobbyStatus');
    if (playerLobbyStatus) {
        playerLobbyStatus.textContent = resolvedText;
        playerLobbyStatus.dataset.state = normalizedState;
    }

    const hostStatus = document.getElementById('host-status');
    if (hostStatus) {
        hostStatus.textContent = resolvedText;
        hostStatus.dataset.state = normalizedState;
    }

    const questionState = document.getElementById('questionState');
    if (questionState) {
        questionState.textContent = resolvedText;
    }

    const hostStateElement = document.getElementById('host-state');
    if (hostStateElement) {
        hostStateElement.textContent = resolvedText;
    }

    const hostPhaseHint = document.getElementById('host-phase-hint');
    if (hostPhaseHint) {
        hostPhaseHint.textContent = resolveHostPhaseHint(currentRawState);
    }

    document.querySelectorAll('#host-player-list button, #host-blocked-list button').forEach(button => {
        button.disabled = normalizedState === 'finished';
    });
    updateHostControlButtons(normalizedState, currentRawState);
}

function updateHostControlButtons(state, rawState) {
    const startButton = document.getElementById('btn-start-quiz');
    const firstQuestionButton = document.getElementById('btn-show-first-question');
    const showOptionsButton = document.getElementById('btn-show-options');
    const startAnswerButton = document.getElementById('btn-start-answer');
    const endAnswerButton = document.getElementById('btn-end-answer');
    const nextQuestionButton = document.getElementById('btn-next-question');
    const endQuizButton = document.getElementById('btn-end-quiz');
    const normalizedState = String(state || '').toLowerCase();
    const currentState = String(rawState || '').toLowerCase();

    if (startButton) {
        startButton.disabled = currentState === 'start' || (normalizedState !== 'ready' && normalizedState !== 'lobby' && normalizedState !== 'offline');
    }

    if (firstQuestionButton) {
        firstQuestionButton.disabled = currentState !== 'start';
    }

    if (showOptionsButton) {
        showOptionsButton.disabled = currentState !== 'question';
    }

    if (startAnswerButton) {
        startAnswerButton.disabled = currentState !== 'options';
    }

    if (endAnswerButton) {
        endAnswerButton.disabled = currentState !== 'answer';
    }

    if (nextQuestionButton) {
        nextQuestionButton.disabled = currentState !== 'solution';
    }

    document.querySelectorAll('[data-presentation-view]').forEach(button => {
        button.disabled = currentState !== 'solution';
    });

    if (endQuizButton) {
        endQuizButton.disabled = normalizedState === 'offline' || normalizedState === 'finished';
    }
}

function updatePlayerStatus(status) {
    setStatus(status, 'ready');
}

function showQuestion(question, timeLeft, allowAnswers, showLockedOptions = false) {
    console.log('📋 showQuestion:', question.text);
    const isNewQuestion = Number(currentQuestion?.id) !== Number(question?.id);
    currentQuestion = question || null;
    if (isNewQuestion) submittedAnswer = null;
    selectedMultiChoice = new Set();
    if (isNewQuestion) resetPlayerResultPanels();
    document.getElementById('host-round-summary')?.classList.add('hidden');
    document.getElementById('display-round-summary')?.classList.add('hidden');
    document.getElementById('player-finished-view')?.classList.add('hidden');
    const lobbyView = document.getElementById('lobbyView');
    const startView = document.getElementById('playerStartView');
    const questionView = document.getElementById('questionView');

    if (lobbyView) lobbyView.classList.add('hidden');
    if (startView) startView.classList.add('hidden');
    if (questionView) questionView.classList.remove('hidden');
    const hostStartState = document.getElementById('host-start-state');
    if (hostStartState) hostStartState.classList.add('hidden');
    updateQuestionImages(question);
    
    const questionText = document.getElementById('questionText');
    if (questionText) questionText.textContent = question.text;

    const hostQuestionText = document.getElementById('host-question-text');
    if (hostQuestionText) {
        hostQuestionText.innerHTML = `<strong>${escapeHtml(question.text)}</strong><br><span class="small">${escapeHtml(getQuestionTypeLabel(question))}</span>`;
    }

    const hostOptions = document.getElementById('host-question-options');
    if (hostOptions) {
        hostOptions.innerHTML = (showLockedOptions || allowAnswers) && Array.isArray(question.options)
            ? question.options.map((option, index) => `<div class="answer-btn locked">${renderOptionContent(question, index)}</div>`).join('')
            : '<p class="small">Antwortmöglichkeiten sind noch ausgeblendet.</p>';
    }

    updateHostAnswerProgress(0, Number(document.getElementById('host-total')?.textContent || 0));
    
    const options = document.getElementById('answerOptions');
    if (options) {
        if (!allowAnswers && !showLockedOptions) {
            options.innerHTML = '<p class="small">Die Antwortmöglichkeiten werden gleich angezeigt.</p>';
            return;
        }

        const questionType = getQuestionType(question);

        if (showLockedOptions) {
            if (questionType === 'short_text') {
                options.innerHTML = '<div class="answer-btn locked" aria-disabled="true">Freitextantwort</div>';
            } else {
                options.innerHTML = `<div class="quiz-answer-grid">${(question.options || []).map((opt, index) =>
                    `<div class="answer-btn answer-tile locked" data-answer-index="${index}" aria-disabled="true"><span class="answer-letter">${String.fromCharCode(65 + index)}</span>${renderOptionContent(question, index)}</div>`
                ).join('')}</div>`;
            }
            return;
        }

        if (questionType === 'short_text') {
            options.innerHTML = `
                <input id="textAnswerInput" type="text" placeholder="Antwort eingeben" class="answer-input" style="width:100%;padding:12px;border-radius:12px;border:1px solid #cbd5e1;margin-bottom:12px;">
                <button class="answer-btn primary" onclick="submitTextAnswer()">Antwort senden</button>
            `;
        } else if (questionType === 'multiple_choice') {
            options.innerHTML = `<div class="quiz-answer-grid">${question.options.map((opt, i) => 
                `<label class="answer-btn answer-tile" data-answer-index="${i}">
                    <input type="checkbox" data-choice-index="${i}" onchange="toggleMultiChoice(${i})" style="margin-right:10px;">
                    <span class="answer-letter">${String.fromCharCode(65 + i)}</span>${renderOptionContent(question, i)}
                </label>`
            ).join('')}</div><button class="answer-btn primary" style="margin-top:8px;" onclick="submitMultiChoice()">Auswahl senden</button>`;
        } else {
            options.innerHTML = `<div class="quiz-answer-grid">${question.options.map((opt, i) => 
                `<button onclick="sendAnswer(${i})" class="answer-btn answer-tile" data-answer-index="${i}"><span class="answer-letter">${String.fromCharCode(65 + i)}</span>${renderOptionContent(question, i)}</button>`
            ).join('')}</div>`;
        }
    }
}

function startTimer(seconds) {
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    const timerElem = document.getElementById('timer');
    if (!timerElem) return;

    const deadline = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
    const renderRemainingTime = () => {
        const timeLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        timerElem.textContent = String(timeLeft);
        if (timeLeft === 0 && timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    };

    renderRemainingTime();
    timerInterval = setInterval(renderRemainingTime, 250);
}

function updateDisplayLobbyState(data) {
    stopDisplayPages();
    const lobbyData = data && typeof data === 'object' ? data : { playerCount: data };
    const playerCount = Number(lobbyData.playerCount || 0);
    const lobbyView = document.getElementById('display-lobby');
    const startView = document.getElementById('display-start');
    const questionView = document.getElementById('display-question');
    const answerView = document.getElementById('display-answer');
    const resultView = document.getElementById('display-result');
    const presentationView = document.getElementById('display-presentation');

    if (lobbyView) lobbyView.classList.remove('hidden');
    if (startView) startView.classList.add('hidden');
    if (questionView) questionView.classList.add('hidden');
    if (answerView) answerView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    if (presentationView) presentationView.classList.add('hidden');

    const title = document.getElementById('displayLobbyTitle');
    if (title) title.textContent = lobbyData.quizTitle || 'Quiz';

    const description = document.getElementById('displayLobbyDescription');
    if (description) description.textContent = lobbyData.quizDescription || 'Keine Beschreibung für dieses Quiz vorhanden.';

    const image = document.getElementById('displayLobbyImage');
    if (image) {
        image.src = lobbyData.quizImage || '';
        image.alt = lobbyData.quizImage ? `Titelbild zu ${lobbyData.quizTitle || 'Quiz'}` : '';
        image.classList.toggle('hidden', !lobbyData.quizImage);
    }

    const questionCount = document.getElementById('displayLobbyQuestionCount');
    if (questionCount) questionCount.textContent = String(Number(lobbyData.questionCount || 0));

    const playerCountElement = document.getElementById('displayLobbyPlayerCount');
    if (playerCountElement) playerCountElement.textContent = String(playerCount);

    const hostName = document.getElementById('displayLobbyHostName');
    if (hostName) hostName.textContent = lobbyData.hostName || 'Spielleiter';
}

function showStartState(data) {
    stopDisplayPages();
    currentQuestion = null;
    answered = false;
    setStatus('Quiz startet', 'start');

    const lobbyView = document.getElementById('lobbyView');
    const playerStartView = document.getElementById('playerStartView');
    const questionView = document.getElementById('questionView');
    if (lobbyView) lobbyView.classList.add('hidden');
    if (playerStartView) playerStartView.classList.remove('hidden');
    if (questionView) questionView.classList.add('hidden');
    document.getElementById('player-finished-view')?.classList.add('hidden');

    const playerTitle = document.getElementById('playerStartTitle');
    if (playerTitle) playerTitle.textContent = data?.quizTitle || 'Quiz';

    const hostStartState = document.getElementById('host-start-state');
    if (hostStartState) hostStartState.classList.remove('hidden');
    const hostQuestionText = document.getElementById('host-question-text');
    const hostQuestionOptions = document.getElementById('host-question-options');
    const hostQuestionImage = document.getElementById('host-question-image');
    if (hostQuestionText) hostQuestionText.textContent = '';
    if (hostQuestionOptions) hostQuestionOptions.textContent = '';
    if (hostQuestionImage) hostQuestionImage.classList.add('hidden');
    updateHostAnswerProgress(0, Number(data?.playerCount || 0));

    const displayLobby = document.getElementById('display-lobby');
    const displayStart = document.getElementById('display-start');
    const displayQuestion = document.getElementById('display-question');
    const displayResult = document.getElementById('display-result');
    const displayPresentation = document.getElementById('display-presentation');
    if (displayLobby) displayLobby.classList.add('hidden');
    if (displayStart) displayStart.classList.remove('hidden');
    if (displayQuestion) displayQuestion.classList.add('hidden');
    if (displayResult) displayResult.classList.add('hidden');
    if (displayPresentation) displayPresentation.classList.add('hidden');

    const displayTitle = document.getElementById('displayStartTitle');
    if (displayTitle) displayTitle.textContent = data?.quizTitle || 'Quiz';
}

function updateDisplayQuestion(question, timeLeft, showOptions = false) {
    stopDisplayPages();
    const lobbyView = document.getElementById('display-lobby');
    const startView = document.getElementById('display-start');
    const questionView = document.getElementById('display-question');
    const answerView = document.getElementById('display-answer');
    const resultView = document.getElementById('display-result');
    const presentationView = document.getElementById('display-presentation');

    if (lobbyView) lobbyView.classList.add('hidden');
    if (startView) startView.classList.add('hidden');
    if (questionView) questionView.classList.remove('hidden');
    if (answerView) answerView.classList.add('hidden');
    if (resultView) resultView.classList.add('hidden');
    if (presentationView) presentationView.classList.add('hidden');
    updateQuestionImages(question);

    const questionText = document.getElementById('display-question-text');
    if (questionText && question) {
        questionText.textContent = question.text;
    }

    const questionType = document.getElementById('display-question-type');
    if (questionType && question) {
        questionType.textContent = getQuestionTypeLabel(question);
    }

    const timer = document.getElementById('display-info-timer');
    if (timer) {
        timer.textContent = phaseTimersEnabled() && timeLeft ? `${timeLeft} s` : '';
    }

    let displayOptions = document.getElementById('display-question-options');
    if (!displayOptions && questionView) {
        displayOptions = document.createElement('div');
        displayOptions.id = 'display-question-options';
        questionView.appendChild(displayOptions);
    }
    if (displayOptions) {
        displayOptions.innerHTML = showOptions && Array.isArray(question?.options)
            ? `<div class="quiz-answer-grid">${question.options.map((option, index) => `<div class="answer-btn answer-tile locked" aria-disabled="true"><span class="answer-letter">${String.fromCharCode(65 + index)}</span>${renderOptionContent(question, index)}</div>`).join('')}</div>`
            : '';
    }
}

function updateDisplaySolution(question, solutionData) {
    stopDisplayPages();
    const lobbyView = document.getElementById('display-lobby');
    const startView = document.getElementById('display-start');
    const questionView = document.getElementById('display-question');
    const answerView = document.getElementById('display-answer');
    const resultView = document.getElementById('display-result');
    const presentationView = document.getElementById('display-presentation');

    if (lobbyView) lobbyView.classList.add('hidden');
    if (startView) startView.classList.add('hidden');
    if (questionView) questionView.classList.add('hidden');
    if (answerView) answerView.classList.add('hidden');
    if (resultView) resultView.classList.remove('hidden');
    if (presentationView) presentationView.classList.add('hidden');
    document.getElementById('display-solution-content')?.classList.remove('hidden');
    const finishedRanking = document.getElementById('display-finished-ranking');
    if (finishedRanking) finishedRanking.innerHTML = '';
    updateQuestionImages(question);

    const finishedTitle = document.getElementById('display-finished-title');
    if (finishedTitle) {
        finishedTitle.textContent = 'Richtige Antwort';
    }

    const questionText = document.getElementById('display-answer-question-text');
    if (questionText && question) {
        questionText.textContent = question.text;
    }

    const questionType = document.getElementById('display-answer-type');
    if (questionType && question) {
        questionType.textContent = getQuestionTypeLabel(question);
    }

    const optionsList = document.getElementById('display-options');
    if (optionsList && question && Array.isArray(question.options)) {
        const correctIndices = Array.isArray(solutionData?.correctOptionIndices)
            ? solutionData.correctOptionIndices.map(Number)
            : (Number.isInteger(solutionData?.correctOptionIndex) ? [solutionData.correctOptionIndex] : []);
        optionsList.className = 'quiz-answer-grid';
        const optionCounts = Array.isArray(solutionData?.roundStats?.optionCounts) ? solutionData.roundStats.optionCounts : null;
        const answeredCount = Math.max(1, Number(solutionData?.roundStats?.answered || 0));
        optionsList.innerHTML = question.options.map((option, index) => {
            const isCorrect = correctIndices.includes(index);
            const count = optionCounts ? Number(optionCounts[index] || 0) : null;
            const votes = count === null ? '' : `<span class="tile-votes" style="--w:${Math.round((count / answeredCount) * 100)}%;--i:${index}" aria-label="${count} Stimmen"><span class="tile-votes-fill"></span><b>${count}</b></span>`;
            return `<li class="answer-tile ${isCorrect ? 'is-correct' : ''}${count !== null ? ' has-votes' : ''}"><span class="answer-letter">${String.fromCharCode(65 + index)}</span>${renderOptionContent(question, index)}${votes}</li>`;
        }).join('');
    }
    updateDisplayRoundSummary(solutionData || {});

    const timer = document.getElementById('display-answer-timer');
    if (timer) {
        timer.textContent = 'Lösung';
    }

    const correct = document.getElementById('display-correct');
    if (correct && question) {
        if (Array.isArray(solutionData?.acceptedAnswers) && solutionData.acceptedAnswers.length > 0) {
            correct.textContent = `Akzeptierte Antworten: ${solutionData.acceptedAnswers.join(', ')}`;
        } else if (Array.isArray(solutionData?.correctOptionIndices) && solutionData.correctOptionIndices.length > 0) {
            const answers = solutionData.correctOptionIndices.map(index => getOptionLabel(question, index));
            correct.textContent = `Richtig sind: ${answers.join(', ')}`;
        } else if (typeof solutionData?.correctOptionIndex === 'number') {
            correct.textContent = `Richtig ist: ${getOptionLabel(question, solutionData.correctOptionIndex)}`;
        }
    }
}

function stopDisplayPages() {
    if (displayPageTimer !== null) {
        window.clearInterval(displayPageTimer);
        displayPageTimer = null;
    }
}

function renderDisplayPages(container, entries, pageSize, renderPage, listClass, initialPage = 0) {
    stopDisplayPages();
    let page = initialPage;
    const listLabel = listClass === 'display-ranking-grid' ? 'Rangliste' : 'Freitext-Antworten';
    container.innerHTML = `
        <div class="${listClass}" tabindex="0" role="region" aria-label="${listLabel}"></div>
        <nav class="display-page-controls" aria-label="Seitensteuerung">
            <button type="button" class="ghost" data-page-previous>Zurück</button>
            <span data-page-label></span>
            <button type="button" class="ghost" data-page-next>Weiter</button>
        </nav>`;
    const list = container.querySelector(`.${listClass}`);
    const controls = container.querySelector('.display-page-controls');
    const label = container.querySelector('[data-page-label]');
    const previous = container.querySelector('[data-page-previous]');
    const next = container.querySelector('[data-page-next]');

    function render() {
        const result = window.QuizGroupView.rankingPage(entries, page, pageSize);
        page = result.page;
        container.dataset.page = String(page);
        list.innerHTML = renderPage(result.items, Math.max(0, Number(result.first || 1) - 1));
        controls.classList.toggle('hidden', result.totalPages <= 1);
        label.textContent = `${result.first}–${result.last} von ${result.total} · Seite ${page + 1}/${result.totalPages}`;
    }

    function startRotation() {
        stopDisplayPages();
        if (window.QuizGroupView.rankingPage(entries, page, pageSize).totalPages > 1) {
            displayPageTimer = window.setInterval(() => {
                const totalPages = window.QuizGroupView.rankingPage(entries, page, pageSize).totalPages;
                page = (page + 1) % totalPages;
                render();
            }, DISPLAY_PAGE_INTERVAL_MS);
        }
    }

    previous.addEventListener('click', () => {
        const totalPages = window.QuizGroupView.rankingPage(entries, page, pageSize).totalPages;
        page = (page - 1 + totalPages) % totalPages;
        render();
        startRotation();
    });
    next.addEventListener('click', () => {
        const totalPages = window.QuizGroupView.rankingPage(entries, page, pageSize).totalPages;
        page = (page + 1) % totalPages;
        render();
        startRotation();
    });
    render();
    startRotation();
}

function updatePresentationView(data) {
    stopDisplayPages();
    const view = String(data?.view || 'solution');
    currentPresentationView = view;
    updateQuestionStats(data?.questionStats);
    document.querySelectorAll('[data-presentation-view]').forEach(button => {
        button.classList.toggle('active', button.dataset.presentationView === view);
    });
    const resultView = document.getElementById('display-result');
    const presentationView = document.getElementById('display-presentation');
    if (view === 'solution') {
        if (resultView) resultView.classList.remove('hidden');
        if (presentationView) presentationView.classList.add('hidden');
        return;
    }

    const title = document.getElementById('display-presentation-title');
    const content = document.getElementById('display-presentation-content');
    if (!presentationView || !title || !content) return;

    if (resultView) resultView.classList.add('hidden');
    presentationView.classList.remove('hidden');
    if (view === 'free_text') {
        title.textContent = 'Freitext-Antworten';
        const answers = Array.isArray(data?.freeTextAnswers) ? data.freeTextAnswers : [];
        renderDisplayPages(content, answers, 3, items => items.length
            ? items.map(answer => `<blockquote class="free-text-answer">${escapeHtml(answer.answerText || '')}</blockquote>`).join('')
            : '<p class="small">Keine freigegebenen Freitext-Antworten.</p>', 'display-free-text-list');
        return;
    }

    title.textContent = view === 'top10' ? 'Top 10' : 'Gesamtstand';
    if (Array.isArray(data?.rankingTrend)) currentRankingTrend = data.rankingTrend;
    const entries = Array.isArray(data?.ranking) ? data.ranking : [];
    renderDisplayPages(content, view === 'top10' ? entries.slice(0, 10) : entries, 10,
        rankingBarsPageRenderer(entries), 'display-ranking-grid');
    celebrateDisplay(presentationView, `view:${view}:${entries[0]?.name || ''}:${entries[0]?.points || 0}`);
}

function rankingBarsPageRenderer(allEntries, trend = currentRankingTrend) {
    const visuals = window.QuizResultVisuals;
    const maxPoints = Number(allEntries?.[0]?.points || 0);
    return (items, offset = 0) => visuals
        ? visuals.rankingBars(items, { trend, offset, maxPoints })
        : renderRanking(items);
}

function celebrateDisplay(container, key) {
    if (!window.QuizResultVisuals || !container || key === lastDisplayCelebration) return;
    lastDisplayCelebration = key;
    window.QuizResultVisuals.burst(container, 60);
}

function updateDisplayRoundSummary(data) {
    const summary = document.getElementById('display-round-summary');
    const visuals = window.QuizResultVisuals;
    if (!summary || !visuals) return;
    if (!data?.roundStats) {
        summary.classList.add('hidden');
        return;
    }
    summary.innerHTML = `
        <h3>So hat der Raum geantwortet</h3>
        ${visuals.outcomeChart(data.roundStats)}
        ${data.roundStats.averageTimeMs ? `<p class="round-meta">Ø Antwortzeit ${visuals.formatSeconds(data.roundStats.averageTimeMs)}</p>` : ''}
        <h3>Schnellste Punktejäger</h3>
        ${visuals.roundTopList(data.roundTop || [])}
    `;
    summary.classList.remove('hidden');
}

function updateHostRoundSummary(data) {
    const summary = document.getElementById('host-round-summary');
    const visuals = window.QuizResultVisuals;
    if (!summary || !visuals || role !== 'host') return;
    if (!data?.roundStats) return;
    summary.innerHTML = `
        <div class="host-round-grid">
            <div><h4>Antworten dieser Runde</h4>${visuals.outcomeChart(data.roundStats)}</div>
            <div><h4>Rundensieger</h4>${visuals.roundTopList(data.roundTop || [])}</div>
        </div>
    `;
    summary.classList.remove('hidden');
}

function refreshVisibleDisplayRanking(ranking) {
    const presentationView = document.getElementById('display-presentation');
    const content = document.getElementById('display-presentation-content');
    if (!presentationView || presentationView.classList.contains('hidden') || !content
        || !['top10', 'ranking'].includes(currentPresentationView)) return;
    const entries = Array.isArray(ranking) ? ranking : [];
    const page = Number(content.dataset.page || 0);
    renderDisplayPages(content, currentPresentationView === 'top10' ? entries.slice(0, 10) : entries,
        10, rankingBarsPageRenderer(entries), 'display-ranking-grid', page);
}

function renderDisplayFinalRanking(container, ranking, showAll = false, initialPage = 0) {
    stopDisplayPages();
    container.dataset.showAll = String(showAll);
    container.innerHTML = `<h3>${showAll ? 'Gesamtranking' : 'Top 10'}</h3>
        <div data-final-ranking></div>
        ${ranking.length > 10 ? `<button type="button" class="ghost" data-final-toggle>${showAll ? 'Top 10 anzeigen' : 'Gesamtranking anzeigen'}</button>` : ''}`;
    const list = container.querySelector('[data-final-ranking]');
    renderDisplayPages(list, showAll ? ranking : ranking.slice(0, 10), 10, rankingBarsPageRenderer(ranking), 'display-ranking-grid', initialPage);
    const toggle = container.querySelector('[data-final-toggle]');
    if (toggle) toggle.addEventListener('click', () => renderDisplayFinalRanking(container, ranking, !showAll));
}

function updateDisplayFinished(data, preserveView = false) {
    stopDisplayPages();
    const lobbyView = document.getElementById('display-lobby');
    const startView = document.getElementById('display-start');
    const questionView = document.getElementById('display-question');
    const answerView = document.getElementById('display-answer');
    const resultView = document.getElementById('display-result');
    const presentationView = document.getElementById('display-presentation');

    if (lobbyView) lobbyView.classList.add('hidden');
    if (startView) startView.classList.add('hidden');
    if (questionView) questionView.classList.add('hidden');
    if (answerView) answerView.classList.add('hidden');
    if (resultView) resultView.classList.remove('hidden');
    if (presentationView) presentationView.classList.add('hidden');
    document.getElementById('display-solution-content')?.classList.add('hidden');

    const finishedTitle = document.getElementById('display-finished-title');
    if (finishedTitle) {
        finishedTitle.textContent = 'Quiz beendet';
    }

    const finishedRanking = document.getElementById('display-finished-ranking');
    if (finishedRanking) {
        if (Array.isArray(data?.rankingTrend)) currentRankingTrend = data.rankingTrend;
        const showAll = preserveView && finishedRanking.dataset.showAll === 'true';
        const page = preserveView ? Number(finishedRanking.querySelector('[data-final-ranking]')?.dataset.page || 0) : 0;
        const finalRanking = Array.isArray(data?.ranking) ? data.ranking : [];
        renderDisplayFinalRanking(finishedRanking, finalRanking, showAll, page);
        if (finalRanking.length) celebrateDisplay(resultView || finishedRanking, `finished:${finalRanking[0].name}:${finalRanking[0].points}`);
    }
}

function setupHostControls() {
    const startButton = document.getElementById('btn-start-quiz');
    const firstQuestionButton = document.getElementById('btn-show-first-question');
    const showOptionsButton = document.getElementById('btn-show-options');
    const startAnswerButton = document.getElementById('btn-start-answer');
    const endAnswerButton = document.getElementById('btn-end-answer');
    const nextQuestionButton = document.getElementById('btn-next-question');
    const endQuizButton = document.getElementById('btn-end-quiz');
    const saveLiveTrackingButton = document.getElementById('btn-save-live-tracking');

    if (saveLiveTrackingButton) {
        saveLiveTrackingButton.onclick = function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;
            socket.send(JSON.stringify({
                type: 'host_configure_live_tracking',
                role: 'host',
                sessionPin,
                enabled: Boolean(document.getElementById('live-tracking-enabled')?.checked),
                threshold: Number(document.getElementById('live-tracking-threshold')?.value || 1)
            }));
        };
    }

    if (startButton) {
        startButton.onclick = function () {
            window.startQuiz();
        };
    }

    if (firstQuestionButton) {
        firstQuestionButton.onclick = function () {
            window.showFirstQuestion();
        };
    }

    document.querySelectorAll('[data-presentation-view]').forEach(button => {
        button.onclick = () => window.selectPresentationView(button.dataset.presentationView);
    });

    if (endQuizButton) {
        endQuizButton.onclick = () => window.endQuiz();
    }

    if (showOptionsButton) {
        showOptionsButton.onclick = function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                setStatus('Keine Verbindung zum Server', 'offline');
                return;
            }
            socket.send(JSON.stringify({
                type: 'host_show_answer_options',
                role: 'host',
                sessionPin: sessionPin,
                nickname: nickname
            }));
        };
    }

    if (startAnswerButton) {
        startAnswerButton.onclick = function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                setStatus('Keine Verbindung zum Server', 'offline');
                return;
            }
            socket.send(JSON.stringify({
                type: 'host_start_answer_phase',
                role: 'host',
                sessionPin: sessionPin,
                nickname: nickname
            }));
        };
    }

    if (endAnswerButton) {
        endAnswerButton.onclick = function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                setStatus('Keine Verbindung zum Server', 'offline');
                return;
            }
            socket.send(JSON.stringify({
                type: 'host_end_answer_phase',
                role: 'host',
                sessionPin: sessionPin,
                nickname: nickname
            }));
        };
    }

    if (nextQuestionButton) {
        nextQuestionButton.onclick = function () {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                setStatus('Keine Verbindung zum Server', 'offline');
                return;
            }
            socket.send(JSON.stringify({
                type: 'host_next_question',
                role: 'host',
                sessionPin: sessionPin,
                nickname: nickname
            }));
        };
    }
}

function setupHostTabs() {
    const activate = (buttons, panels, attribute, panelAttribute, value) => {
        buttons.forEach(button => button.classList.toggle('active', button.getAttribute(attribute) === value));
        panels.forEach(panel => panel.classList.toggle('hidden', panel.getAttribute(panelAttribute) !== value));
    };

    const hostTabs = document.querySelectorAll('[data-host-tab]');
    const hostPanels = document.querySelectorAll('[data-host-panel]');
    hostTabs.forEach(button => button.addEventListener('click', () => {
        activate(hostTabs, hostPanels, 'data-host-tab', 'data-host-panel', button.dataset.hostTab);
    }));

    const sideTabs = document.querySelectorAll('[data-side-tab]');
    const sidePanels = document.querySelectorAll('[data-side-panel]');
    sideTabs.forEach(button => button.addEventListener('click', () => {
        activate(sideTabs, sidePanels, 'data-side-tab', 'data-side-panel', button.dataset.sideTab);
    }));
}

window.reviewShortTextAnswer = function(reviewId, quickPoints) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const pointsInput = document.getElementById(`review-points-${reviewId}`);
    const commentInput = document.getElementById(`review-comment-${reviewId}`);
    const points = quickPoints === undefined ? Number(pointsInput?.value) : Number(quickPoints);
    socket.send(JSON.stringify({
        type: 'review_short_text_answer',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname,
        reviewId,
        points,
        comment: commentInput?.value || ''
    }));
};

window.kickPlayer = function(playerId) {
    if (role !== 'host') return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: 'host_kick_player',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname,
        playerId: Number(playerId)
    }));
};

window.unbanPlayer = function(playerName) {
    if (role !== 'host' || !playerName) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: 'host_unban_player',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname,
        playerName: playerName
    }));
};

window.QuizApp = {
    initPlayer: window.initPlayer,
    initHost: window.initHost,
    initDisplay: window.initDisplay
};

console.log('✅ app.js geladen - Globale Funktionen bereit');
