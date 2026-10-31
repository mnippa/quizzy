const test = require('node:test');
const assert = require('node:assert/strict');

const { handlePlayerAnswerSingle } = require('../quiz');

test('rejects an answer received after the configured deadline', async () => {
    const messages = [];
    const ws = {
        clientId: 7,
        readyState: 1,
        send(payload) {
            messages.push(JSON.parse(payload));
        }
    };
    const player = { id: 7, name: 'LatePlayer', points: 0, answered: false };
    const sessions = {
        LATE20: {
            state: 'answer',
            answerStartTime: Date.now() - 20050,
            question: {
                id: 1,
                type: 'single_choice',
                time_limit: 20,
                correct_option_index: 1
            },
            players: { 7: player }
        }
    };
    const utils = {
        saveSessionPlayer() {
            throw new Error('late answer must not be persisted');
        }
    };

    await handlePlayerAnswerSingle(ws, {
        sessionPin: 'LATE20',
        answerIndex: 1
    }, sessions, utils);

    assert.equal(player.answered, false);
    assert.equal(player.points, 0);
    assert.deepEqual(messages, [{
        type: 'answer_rejected',
        data: { reason: 'Die Antwortzeit ist abgelaufen.' }
    }]);
});