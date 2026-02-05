// *** GLOBALE FUNKTIONEN ZUR VERFÜGUNG STELLEN ***
let socket = null;
let role = null;
let sessionPin = null;
let nickname = null;
let answered = false;

function connect() {
    const url = `ws://${WS_HOST}:${WS_PORT}`;
    console.log('🔌 Connecting to:', url);
    socket = new WebSocket(url);

    socket.onopen = function () {
        console.log('✅ WebSocket verbunden');
        updatePlayerStatus('Verbunden (Lobby)');
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

    socket.onclose = function () {
        console.log('❌ WebSocket getrennt');
        updatePlayerStatus('Getrennt - Reload');
    };

    socket.onerror = function (error) {
        console.error('❌ WebSocket Error:', error);
    };
}

function handleMessage(msg) {
    console.log(`🔍 Processing: "${msg.type}"`);
    
    if (msg.type === 'lobby_joined') {
        console.log(`✅ lobby_joined: ${msg.data.playerCount}`);
        updateLobbyCount(msg.data.playerCount);
        updatePlayerStatus('In Lobby');
    } 
    else if (msg.type === 'lobby_update') {
        updateLobbyCount(msg.data.playerCount);
    } 
    else if (msg.type === 'quiz_started') {
        console.log('🎯 QUIZ_STARTED ERHALTEN!');
        showQuestion(msg.data.question, msg.data.timeLeft);
        startTimer(msg.data.timeLeft);
        answered = false;
        updatePlayerStatus('Quiz läuft!');
    } 
    else if (msg.type === 'next_question') {
        showQuestion(msg.data.question, msg.data.timeLeft);
        startTimer(msg.data.timeLeft);
        answered = false;
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
    console.log('👥 initPlayer:', pin, name);
    connect();
    setTimeout(() => joinLobby(), 500);
};

window.initHost = function(pin) {
    role = 'host';
    sessionPin = pin;
    nickname = 'Host';
    connect();
};

window.startQuiz = function() {
    console.log('🔘 startQuiz:', sessionPin);
    socket.send(JSON.stringify({
        type: 'host_start_quiz',
        role: 'host',
        sessionPin: sessionPin,
        nickname: nickname
    }));
};

window.sendAnswer = function(answerIndex) {
    if (answered || !socket) return;
    console.log('✅ sendAnswer:', answerIndex);
    socket.send(JSON.stringify({
        type: 'player_answer_single',
        role: 'player',
        sessionPin: sessionPin,
        answerIndex: answerIndex
    }));
    answered = true;
};

function joinLobby() {
    console.log('👥 joinLobby:', sessionPin, nickname);
    socket.send(JSON.stringify({
        type: 'join',
        role: 'player',
        sessionPin: sessionPin,
        data: { nickname: nickname }
    }));
}

// UI FUNCTIONS
function updateLobbyCount(count) {
    const elem = document.getElementById('playerCount');
    if (elem) elem.textContent = `Spieler: ${count}`;
}

function updatePlayerStatus(status) {
    const elem = document.getElementById('playerStatus');
    if (elem) elem.textContent = status;
}

function showQuestion(question, timeLeft) {
    console.log('📋 showQuestion:', question.text);
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('questionView').style.display = 'block';
    
    document.getElementById('questionText').textContent = question.text;
    
    const options = document.getElementById('answerOptions');
    options.innerHTML = question.options.map((opt, i) => 
        `<button onclick="sendAnswer(${i})" class="answer-btn">${opt}</button>`
    ).join('');
}

function startTimer(seconds) {
    let timeLeft = seconds;
    const timerElem = document.getElementById('timer');
    if (!timerElem) return;
    
    timerElem.textContent = timeLeft;
    const timer = setInterval(() => {
        timeLeft--;
        timerElem.textContent = timeLeft;
        if (timeLeft <= 0) clearInterval(timer);
    }, 1000);
}

console.log('✅ app.js geladen - Globale Funktionen bereit');
