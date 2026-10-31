const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const AUTH_PIN = '910030';
const MISSING_PIN = '910031';
const OTHER_PIN = '910032';
const PLAYER_PIN = '910033';
const TEST_PINS = [AUTH_PIN, MISSING_PIN, OTHER_PIN, PLAYER_PIN];
const AUTH_TOKEN = 'auth-token-for-session-910030';
const MISSING_PIN_TOKEN = 'auth-token-for-session-910031';
const OTHER_TOKEN = 'auth-token-for-session-910032';

let config;
let serverModule;
let webSocketServer;
let serverUrl;
let originalConsoleLog;
const capturedLogs = [];

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function waitForMessage(socket, expectedType, timeoutMs = 2500) {
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

async function connect() {
  const socket = new WebSocket(serverUrl);
  await once(socket, 'open');
  return socket;
}

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closePromise = once(socket, 'close');
  socket.close();
  await closePromise;
}

async function joinHost(pin, hostToken) {
  const socket = await connect();
  const expectedType = hostToken ? 'lobby_joined' : 'join_rejected';
  const messagePromise = waitForMessage(socket, expectedType);
  socket.send(JSON.stringify({
    type: 'join',
    role: 'host',
    sessionPin: pin,
    data: { nickname: 'AuthorizationHost', hostToken }
  }));
  return { socket, message: await messagePromise };
}

async function fetchState(pin) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [rows] = await connection.execute('SELECT state FROM sessions WHERE pin = ? LIMIT 1', [pin]);
    return rows[0]?.state || null;
  } finally {
    await connection.end();
  }
}

async function fetchLiveTracking(pin) {
  const connection = await mysql.createConnection(config.db);
  try {
    const [rows] = await connection.execute(
      'SELECT live_tracking_enabled, live_tracking_threshold FROM sessions WHERE pin = ? LIMIT 1',
      [pin]
    );
    return rows[0] || null;
  } finally {
    await connection.end();
  }
}

test.before(async () => {
  originalConsoleLog = console.log;
  console.log = (...values) => {
    capturedLogs.push(values.map(String).join(' '));
    originalConsoleLog(...values);
  };
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, TEST_PINS);

  const connection = await mysql.createConnection(config.db);
  await connection.execute('UPDATE sessions SET host_token_hash = ? WHERE pin = ?', [tokenHash(AUTH_TOKEN), AUTH_PIN]);
  await connection.execute('UPDATE sessions SET host_token_hash = ? WHERE pin = ?', [tokenHash(MISSING_PIN_TOKEN), MISSING_PIN]);
  await connection.execute('UPDATE sessions SET host_token_hash = ? WHERE pin = ?', [tokenHash(OTHER_TOKEN), OTHER_PIN]);
  await connection.execute('UPDATE sessions SET host_token_hash = ? WHERE pin = ?', [tokenHash('player-session-host-token'), PLAYER_PIN]);
  await connection.end();

  serverModule = require('../server');
  webSocketServer = await serverModule.startServer({ host: '127.0.0.1', port: 0, allowPortFallback: false });
  serverUrl = `ws://127.0.0.1:${webSocketServer.address().port}`;
});

test.after(async () => {
  if (serverModule) await serverModule.stopServer();
  if (config) await cleanupSessions(config.db, TEST_PINS);
  console.log = originalConsoleLog;
});

test('host join rejects missing and wrong tokens without assigning identity', async () => {
  const missing = await joinHost(MISSING_PIN, null);
  assert.match(missing.message.data.reason, /autorisierung/i);
  const missingServerSocket = Array.from(webSocketServer.clients).find(client => client.readyState === WebSocket.OPEN);
  assert.equal(missingServerSocket?.role, undefined);
  await closeSocket(missing.socket);

  const wrongSocket = await connect();
  const rejectionPromise = waitForMessage(wrongSocket, 'join_rejected');
  wrongSocket.send(JSON.stringify({
    type: 'join',
    role: 'host',
    sessionPin: MISSING_PIN,
    data: { nickname: 'WrongTokenHost', hostToken: 'wrong-token' }
  }));
  const rejection = await rejectionPromise;
  assert.match(rejection.data.reason, /autorisierung/i);
  await closeSocket(wrongSocket);
});

