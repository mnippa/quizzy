let socket = null;
let role = null;
let sessionPin = null;
let nickname = null;
let answered = false;
let timerHandle = null;

function connect() {
    const url = `ws://${WS_HOST}:${WS_PORT}`;
    socket = new WebSocket(url);

    socket.onopen = function () {
        updatePlayerStatus('Verbunden');
        setHostStatus('Verbunden');
    };

    socket.onmessage = function (event) {
        try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
        } catch (e) {
            console.error('Parse Error:', e);
        }
    };

    socket.onclose = function () {
        updatePlayerStatus('Getrennt');
        setHostStatus('Getrennt');
    };

    socket.onerror = function (error) {
        console.error('WebSocket Error:', error);
    };
}

function sendMessage(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
}

function handleMessage(msg) {
    if (msg.type === 'lobby_joined') {
        updateLobbyCount(msg.data.playerCount);
        setHostTotals(msg.data.playerCount);
        updatePlayerStatus('In Lobby');
        setHostState(msg.data.state || 'lobby');
        return;
    }

    if (msg.type === 'lobby_update') {
        updateLobbyCount(msg.data.playerCount);
        setHostTotals(msg.data.playerCount);
        return;
    }

    if (msg.type === 'quiz_started' || msg.type === 'next_question') {
        answered = false;
        showQuestion(msg.data.question);
        startTimer(msg.data.timeLeft);
        setHostQuestion(msg.data.question);
        setHostState('question');
        setHostAnswers(0);
        return;
    }

    if (msg.type === 'player_answered') {
        incrementHostAnswers();
        return;
    }

    if (msg.type === 'show_solution') {
        renderRanking(msg.data.ranking || []);
        setHostState('solution');
        return;
    }

    if (msg.type === 'quiz_finished') {
        renderRanking(msg.data.ranking || []);
        setHostState('finished');
        return;
    }

    if (msg.type === 'error') {
        const errorMessage = (msg.data && msg.data.message) ? msg.data.message : 'Unbekannter Fehler';
        updatePlayerStatus(errorMessage);
        setHostStatus(errorMessage);
    }
}

function joinLobby(joinRole) {
    sendMessage({
        type: 'join',
        role: joinRole,
        sessionPin: sessionPin,
        data: { nickname: nickname }
    });
}

function bindHostControls() {
    const startBtn = document.getElementById('btn-start-quiz');
    const endAnswerBtn = document.getElementById('btn-end-answer');
    const nextQuestionBtn = document.getElementById('btn-next-question');

    if (startBtn) {
        startBtn.addEventListener('click', function () {
            sendMessage({
                type: 'host_start_quiz',
                role: 'host',
                sessionPin: sessionPin,
                nickname: nickname
            });
        });
    }

    if (endAnswerBtn) {
        endAnswerBtn.disabled = false;
        endAnswerBtn.addEventListener('click', function () {
            sendMessage({
                type: 'host_end_answer_phase',
                role: 'host',
                sessionPin: sessionPin
            });
        });
    }

    if (nextQuestionBtn) {
        nextQuestionBtn.disabled = false;
        nextQuestionBtn.addEventListener('click', function () {
            sendMessage({
                type: 'host_next_question',
                role: 'host',
                sessionPin: sessionPin
            });
        });
    }
}

window.initPlayer = function (pin, name) {
    role = 'player';
    sessionPin = pin;
    nickname = name || 'Player';
    connect();
    setTimeout(function () {
        joinLobby('player');
    }, 300);
};

window.initHost = function (pin) {
    role = 'host';
    sessionPin = pin;
    nickname = 'Host';
    connect();
    bindHostControls();
    setTimeout(function () {
        joinLobby('host');
    }, 300);
};

window.initDisplay = function (pin) {
    role = 'display';
    sessionPin = pin;
    nickname = 'Display';
    connect();
};

window.startQuiz = function () {
    sendMessage({
        type: 'host_start_quiz',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname
    });
};

window.sendAnswer = function (answerIndex) {
    if (answered) return;
    sendMessage({
        type: 'player_answer_single',
        role: 'player',
        sessionPin: sessionPin,
        answerIndex: answerIndex
    });
    answered = true;
};

window.QuizApp = {
    initPlayer: window.initPlayer,
    initHost: window.initHost,
    initDisplay: window.initDisplay,
    startQuiz: window.startQuiz,
    sendAnswer: window.sendAnswer
};

function updateLobbyCount(count) {
    const elem = document.getElementById('playerCount');
    if (elem) elem.textContent = `Spieler: ${count}`;
}

function updatePlayerStatus(status) {
    const elem = document.getElementById('playerStatus');
    if (elem) elem.textContent = status;
}

function setHostStatus(status) {
    const elem = document.getElementById('host-status');
    if (elem) elem.textContent = status;
}

function setHostState(state) {
    const elem = document.getElementById('host-state');
    if (elem) elem.textContent = state;
}

function setHostQuestion(question) {
    const elem = document.getElementById('host-question-text');
    if (!elem || !question) return;
    elem.textContent = question.text || '';
}

function setHostTotals(playerCount) {
    const totalElem = document.getElementById('host-total');
    if (totalElem) totalElem.textContent = String(playerCount || 0);
}

function setHostAnswers(value) {
    const answersElem = document.getElementById('host-answers');
    if (answersElem) answersElem.textContent = String(value);
}

function incrementHostAnswers() {
    const answersElem = document.getElementById('host-answers');
    if (!answersElem) return;
    const current = parseInt(answersElem.textContent || '0', 10);
    answersElem.textContent = String(current + 1);
}

function renderRanking(ranking) {
    const wrap = document.getElementById('host-ranking');
    const list = document.getElementById('ranking-list');
    if (!wrap || !list) return;
    wrap.style.display = 'block';
    list.innerHTML = ranking
        .map(function (item) {
            return `${item.rank}. ${item.name} - ${item.points}`;
        })
        .join('<br>');
}

function showQuestion(question) {
    const lobbyView = document.getElementById('lobbyView');
    const questionView = document.getElementById('questionView');
    const questionText = document.getElementById('questionText');
    const options = document.getElementById('answerOptions');

    if (lobbyView) lobbyView.style.display = 'none';
    if (questionView) questionView.style.display = 'block';
    if (questionText && question) questionText.textContent = question.text || '';
    if (options && question && Array.isArray(question.options)) {
        options.innerHTML = question.options
            .map(function (opt, i) {
                return `<button onclick="sendAnswer(${i})" class="answer-btn">${opt}</button>`;
            })
            .join('');
    }
}

function startTimer(seconds) {
    const timerElem = document.getElementById('timer');
    if (!timerElem) return;

    if (timerHandle) clearInterval(timerHandle);
    let timeLeft = Number(seconds || 0);
    timerElem.textContent = String(timeLeft);
    timerHandle = setInterval(function () {
        timeLeft -= 1;
        timerElem.textContent = String(Math.max(0, timeLeft));
        if (timeLeft <= 0) {
            clearInterval(timerHandle);
            timerHandle = null;
        }
    }, 1000);
}
