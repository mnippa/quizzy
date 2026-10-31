const test = require('node:test');
const assert = require('node:assert/strict');
const utilsFactory = require('../utils');

test('disconnect lobby updates expose the quiz preview only to hosts', async () => {
    const received = { host: [], player: [], display: [] };
    const socket = (role, clientId) => ({
        role,
        clientId,
        readyState: 1,
        send(payload) { received[role].push(JSON.parse(payload)); }
    });
    const host = socket('host', 1);
    const player = socket('player', 2);
    const display = socket('display', 3);
    const disconnected = { role: 'player', clientId: 4, sessionPin: '123456', readyState: 3 };
    const sessions = {
        '123456': {
            state: 'answer',
            players: {
                2: { id: 2, name: 'Active', ws: player },
                4: { id: 4, name: 'Disconnected', ws: disconnected }
            },
            hosts: [host],
            displays: [display],
            quiz_preview: [{ text: 'Question', correctOptionIndex: 1, acceptedAnswers: ['secret'] }]
        }
    };

    await utilsFactory({}).handleClientDisconnect(disconnected, sessions);
    assert.equal(received.host.length, 1);
    assert.equal(received.player.length, 1);
    assert.equal(received.display.length, 1);
    assert.deepEqual(received.host[0].data.quizPreview, sessions['123456'].quiz_preview);
    assert.equal(Object.hasOwn(received.player[0].data, 'quizPreview'), false);
    assert.equal(Object.hasOwn(received.display[0].data, 'quizPreview'), false);
    assert.equal(JSON.stringify(received.player).includes('secret'), false);
    assert.equal(JSON.stringify(received.display).includes('secret'), false);
});
