(function (global) {
    'use strict';

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        var node = byId(id);
        if (node) {
            node.textContent = value;
        }
    }

    function createPlayerUI(options) {
        var send = options.send;
        var state = {
            sessionPin: '',
            nickname: '',
            answered: false,
            timerRef: null
        };

        function updateStatus(text) {
            setText('playerStatus', text);
        }

        function updateLobbyCount(count) {
            setText('playerCount', 'Spieler: ' + count);
        }

        function stopTimer() {
            if (state.timerRef) {
                clearInterval(state.timerRef);
                state.timerRef = null;
            }
        }

        function startTimer(seconds) {
            var timerNode = byId('timer');
            if (!timerNode) {
                return;
            }

            stopTimer();
            var left = seconds;
            timerNode.textContent = String(left);

            state.timerRef = setInterval(function () {
                left -= 1;
                timerNode.textContent = String(left);
                if (left <= 0) {
                    stopTimer();
                }
            }, 1000);
        }

        function sendJoin() {
            send({
                type: 'join',
                role: 'player',
                sessionPin: state.sessionPin,
                data: { nickname: state.nickname }
            });
        }

        function renderQuestion(question) {
            var lobbyView = byId('lobbyView');
            var questionView = byId('questionView');
            var questionText = byId('questionText');
            var options = byId('answerOptions');

            if (lobbyView) {
                lobbyView.style.display = 'none';
            }
            if (questionView) {
                questionView.style.display = 'block';
            }
            if (questionText) {
                questionText.textContent = question.text || '';
            }

            if (!options || !Array.isArray(question.options)) {
                return;
            }

            options.innerHTML = '';
            question.options.forEach(function (option, index) {
                var button = document.createElement('button');
                button.className = 'answer-btn';
                button.textContent = option;
                button.addEventListener('click', function () {
                    sendAnswer(index);
                });
                options.appendChild(button);
            });
        }

        function lockAnswerButtons() {
            var buttons = document.querySelectorAll('#answerOptions .answer-btn');
            buttons.forEach(function (button) {
                button.disabled = true;
            });
        }

        function sendAnswer(index) {
            if (state.answered) {
                return;
            }

            var ok = send({
                type: 'player_answer_single',
                role: 'player',
                sessionPin: state.sessionPin,
                answerIndex: index
            });

            if (ok) {
                state.answered = true;
                lockAnswerButtons();
            }
        }

        function init(pin, nickname) {
            state.sessionPin = pin;
            state.nickname = nickname || 'Player';
            state.answered = false;
            updateStatus('Verbinde...');
        }

        function onOpen() {
            updateStatus('Verbunden (Lobby)');
            sendJoin();
        }

        function onClose() {
            updateStatus('Getrennt - Reload');
            stopTimer();
        }

        function onMessage(msg) {
            if (msg.type === 'lobby_joined') {
                if (msg.data && typeof msg.data.playerCount === 'number') {
                    updateLobbyCount(msg.data.playerCount);
                }
                updateStatus('In Lobby');
                return;
            }

            if (msg.type === 'lobby_update') {
                if (msg.data && typeof msg.data.playerCount === 'number') {
                    updateLobbyCount(msg.data.playerCount);
                }
                return;
            }

            if (msg.type === 'quiz_started' || msg.type === 'next_question') {
                if (msg.data && msg.data.question) {
                    renderQuestion(msg.data.question);
                }
                state.answered = false;
                updateStatus('Quiz laeuft');
                startTimer((msg.data && msg.data.timeLeft) || 15);
            }
        }

        return {
            init: init,
            onOpen: onOpen,
            onClose: onClose,
            onMessage: onMessage,
            sendAnswer: sendAnswer
        };
    }

    global.QuizzyPlayerUI = {
        create: createPlayerUI
    };
})(window);
