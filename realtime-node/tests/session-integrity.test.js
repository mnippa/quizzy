const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const CLOSED_PIN = '910010';
const OPEN_PIN = '910011';
const UNKNOWN_PIN = '919999';
let config;
let serverModule;
let webSocketServer;
let serverUrl;

async function waitForMessage(socket, expectedType, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', handleMessage);
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, timeoutMs);

    const handleMessage = data => {
      const message = JSON.parse(data.toString());
      if (message.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off('message', handleMessage);
      resolve(message);
    };

    socket.on('message', handleMessage);
  });
}

async function joinAndExpectRejection(role, sessionPin) {
  const socket = new WebSocket(serverUrl);
  await once(socket, 'open');
  const rejectionPromise = waitForMessage(socket, 'join_rejected');

  socket.send(JSON.stringify({
    type: 'join',
    role,
    sessionPin,
    data: {
      nickname: `${role}-integrity-test`,
      playerToken: role === 'player' ? `token-${sessionPin}` : null
    }
  }));

  const rejection = await rejectionPromise;
  const serverSocket = Array.from(webSocketServer.clients).find(client => client.readyState === WebSocket.OPEN);
  assert.equal(serverSocket?.role, undefined, 'rejected join must not assign a role');
  assert.equal(serverSocket?.sessionPin, undefined, 'rejected join must not assign a session PIN');

  const closePromise = once(socket, 'close');
  socket.close();
  await closePromise;
  return rejection;
}

async function sessionExists(pin) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [rows] = await connection.execute('SELECT pin FROM sessions WHERE pin = ? LIMIT 1', [pin]);
    return rows.length > 0;
  } finally {
    await connection.end();
  }
}

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, [CLOSED_PIN, OPEN_PIN]);

  const connection = await mysql.createConnection(config.db);
  await connection.execute("UPDATE sessions SET state = 'finished' WHERE pin = ?", [CLOSED_PIN]);
  await connection.end();

  serverModule = require('../server');
  webSocketServer = await serverModule.startServer({
    host: '127.0.0.1',
    port: 0,
    allowPortFallback: false
  });
  serverUrl = `ws://127.0.0.1:${webSocketServer.address().port}`;
});

test.after(async () => {
  if (serverModule) await serverModule.stopServer();
  if (config) await cleanupSessions(config.db, [CLOSED_PIN, OPEN_PIN, UNKNOWN_PIN]);
});

test('unknown PIN is rejected for every role and never persisted', async () => {
  for (const role of ['player', 'host', 'display']) {
    const rejection = await joinAndExpectRejection(role, UNKNOWN_PIN);
    assert.match(rejection.data.reason, /nicht gefunden/i);
  }

  assert.equal(await sessionExists(UNKNOWN_PIN), false);
  assert.equal(serverModule.sessions[UNKNOWN_PIN], undefined);
});

test('invalid PIN format is rejected before a session is loaded', async () => {
  const rejection = await joinAndExpectRejection('player', 'ABC');
  assert.match(rejection.data.reason, /sechsstellig/i);
  assert.equal(serverModule.sessions.ABC, undefined);
});

test('finished session rejects a new join', async () => {
  const rejection = await joinAndExpectRejection('player', CLOSED_PIN);
  assert.match(rejection.data.reason, /geschlossen/i);
});

test('persisted dashboard close is broadcast to connected players', async () => {
  const socket = new WebSocket(serverUrl);
  await once(socket, 'open');
  const joinedPromise = waitForMessage(socket, 'lobby_joined');

  socket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin: OPEN_PIN,
    data: {
      nickname: 'CloseBroadcastPlayer',
      playerToken: 'close-broadcast-player'
    }
  }));
  await joinedPromise;

  const finishedPromise = waitForMessage(socket, 'quiz_finished', 4000);
  const connection = await mysql.createConnection(config.db);
  await connection.execute("UPDATE sessions SET state = 'endresult' WHERE pin = ?", [OPEN_PIN]);
  await connection.end();

  const finished = await finishedPromise;
  assert.equal(finished.data.message, 'Das aktuelle Quiz ist beendet.');
  assert.deepEqual(finished.data.ownPlacement, { rank: 1, total: 1 });

  const closePromise = once(socket, 'close');
  socket.close();
  await closePromise;
});