test('host token is scoped to exactly one session', async () => {
  const socket = await connect();
  const rejectionPromise = waitForMessage(socket, 'join_rejected');
  socket.send(JSON.stringify({
    type: 'join',
    role: 'host',
    sessionPin: OTHER_PIN,
    data: { nickname: 'CrossSessionHost', hostToken: AUTH_TOKEN }
  }));
  const rejection = await rejectionPromise;
  assert.match(rejection.data.reason, /autorisierung/i);
  await closeSocket(socket);
});

test('authorized host can join and mutate its session', async () => {
  const { socket, message } = await joinHost(AUTH_PIN, AUTH_TOKEN);
  assert.equal(message.data.sessionPin, AUTH_PIN);

  const startingPromise = waitForMessage(socket, 'quiz_starting');
  socket.send(JSON.stringify({ type: 'host_start_quiz', role: 'host', sessionPin: AUTH_PIN }));
  await startingPromise;
  assert.equal(await fetchState(AUTH_PIN), 'start');

  const startedPromise = waitForMessage(socket, 'quiz_started');
  socket.send(JSON.stringify({ type: 'host_show_first_question', role: 'host', sessionPin: AUTH_PIN }));
  await startedPromise;
  assert.equal(await fetchState(AUTH_PIN), 'question');

  const finishedPromise = waitForMessage(socket, 'quiz_finished');
  socket.send(JSON.stringify({ type: 'host_end_quiz', role: 'host', sessionPin: AUTH_PIN }));
  await finishedPromise;
  assert.match(await fetchState(AUTH_PIN), /^(finished|endresult)$/);
  assert.equal(capturedLogs.join('\n').includes(AUTH_TOKEN), false);
  await closeSocket(socket);
});

test('player cannot forge a host event by changing message role', async () => {
  const socket = await connect();
  const joinedPromise = waitForMessage(socket, 'lobby_joined');
  socket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin: PLAYER_PIN,
    data: { nickname: 'ForgingPlayer', playerToken: 'forging-player-token' }
  }));
  await joinedPromise;

  const rejectionPromise = waitForMessage(socket, 'action_rejected');
  socket.send(JSON.stringify({ type: 'host_start_quiz', role: 'host', sessionPin: PLAYER_PIN }));
  const rejection = await rejectionPromise;
  assert.match(rejection.data.reason, /autorisierung/i);
  assert.equal(await fetchState(PLAYER_PIN), 'lobby');

  const firstQuestionRejection = waitForMessage(socket, 'action_rejected');
  socket.send(JSON.stringify({ type: 'host_show_first_question', role: 'host', sessionPin: PLAYER_PIN }));
  assert.match((await firstQuestionRejection).data.reason, /autorisierung/i);
  assert.equal(await fetchState(PLAYER_PIN), 'lobby');

  const liveTrackingRejection = waitForMessage(socket, 'action_rejected');
  socket.send(JSON.stringify({
    type: 'host_configure_live_tracking',
    role: 'host',
    sessionPin: PLAYER_PIN,
    enabled: true,
    threshold: 10
  }));
  assert.match((await liveTrackingRejection).data.reason, /autorisierung/i);
  const liveTrackingState = await fetchLiveTracking(PLAYER_PIN);
  assert.equal(Number(liveTrackingState.live_tracking_enabled), 0);
  assert.equal(Number(liveTrackingState.live_tracking_threshold), 1);

  const presentationRejection = waitForMessage(socket, 'action_rejected');
  socket.send(JSON.stringify({ type: 'host_select_presentation_view', role: 'host', sessionPin: PLAYER_PIN, view: 'ranking' }));
  assert.match((await presentationRejection).data.reason, /autorisierung/i);
  assert.equal(await fetchState(PLAYER_PIN), 'lobby');
  await closeSocket(socket);
});