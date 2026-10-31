const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { PlayerSimulator, parseArguments, buildAnswerMessage } = require('../scripts/simulate-players');

test('simulator requires a test PIN and only permits local endpoints', () => {
    const localUrl = 'ws://localhost:8082';
    assert.throws(() => parseArguments([], localUrl), /sechsstellige/);
    assert.throws(() => parseArguments(['--pin', '123456', '--url', 'ws://example.org:8082'], localUrl), /nur lokale/);
    assert.throws(() => parseArguments(['--pin', '123456', '--count', '101'], localUrl), /zwischen 1 und 100/);
    const options = parseArguments(['--pin', '123456', '--count', '2', '--interval-ms', '0', '--answer'], localUrl);
    assert.equal(options.count, 2);
    assert.equal(options.intervalMs, 0);
    assert.equal(options.autoAnswer, true);
});

test('simulator generates submissions for supported question types', () => {
    assert.deepEqual(buildAnswerMessage('123456', { type: 'single_choice', options: ['A', 'B'] }, 1).answerIndex, 1);
    assert.deepEqual(buildAnswerMessage('123456', { type: 'true_false', options: ['Wahr', 'Falsch'] }, 0).answerIndex, 0);
    assert.deepEqual(buildAnswerMessage('123456', { type: 'multiple_choice', options: ['A', 'B', 'C'] }, 2).selectedIndices, [0, 2]);
    assert.equal(buildAnswerMessage('123456', { type: 'short_text' }, 2).answerText, 'Testantwort 3');
    assert.throws(() => buildAnswerMessage('123456', { type: 'single_choice', options: [] }, 0), /keine Antwortoptionen/);
});

test('simulated players join uniquely and submit once per answer phase', async () => {
    const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const joined = [];
    const answers = [];
    let finishAnswers;
    const answerPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Testantworten fehlen.')), 5000);
        finishAnswers = () => {
            clearTimeout(timeout);
            resolve();
        };
    });

    server.on('connection', socket => {
        socket.on('message', raw => {
            const message = JSON.parse(raw.toString());
            if (message.type === 'join') {
                joined.push(message);
                socket.send(JSON.stringify({ type: 'lobby_joined', data: {} }));
                if (joined.length === 4) {
                    const event = JSON.stringify({
                        type: 'answer_phase_started',
                        data: { question: { id: 8, type: 'single_choice', options: ['A', 'B'] } }
                    });
                    server.clients.forEach(client => {
                        client.send(event);
                        client.send(event);
                    });
                }
            } else if (message.type === 'player_submit_answer') {
                answers.push(message);
                if (answers.length === 4) finishAnswers();
            }
        });
    });

    const simulator = new PlayerSimulator({
        pin: '123456', count: 4, intervalMs: 0,
        url: `ws://127.0.0.1:${server.address().port}`, autoAnswer: true
    });
    const problems = [];
    simulator.on('problem', problem => problems.push(problem));
    try {
        assert.deepEqual(await simulator.start(), { joined: 4, total: 4 });
        await answerPromise;
        assert.equal(new Set(joined.map(message => message.data.nickname)).size, 4);
        assert.equal(new Set(joined.map(message => message.data.playerToken)).size, 4);
        assert.equal(answers.length, 4);
        assert.deepEqual(new Set(answers.map(message => message.answerIndex)), new Set([0, 1]));
        assert.deepEqual(problems, []);
    } finally {
        await simulator.stop();
        await new Promise(resolve => server.close(resolve));
    }
});

test('simulator reports rejected joins and closes its sockets', async () => {
    const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.on('connection', socket => {
        socket.on('message', () => socket.send(JSON.stringify({
            type: 'join_rejected', data: { reason: 'Test-Session nicht gefunden' }
        })));
    });
    const simulator = new PlayerSimulator({
        pin: '123456', count: 2, intervalMs: 0,
        url: `ws://127.0.0.1:${server.address().port}`, autoAnswer: false
    });
    try {
        await assert.rejects(simulator.start(), /Test-Session nicht gefunden/);
        assert.equal(simulator.stopping, true);
    } finally {
        await simulator.stop();
        await new Promise(resolve => server.close(resolve));
    }
});
