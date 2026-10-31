const test = require('node:test');
const assert = require('node:assert/strict');
const getQuizWebSocketUrl = require('../../public/js/websocket-url');

test('uses secure same-origin WebSockets behind HTTPS', () => {
    assert.equal(
        getQuizWebSocketUrl({ protocol: 'https:', host: 'quiz.example.org' }, '127.0.0.1', 8081, '/ws'),
        'wss://quiz.example.org/ws'
    );
});

test('keeps the configured host and port for local HTTP', () => {
    assert.equal(
        getQuizWebSocketUrl({ protocol: 'http:', host: 'localhost' }, '127.0.0.1', 8082, '/ws'),
        'ws://127.0.0.1:8082'
    );
});

test('normalizes a configured secure WebSocket path', () => {
    assert.equal(
        getQuizWebSocketUrl({ protocol: 'https:', host: 'quiz.example.org' }, 'localhost', 8081, 'socket'),
        'wss://quiz.example.org/socket'
    );
});
