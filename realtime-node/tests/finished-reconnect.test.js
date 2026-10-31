const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const MAIN_PIN = '910080';
const LEGACY_PIN = '910081';
const RACE_PIN = '910082';
const NATURAL_PIN = '910083';
const ANSWER_FINISH_PIN = '910084';
const ANSWER_SOLUTION_PIN = '910085';
const ANSWER_MONITOR_PIN = '910086';
const CLOSED_JOIN_PIN = '910087';
const FAILED_MANUAL_PIN = '910088';
const FAILED_NATURAL_PIN = '910089';
const TRANSITION_PIN = '910090';
const FAILED_AUTOMATIC_PIN = '910091';
const FAILED_QUESTION_PIN = '910092';
const ROTATED_HOST_PIN = '910093';
const TEST_PINS = [
  MAIN_PIN, LEGACY_PIN, RACE_PIN, NATURAL_PIN,
  ANSWER_FINISH_PIN, ANSWER_SOLUTION_PIN, ANSWER_MONITOR_PIN,
  CLOSED_JOIN_PIN, FAILED_MANUAL_PIN, FAILED_NATURAL_PIN, TRANSITION_PIN,
  FAILED_AUTOMATIC_PIN, FAILED_QUESTION_PIN, ROTATED_HOST_PIN
];
const HOST_TOKEN = 'finished-reconnect-host';
const TOKENS = {
  alice: 'finished-reconnect-alice',
  bob: 'finished-reconnect-bob',
  charlie: 'finished-reconnect-charlie',
  legacy: 'finished-reconnect-legacy'
};

let config;
let serverProcess;
let serverUrl;
let aliceId;
let reviewId;
let maximumPoints;
let alicePoints;
let lastQuestionIndex;

async function startServer(failure = '', options = {}) {
  const script = `
    const failure = process.env.QUIZZY_TEST_FAILURE;
    if (failure === 'finish-update' || failure === 'question-load') {
      const db = require('./db');
      const originalPool = db.getDbPool;
      let failed = false;
      db.getDbPool = (...args) => {
        const pool = originalPool(...args);
        return new Proxy(pool, {
          get(target, property) {
            if (property === 'getConnection') {
              return async () => {
                const connection = await target.getConnection();
                return new Proxy(connection, {
                  get(conn, name) {
                    if (name === 'execute') {
                      return async (sql, params) => {
                        if (!failed && failure === 'finish-update'
                            && sql.startsWith('UPDATE sessions SET state = ?')
                            && params[params.length - 1] === process.env.QUIZZY_TEST_FAILURE_PIN
                            && ['finished', 'endresult'].includes(params[0])) {
                          failed = true;
                          throw new Error('simulated final state write failure');
                        }
                        if (!failed && failure === 'question-load'
                            && sql.startsWith('SELECT id, quiz_id,')
                            && Number(params[1]) === Number(process.env.QUIZZY_TEST_FAILURE_OFFSET)) {
                          failed = true;
                          throw new Error('simulated next question load failure');
                        }
                        return conn.execute(sql, params);
                      };
                    }
                    const value = Reflect.get(conn, name, conn);
                    return typeof value === 'function' ? value.bind(conn) : value;
                  }
                });
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      };
    }

    const utilsPath = require.resolve('./utils');
    const originalFactory = require(utilsPath);
    if (failure === 'session' || failure === 'results' || process.env.QUIZZY_TEST_OBSERVE_ANSWERS
        || process.env.QUIZZY_TEST_HYDRATE_PIN || process.env.QUIZZY_TEST_TRANSITION_PIN
        || process.env.QUIZZY_TEST_AUTOMATIC_PIN) {
      require.cache[utilsPath].exports = config => {
        const utils = originalFactory(config);
        if (failure === 'session' || failure === 'results') {
          const method = failure === 'results' ? 'loadSessionResults' : 'loadSessionData';
          utils[method] = async () => { throw new Error('simulated database failure'); };
        }
        if (process.env.QUIZZY_TEST_OBSERVE_ANSWERS) {
          const persist = utils.persistCanonicalAnswer;
          utils.persistCanonicalAnswer = (...args) => {
            process.send({ event: 'answer-persisting', pin: args[0] });
            return persist(...args);
          };
        }
        if (process.env.QUIZZY_TEST_HYDRATE_PIN) {
          const hydrate = utils.hydrateSessionQuizMeta;
          const disconnect = utils.handleClientDisconnect;
          let blocked = false;
          let release;
          process.on('message', message => {
            if (message === 'release-hydration' && release) release();
          });
          utils.hydrateSessionQuizMeta = async session => {
            if (!blocked && String(session.pin) === process.env.QUIZZY_TEST_HYDRATE_PIN) {
              blocked = true;
              const gate = new Promise(resolve => { release = resolve; });
              process.send({ event: 'hydration-blocked', pin: session.pin });
              await gate;
            }
            return hydrate(session);
          };
          utils.handleClientDisconnect = async (socket, ...args) => {
            if (!socket.sessionPin) {
              process.send({ event: 'unjoined-client-closed', pin: process.env.QUIZZY_TEST_HYDRATE_PIN });
            }
            return disconnect(socket, ...args);
          };
        }
        if (process.env.QUIZZY_TEST_TRANSITION_PIN) {
          const save = utils.saveSessionPlayer;
          const stats = utils.loadQuestionStats;
          let armed;
          let release;
          process.on('message', message => {
            if (message && message.type === 'arm-transition') {
              armed = message.method;
              process.send({ event: 'transition-armed', pin: process.env.QUIZZY_TEST_TRANSITION_PIN });
            } else if (message === 'release-transition' && release) {
              release();
              release = null;
            }
          });
          const gate = async (method, pin) => {
            if (armed !== method || pin !== process.env.QUIZZY_TEST_TRANSITION_PIN) return;
            armed = null;
            const pending = new Promise(resolve => { release = resolve; });
            process.send({ event: 'transition-blocked', pin });
            await pending;
          };
          utils.saveSessionPlayer = async (...args) => {
            await gate('save', args[0]);
            return save(...args);
          };
          utils.loadQuestionStats = async (...args) => {
            await gate('stats', args[0]);
            return stats(...args);
          };
        }
        if (process.env.QUIZZY_TEST_AUTOMATIC_PIN) {
          const hydrate = utils.hydrateSessionQuizMeta;
          utils.hydrateSessionQuizMeta = async session => {
            await hydrate(session);
            if (String(session.pin) === process.env.QUIZZY_TEST_AUTOMATIC_PIN) {
              session.quiz_automatic_mode = true;
              session.quiz_solution_phase_seconds = 2;
            }
            return session;
          };
        }
        return utils;
      };
    }
    if (process.env.QUIZZY_TEST_OBSERVE_ANSWERS) {
      const quiz = require('./quiz');
      const wait = quiz.waitForPendingAnswers;
      quiz.waitForPendingAnswers = session => {
        process.send({ event: 'monitor-waiting', pin: session.pin });
        return wait(session);
      };
    }
    const server = require('./server');
    server.startServer({ host: '127.0.0.1', port: 0, allowPortFallback: false })
      .then(instance => process.send({ port: instance.address().port }))
      .catch(error => { console.error(error); process.exitCode = 1; process.disconnect(); });
    process.on('message', async message => {
      if (message !== 'stop') return;
      try { await server.stopServer(); }
      catch (error) { console.error(error); process.exitCode = 1; }
      process.disconnect();
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      QUIZZY_TEST_FAILURE: failure,
      QUIZZY_TEST_FAILURE_PIN: options.failurePin || '',
      QUIZZY_TEST_FAILURE_OFFSET: String(options.failureOffset ?? ''),
      QUIZZY_TEST_OBSERVE_ANSWERS: options.observeAnswers ? '1' : '',
      QUIZZY_TEST_HYDRATE_PIN: options.hydrationPin || '',
      QUIZZY_TEST_TRANSITION_PIN: options.transitionPin || '',
      QUIZZY_TEST_AUTOMATIC_PIN: options.automaticPin || ''
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  serverProcess = child;
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  let timeout;
  try {
    const ready = await Promise.race([
      once(child, 'message').then(([message]) => message),
      once(child, 'exit').then(([code]) => { throw new Error(`Test server exited (${code}): ${errors}`); }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Test server did not start: ${errors}`)), 10000);
      })
    ]);
    serverUrl = `ws://127.0.0.1:${ready.port}`;
  } finally {
    clearTimeout(timeout);
  }
}

async function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  if (child.exitCode !== null) {
    assert.equal(child.exitCode, 0, 'test server must exit successfully');
    return;
  }
  const exited = once(child, 'exit');
  child.send('stop');
  const [code] = await exited;
  assert.equal(code, 0, 'test server must stop successfully');
}

async function waitForMessage(messages, type, start = 0, timeoutMs = 4000, matches = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = messages.slice(start).find(entry => entry.type === type && matches(entry));
    if (message) return message;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

function waitForServerEvent(event, pin, timeoutMs = 5000) {
  const child = serverProcess;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error(`Timed out waiting for server event ${event}`));
    }, timeoutMs);
    function onMessage(message) {
      if (message.event !== event || String(message.pin) !== pin) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      resolve(message);
    }
    child.on('message', onMessage);
  });
}

async function connect(role, pin, data, expectedType = 'session_state_sync') {
  const socket = new WebSocket(serverUrl);
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'join', role, sessionPin: pin, data }));
  const message = await waitForMessage(messages, expectedType);
  return { socket, messages, message };
}

async function closeClient(client) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  const closed = once(client.socket, 'close');
  client.socket.close();
  await closed;
}

function assertRanking(ranking, expected) {
  assert.deepEqual(ranking, expected.map(([name, points], index) => ({
    rank: index + 1,
    name,
    points
  })));
}

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, TEST_PINS);

  const connection = await mysql.createConnection(config.db);
  try {
    const tokenHash = crypto.createHash('sha256').update(HOST_TOKEN).digest('hex');
    const placeholders = TEST_PINS.map(() => '?').join(', ');
    await connection.execute(`UPDATE sessions SET host_token_hash = ? WHERE pin IN (${placeholders})`, [tokenHash, ...TEST_PINS]);
    const [[question]] = await connection.execute(`
      SELECT question.id, question.points_max
      FROM sessions session
      INNER JOIN questions question ON question.quiz_id = session.quiz_id
      WHERE session.pin = ? AND question.question_type = 'short_text'
      LIMIT 1
    `, [MAIN_PIN]);
    assert.ok(question, 'workflow test quiz must contain a short-text question');
    maximumPoints = Number(question.points_max);
    assert.ok(maximumPoints > 1);
    alicePoints = maximumPoints - 1;

    const [alice] = await connection.execute(
      'INSERT INTO session_players (session_pin, player_token, nickname, points, answered) VALUES (?, ?, ?, ?, 1)',
      [MAIN_PIN, TOKENS.alice, 'Alice', alicePoints]
    );
    aliceId = Number(alice.insertId);
    const [bob] = await connection.execute(
      'INSERT INTO session_players (session_pin, player_token, nickname, points, answered) VALUES (?, ?, ?, 0, 1)',
      [MAIN_PIN, TOKENS.bob, 'Bob']
    );
    await connection.execute(
      'INSERT INTO session_players (session_pin, player_token, nickname, points, answered) VALUES (?, ?, ?, 0, 0)',
      [MAIN_PIN, TOKENS.charlie, 'Charlie']
    );
    for (const [token, points] of [[TOKENS.alice, alicePoints], [TOKENS.bob, 0]]) {
      await connection.execute(`
        INSERT INTO session_answers (
          session_pin, player_token, question_id, answer_payload, answer_time_ms, is_correct, points_awarded
        ) VALUES (?, ?, ?, ?, 1000, 0, ?)
      `, [MAIN_PIN, token, question.id, JSON.stringify({ answerText: 'Testantwort' }), points]);
    }
    await connection.execute(`
      INSERT INTO session_results (session_pin, player_id, nickname, points, correct_answers, answered_questions)
      VALUES (?, ?, ?, ?, 0, 1), (?, ?, ?, 0, 0, 1)
    `, [MAIN_PIN, aliceId, 'Alice', alicePoints, MAIN_PIN, bob.insertId, 'Bob']);
    const [review] = await connection.execute(`
      INSERT INTO short_text_reviews (session_pin, player_id, nickname, question_id, answer_text, player_token)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [MAIN_PIN, bob.insertId, 'Bob', question.id, 'Testantwort', TOKENS.bob]);
    reviewId = Number(review.insertId);

    await connection.execute("UPDATE sessions SET state = 'finished' WHERE pin = ?", [LEGACY_PIN]);
    await connection.execute(
      'INSERT INTO session_players (session_pin, player_token, nickname, points) VALUES (?, ?, ?, ?)',
      [LEGACY_PIN, TOKENS.legacy, 'Legacy', 5]
    );
    const [[lastQuestion]] = await connection.execute(`
      SELECT question.id, (
        SELECT COUNT(*) - 1 FROM questions counted WHERE counted.quiz_id = session.quiz_id
      ) AS last_index
      FROM sessions session
      INNER JOIN questions question ON question.quiz_id = session.quiz_id
      WHERE session.pin = ?
      ORDER BY question.position DESC, question.id DESC
      LIMIT 1
    `, [NATURAL_PIN]);
    lastQuestionIndex = Number(lastQuestion.last_index);
    await connection.execute(
      "UPDATE sessions SET state = 'solution', current_question_index = ? WHERE pin = ?",
      [lastQuestion.last_index, NATURAL_PIN]
    );
    const [naturalPlayer] = await connection.execute(
      'INSERT INTO session_players (session_pin, player_token, nickname, points, answered) VALUES (?, ?, ?, ?, 1)',
      [NATURAL_PIN, 'finished-reconnect-natural', 'Natural', 42]
    );
    await connection.execute(`
      INSERT INTO session_answers (
        session_pin, player_token, question_id, answer_payload, answer_time_ms, is_correct, points_awarded
      ) VALUES (?, ?, ?, ?, 1000, 0, 42)
    `, [NATURAL_PIN, 'finished-reconnect-natural', lastQuestion.id, JSON.stringify({ answerText: 'Test' })]);
    await connection.execute(`
      INSERT INTO session_results (session_pin, player_id, nickname, points, correct_answers, answered_questions)
      VALUES (?, ?, ?, 42, 0, 1)
    `, [NATURAL_PIN, naturalPlayer.insertId, 'Natural']);
    for (const [pin, token, name] of [
      [FAILED_NATURAL_PIN, 'failed-natural-player', 'Natural retry'],
      [FAILED_AUTOMATIC_PIN, 'failed-automatic-player', 'Automatic retry'],
      [FAILED_QUESTION_PIN, 'failed-question-player', 'Question retry']
    ]) {
      await connection.execute(
        "UPDATE sessions SET state = 'solution', current_question_index = ? WHERE pin = ?",
        [lastQuestion.last_index, pin]
      );
      await connection.execute(
        'INSERT INTO session_players (session_pin, player_token, nickname, points) VALUES (?, ?, ?, ?)',
        [pin, token, name, 42]
      );
    }
  } finally {
    await connection.end();
  }

});

test.after(async () => {
  await stopServer();
  if (config) await cleanupSessions(config.db, TEST_PINS);
});

test('finished standings restore for all roles across reconnect, review and server restart', async () => {
  await startServer();
  let host = await connect('host', MAIN_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }, 'lobby_joined');
  let alice = await connect('player', MAIN_PIN, { nickname: 'Alice', playerToken: TOKENS.alice }, 'lobby_joined');
  let display = await connect('display', MAIN_PIN, { nickname: 'Display' }, 'lobby_joined');

  const departed = await connect('player', MAIN_PIN, {
    nickname: 'Left before start', playerToken: 'finished-reconnect-departed'
  }, 'lobby_joined');
  const departureMessagesStart = host.messages.length;
  await closeClient(departed);
  await waitForMessage(host.messages, 'lobby_update', departureMessagesStart, 4000, message => message.data.playerCount === 3);

  const hostFinish = waitForMessage(host.messages, 'quiz_finished');
  const aliceFinish = waitForMessage(alice.messages, 'quiz_finished');
  const displayFinish = waitForMessage(display.messages, 'quiz_finished');
  host.socket.send(JSON.stringify({ type: 'host_end_quiz', role: 'host', sessionPin: MAIN_PIN }));
  const initial = await Promise.all([hostFinish, aliceFinish, displayFinish]);
  assertRanking(initial[1].data.ranking, [['Alice', alicePoints], ['Bob', 0], ['Charlie', 0]]);
  assert.deepEqual(initial[1].data.ownPlacement, { rank: 1, total: 3 });
  assert.equal(Object.hasOwn(initial[0].data, 'ownPlacement'), false);
  assert.equal(Object.hasOwn(initial[2].data, 'ownPlacement'), false);

  await Promise.all([host, alice, display].map(closeClient));
  [host, alice, display] = await Promise.all([
    connect('host', MAIN_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }),
    connect('player', MAIN_PIN, { nickname: 'Changed name', playerToken: TOKENS.alice }),
    connect('display', MAIN_PIN, { nickname: 'Display' })
  ]);
  for (const client of [host, alice, display]) {
    assert.match(client.message.data.state, /^(finished|endresult)$/);
    assert.equal(client.message.data.question, null);
    assertRanking(client.message.data.ranking, [['Alice', alicePoints], ['Bob', 0], ['Charlie', 0]]);
  }
  assert.deepEqual(alice.message.data.ownPlacement, { rank: 1, total: 3 });
  assert.equal(Object.hasOwn(host.message.data, 'ownPlacement'), false);
  assert.equal(Object.hasOwn(display.message.data, 'ownPlacement'), false);
  assert.equal(JSON.stringify(alice.message.data).includes(TOKENS.bob), false);
  assert.equal(JSON.stringify(display.message.data).includes(TOKENS.alice), false);

  const pending = await waitForMessage(host.messages, 'review_queue_updated');
  assert.ok(pending.data.reviews.some(review => Number(review.id) === reviewId));
  for (const playerToken of ['', 'not-a-player-token']) {
    const rejected = await connect('player', MAIN_PIN, { nickname: 'Alice', playerToken }, 'join_rejected');
    assert.match(rejected.message.data.reason, /geschlossen/i);
    await closeClient(rejected);
  }
  const rejectedHost = await connect('host', MAIN_PIN, { nickname: 'Host', hostToken: 'wrong' }, 'join_rejected');
  assert.match(rejectedHost.message.data.reason, /autorisierung/i);
  await closeClient(rejectedHost);
  assert.equal(alice.socket.readyState, WebSocket.OPEN);
  assert.equal(alice.message.data.playerCount, 3);

  const playerId = alice.message.data.playerList.find(player => player.name === 'Alice').id;
  const rejectedKick = waitForMessage(host.messages, 'action_rejected');
  host.socket.send(JSON.stringify({
    type: 'host_kick_player', role: 'host', sessionPin: MAIN_PIN, playerId
  }));
  assert.match((await rejectedKick).data.reason, /nach Quizende/i);

  const aliceUpdate = waitForMessage(alice.messages, 'ranking_updated');
  const displayUpdate = waitForMessage(display.messages, 'ranking_updated');
  host.socket.send(JSON.stringify({
    type: 'review_short_text_answer', role: 'host', sessionPin: MAIN_PIN,
    reviewId, points: maximumPoints, comment: 'Nach Quizende bewertet'
  }));
  const [updatedAlice, updatedDisplay] = await Promise.all([aliceUpdate, displayUpdate]);
  assertRanking(updatedAlice.data.ranking, [['Bob', maximumPoints], ['Alice', alicePoints], ['Charlie', 0]]);
  assert.deepEqual(updatedAlice.data.ownPlacement, { rank: 2, total: 3 });
  assert.equal(Object.hasOwn(updatedDisplay.data, 'ownPlacement'), false);

  let bob = await connect('player', MAIN_PIN, { nickname: 'Not Bob', playerToken: TOKENS.bob });
  assert.deepEqual(bob.message.data.ownPlacement, { rank: 1, total: 3 });
  assertRanking(bob.message.data.ranking, [['Bob', maximumPoints], ['Alice', alicePoints], ['Charlie', 0]]);

  await stopServer();
  await startServer();
  [host, alice, bob, display] = await Promise.all([
    connect('host', MAIN_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }),
    connect('player', MAIN_PIN, { nickname: 'Alice', playerToken: TOKENS.alice }),
    connect('player', MAIN_PIN, { nickname: 'Bob', playerToken: TOKENS.bob }),
    connect('display', MAIN_PIN, { nickname: 'Display' })
  ]);
  const charlie = await connect('player', MAIN_PIN, { nickname: 'Charlie', playerToken: TOKENS.charlie });
  for (const client of [host, alice, bob, charlie, display]) {
    assertRanking(client.message.data.ranking, [['Bob', maximumPoints], ['Alice', alicePoints], ['Charlie', 0]]);
  }
  assert.deepEqual(alice.message.data.ownPlacement, { rank: 2, total: 3 });
  assert.deepEqual(bob.message.data.ownPlacement, { rank: 1, total: 3 });
  assert.deepEqual(charlie.message.data.ownPlacement, { rank: 3, total: 3 });
  const restoredQueue = await waitForMessage(host.messages, 'review_queue_updated');
  assert.equal(restoredQueue.data.reviews.some(review => Number(review.id) === reviewId), false);

  const connection = await mysql.createConnection(config.db);
  try {
    const [players] = await connection.execute(
      'SELECT player_token, nickname, points FROM session_players WHERE session_pin = ? ORDER BY id',
      [MAIN_PIN]
    );
    assert.deepEqual(players.map(player => [player.player_token, player.nickname, Number(player.points)]), [
      [TOKENS.alice, 'Alice', alicePoints],
      [TOKENS.bob, 'Bob', maximumPoints],
      [TOKENS.charlie, 'Charlie', 0]
    ]);
  } finally {
    await connection.end();
  }
  await Promise.all([host, alice, bob, charlie, display].map(closeClient));
});

test('legacy finished sessions restore known participants but reject new ones', async () => {
  const rejected = await connect('player', LEGACY_PIN, {
    nickname: 'Legacy', playerToken: 'wrong-token'
  }, 'join_rejected');
  assert.match(rejected.message.data.reason, /geschlossen/i);
  await closeClient(rejected);

  const [host, player, display] = await Promise.all([
    connect('host', LEGACY_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }),
    connect('player', LEGACY_PIN, { nickname: 'Legacy', playerToken: TOKENS.legacy }),
    connect('display', LEGACY_PIN, { nickname: 'Display' })
  ]);
  for (const client of [host, player, display]) {
    assert.equal(client.message.data.state, 'finished');
    assertRanking(client.message.data.ranking, [['Legacy', 5]]);
  }
  assert.deepEqual(player.message.data.ownPlacement, { rank: 1, total: 1 });
  await Promise.all([host, player, display].map(closeClient));
});

test('finished host reconnect uses a rotated host token from the database', async () => {
  await stopServer();
  await startServer();
  const firstHost = await connect('host', ROTATED_HOST_PIN, {
    nickname: 'Host', hostToken: HOST_TOKEN
  }, 'lobby_joined');
  const finished = waitForMessage(firstHost.messages, 'quiz_finished');
  firstHost.socket.send(JSON.stringify({
    type: 'host_end_quiz', role: 'host', sessionPin: ROTATED_HOST_PIN
  }));
  await finished;
  await closeClient(firstHost);

  const newToken = 'finished-reconnect-rotated-host';
  const connection = await mysql.createConnection(config.db);
  try {
    const newHash = crypto.createHash('sha256').update(newToken).digest('hex');
    await connection.execute('UPDATE sessions SET host_token_hash = ? WHERE pin = ?', [newHash, ROTATED_HOST_PIN]);
  } finally {
    await connection.end();
  }

  const host = await connect('host', ROTATED_HOST_PIN, { nickname: 'New host', hostToken: newToken });
  assert.match(host.message.data.state, /^(finished|endresult)$/);
  const rejected = await connect('host', ROTATED_HOST_PIN, {
    nickname: 'Old host', hostToken: HOST_TOKEN
  }, 'join_rejected');
  assert.match(rejected.message.data.reason, /autorisierung/i);
  await Promise.all([host, rejected].map(closeClient));
});

test('a reconnect cannot overtake a pending lobby removal', async () => {
  const host = await connect('host', RACE_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }, 'lobby_joined');
  const token = 'finished-reconnect-race';
  const first = await connect('player', RACE_PIN, { nickname: 'Returnee', playerToken: token }, 'lobby_joined');
  const lock = await mysql.createConnection(config.db);
  let locked = false;
  let returningPromise;
  let returning;
  try {
    await lock.beginTransaction();
    locked = true;
    const [rows] = await lock.execute(
      'SELECT id FROM session_players WHERE session_pin = ? AND player_token = ? FOR UPDATE',
      [RACE_PIN, token]
    );
    assert.equal(rows.length, 1);

    const departureMessagesStart = host.messages.length;
    await closeClient(first);
    await waitForMessage(host.messages, 'lobby_update', departureMessagesStart, 4000, message => message.data.playerCount === 0);

    let returned = false;
    returningPromise = connect('player', RACE_PIN, { nickname: 'Returnee', playerToken: token }, 'lobby_joined')
      .then(client => { returned = true; return client; });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(returned, false, 'reconnect must wait until the earlier removal is complete');

    await lock.commit();
    locked = false;
    returning = await returningPromise;
    const [savedPlayers] = await lock.execute(
      'SELECT nickname FROM session_players WHERE session_pin = ? AND player_token = ?',
      [RACE_PIN, token]
    );
    assert.deepEqual(savedPlayers.map(player => player.nickname), ['Returnee']);

    const finished = waitForMessage(returning.messages, 'quiz_finished');
    host.socket.send(JSON.stringify({ type: 'host_end_quiz', role: 'host', sessionPin: RACE_PIN }));
    assertRanking((await finished).data.ranking, [['Returnee', 0]]);
  } finally {
    if (locked) await lock.rollback();
    await lock.end();
  }

  await stopServer();
  await startServer();
  const restored = await connect('player', RACE_PIN, { nickname: 'Returnee', playerToken: token });
  assertRanking(restored.message.data.ranking, [['Returnee', 0]]);
  assert.deepEqual(restored.message.data.ownPlacement, { rank: 1, total: 1 });
  await closeClient(restored);
});

test('natural completion restores the last ranking after a server restart', async () => {
  const [host, player] = await Promise.all([
    connect('host', NATURAL_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }),
    connect('player', NATURAL_PIN, { nickname: 'Natural', playerToken: 'finished-reconnect-natural' })
  ]);
  assert.equal(player.message.data.state, 'solution');
  const finished = waitForMessage(player.messages, 'quiz_finished');
  host.socket.send(JSON.stringify({ type: 'host_next_question', role: 'host', sessionPin: NATURAL_PIN }));
  assertRanking((await finished).data.ranking, [['Natural', 42]]);

  await stopServer();
  await startServer();
  const [restoredHost, restoredPlayer, restoredDisplay] = await Promise.all([
    connect('host', NATURAL_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }),
    connect('player', NATURAL_PIN, { nickname: 'Natural', playerToken: 'finished-reconnect-natural' }),
    connect('display', NATURAL_PIN, { nickname: 'Display' })
  ]);
  for (const client of [restoredHost, restoredPlayer, restoredDisplay]) {
    assert.match(client.message.data.state, /^(finished|endresult)$/);
    assert.equal(client.message.data.question, null);
    assertRanking(client.message.data.ranking, [['Natural', 42]]);
  }
  assert.deepEqual(restoredPlayer.message.data.ownPlacement, { rank: 1, total: 1 });
  await Promise.all([restoredHost, restoredPlayer, restoredDisplay].map(closeClient));
});

async function enterAnswerPhase(pin) {
  const host = await connect('host', pin, { nickname: 'Host', hostToken: HOST_TOKEN }, 'lobby_joined');
  const token = `finished-answer-${pin}`;
  const player = await connect('player', pin, { nickname: 'Finisher', playerToken: token }, 'lobby_joined');
  const late = await connect('player', pin, { nickname: 'Too late', playerToken: `late-${pin}` }, 'lobby_joined');
  let question;
  for (const [type, response] of [
    ['host_start_quiz', 'quiz_starting'],
    ['host_show_first_question', 'quiz_started'],
    ['host_show_answer_options', 'answer_options_shown'],
    ['host_start_answer_phase', 'answer_phase_started']
  ]) {
    const start = host.messages.length;
    host.socket.send(JSON.stringify({ type, role: 'host', sessionPin: pin }));
    const message = await waitForMessage(host.messages, response, start);
    if (response === 'quiz_started') question = message.data.question;
  }
  assert.ok(['single_choice', 'true_false'].includes(question.type), 'first test question must have one correct option');
  const connection = await mysql.createConnection(config.db);
  try {
    const [[row]] = await connection.execute(
      'SELECT correct_option_index FROM questions WHERE id = ?', [question.id]
    );
    return { host, player, late, token, answerIndex: Number(row.correct_option_index) };
  } finally {
    await connection.end();
  }
}

test('accepted answers finish before solution, manual end, or dashboard closure', async () => {
  await stopServer();
  await startServer('', { observeAnswers: true });
  const completed = [];

  for (const { pin, transition, event } of [
    { pin: ANSWER_FINISH_PIN, transition: 'host_end_quiz', event: 'quiz_finished' },
    { pin: ANSWER_SOLUTION_PIN, transition: 'host_end_answer_phase', event: 'show_solution' },
    { pin: ANSWER_MONITOR_PIN, transition: 'dashboard', event: 'quiz_finished' }
  ]) {
    const { host, player, late, token, answerIndex } = await enterAnswerPhase(pin);
    const lock = await mysql.createConnection(config.db);
    let locked = false;
    let returning;
    try {
      await lock.beginTransaction();
      locked = true;
      const [rows] = await lock.execute(
        'SELECT id FROM session_players WHERE session_pin = ? AND player_token = ? FOR UPDATE',
        [pin, token]
      );
      assert.equal(rows.length, 1);

      const persisting = waitForServerEvent('answer-persisting', pin);
      player.socket.send(JSON.stringify({
        type: 'player_answer_single', role: 'player', sessionPin: pin, answerIndex
      }));
      await persisting;

      let returned = false;
      const returningPromise = connect('player', pin, { nickname: 'Finisher', playerToken: token })
        .then(client => { returned = true; return client; });
      returningPromise.catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(returned, false, 'reconnect must wait for the in-flight answer');

      const resultStart = host.messages.length;
      const result = waitForMessage(host.messages, event, resultStart);
      if (transition === 'dashboard') {
        const monitoring = waitForServerEvent('monitor-waiting', pin);
        const control = await mysql.createConnection(config.db);
        try {
          await control.execute("UPDATE sessions SET state = 'endresult' WHERE pin = ?", [pin]);
        } finally {
          await control.end();
        }
        await monitoring;
      } else {
        const closingRejected = waitForMessage(host.messages, 'action_rejected', resultStart);
        host.socket.send(JSON.stringify({ type: transition, role: 'host', sessionPin: pin }));
        host.socket.send(JSON.stringify({ type: transition, role: 'host', sessionPin: pin }));
        assert.match((await closingRejected).data.reason, /Phasenwechsel wird noch verarbeitet/);
      }

      const lateStart = late.messages.length;
      late.socket.send(JSON.stringify({
        type: 'player_answer_single', role: 'player', sessionPin: pin, answerIndex
      }));
      assert.match((await waitForMessage(late.messages, 'answer_rejected', lateStart)).data.reason, /abgelaufen/);
      assert.equal(host.messages.slice(resultStart).some(message => message.type === event), false);

      await lock.commit();
      locked = false;
      const [shown] = await Promise.all([result, returningPromise.then(client => { returning = client; })]);
      const points = Number(shown.data.ranking[0].points);
      assert.ok(points > 0, 'the accepted correct answer must contribute points');
      const expected = [['Finisher', points], ['Too late', 0]];
      assertRanking(shown.data.ranking, expected);

      if (transition === 'host_end_answer_phase') {
        const finishedStart = host.messages.length;
        host.socket.send(JSON.stringify({ type: 'host_end_quiz', role: 'host', sessionPin: pin }));
        assertRanking((await waitForMessage(host.messages, 'quiz_finished', finishedStart)).data.ranking, expected);
      }

      const [persisted] = await lock.execute(
        'SELECT nickname, points, answered FROM session_players WHERE session_pin = ? ORDER BY id', [pin]
      );
      assert.deepEqual(persisted.map(row => [row.nickname, Number(row.points), Number(row.answered)]), [
        ['Finisher', points, 1], ['Too late', 0, 0]
      ]);
      const [[answerCount]] = await lock.execute(
        'SELECT COUNT(*) AS count FROM session_answers WHERE session_pin = ?', [pin]
      );
      assert.equal(Number(answerCount.count), 1);
      completed.push({ pin, token, expected });
    } finally {
      if (locked) await lock.rollback();
      await lock.end();
      await Promise.all([host, player, late, returning].filter(Boolean).map(closeClient));
    }
  }

  await stopServer();
  await startServer();
  for (const { pin, token, expected } of completed) {
    const restored = await connect('player', pin, { nickname: 'Finisher', playerToken: token });
    assertRanking(restored.message.data.ranking, expected);
    assert.deepEqual(restored.message.data.ownPlacement, { rank: 1, total: 2 });
    await closeClient(restored);
  }
});

test('ending during an unfinished phase change is rejected until the change completes', async () => {
  await stopServer();
  await startServer('', { transitionPin: TRANSITION_PIN });
  const host = await connect('host', TRANSITION_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }, 'lobby_joined');
  const player = await connect('player', TRANSITION_PIN, {
    nickname: 'Transition', playerToken: 'finished-transition-player'
  }, 'lobby_joined');
  try {
    for (const [type, response] of [
      ['host_start_quiz', 'quiz_starting'],
      ['host_show_first_question', 'quiz_started'],
      ['host_show_answer_options', 'answer_options_shown']
    ]) {
      const start = host.messages.length;
      host.socket.send(JSON.stringify({ type, role: 'host', sessionPin: TRANSITION_PIN }));
      await waitForMessage(host.messages, response, start);
    }

    for (const [method, transition, response] of [
      ['save', 'host_start_answer_phase', 'answer_phase_started'],
      ['stats', 'host_end_answer_phase', 'show_solution']
    ]) {
      const armed = waitForServerEvent('transition-armed', TRANSITION_PIN);
      serverProcess.send({ type: 'arm-transition', method });
      await armed;
      const blocked = waitForServerEvent('transition-blocked', TRANSITION_PIN);
      const start = host.messages.length;
      host.socket.send(JSON.stringify({ type: transition, role: 'host', sessionPin: TRANSITION_PIN }));
      await blocked;

      host.socket.send(JSON.stringify({
        type: 'host_end_quiz', role: 'host', sessionPin: TRANSITION_PIN
      }));
      assert.match((await waitForMessage(host.messages, 'action_rejected', start)).data.reason, /Phasenwechsel/);
      assert.equal(host.messages.slice(start).some(message => message.type === 'quiz_finished'), false);

      serverProcess.send('release-transition');
      await waitForMessage(host.messages, response, start);
    }

    const finishedStart = host.messages.length;
    host.socket.send(JSON.stringify({ type: 'host_end_quiz', role: 'host', sessionPin: TRANSITION_PIN }));
    assertRanking((await waitForMessage(host.messages, 'quiz_finished', finishedStart)).data.ranking, [['Transition', 0]]);
    await new Promise(resolve => setTimeout(resolve, 100));
    const afterFinish = host.messages.slice(host.messages.findIndex(message => message.type === 'quiz_finished') + 1);
    assert.equal(afterFinish.some(message => ['answer_phase_started', 'show_solution'].includes(message.type)), false);
  } finally {
    if (serverProcess?.connected) serverProcess.send('release-transition');
    await Promise.all([host, player].map(closeClient));
  }

  await stopServer();
  await startServer();
  const restored = await connect('player', TRANSITION_PIN, {
    nickname: 'Transition', playerToken: 'finished-transition-player'
  });
  assertRanking(restored.message.data.ranking, [['Transition', 0]]);
  await closeClient(restored);
});

test('a socket closed during asynchronous join does not create a ghost player', async () => {
  await stopServer();
  await startServer('', { hydrationPin: CLOSED_JOIN_PIN });
  const socket = new WebSocket(serverUrl);
  await once(socket, 'open');
  const hydration = waitForServerEvent('hydration-blocked', CLOSED_JOIN_PIN);
  socket.send(JSON.stringify({
    type: 'join', role: 'player', sessionPin: CLOSED_JOIN_PIN,
    data: { nickname: 'Disconnected', playerToken: 'disconnected-before-join' }
  }));
  await hydration;
  const serverClosed = waitForServerEvent('unjoined-client-closed', CLOSED_JOIN_PIN);
  const closed = once(socket, 'close');
  socket.close();
  await Promise.all([closed, serverClosed]);
  serverProcess.send('release-hydration');

  const host = await connect('host', CLOSED_JOIN_PIN, { nickname: 'Host', hostToken: HOST_TOKEN }, 'lobby_joined');
  assert.equal(host.message.data.playerCount, 0);
  const connection = await mysql.createConnection(config.db);
  try {
    const [[row]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM session_players WHERE session_pin = ?', [CLOSED_JOIN_PIN]
    );
    assert.equal(Number(row.count), 0);
  } finally {
    await connection.end();
    await closeClient(host);
  }
});

test('failed final state writes and question loads are reported and completion can be retried', async () => {
  for (const { pin, transition, initialState, token, name, points, failure = 'finish-update' } of [
    {
      pin: FAILED_MANUAL_PIN, transition: 'host_end_quiz', initialState: 'lobby',
      token: 'failed-manual-player', name: 'Manual retry', points: 0
    },
    {
      pin: FAILED_NATURAL_PIN, transition: 'host_next_question', initialState: 'solution',
      token: 'failed-natural-player', name: 'Natural retry', points: 42
    },
    {
      pin: FAILED_QUESTION_PIN, transition: 'host_next_question', initialState: 'solution',
      token: 'failed-question-player', name: 'Question retry', points: 42, failure: 'question-load'
    }
  ]) {
    await stopServer();
    await startServer(failure, { failurePin: pin, failureOffset: lastQuestionIndex + 1 });
    const joinType = initialState === 'lobby' ? 'lobby_joined' : 'session_state_sync';
    const host = await connect('host', pin, { nickname: 'Host', hostToken: HOST_TOKEN }, joinType);
    const player = await connect('player', pin, { nickname: name, playerToken: token }, joinType);
    const initialQuestion = player.message.data.question;
    const connection = await mysql.createConnection(config.db);
    try {
      const [[before]] = await connection.execute(
        'SELECT state, current_question_index FROM sessions WHERE pin = ?', [pin]
      );
      const start = host.messages.length;
      host.socket.send(JSON.stringify({ type: transition, role: 'host', sessionPin: pin }));
      assert.match((await waitForMessage(host.messages, 'action_rejected', start)).data.reason, /nicht abgeschlossen/);
      assert.equal(host.messages.slice(start).some(message => message.type === 'quiz_finished'), false);
      const [[after]] = await connection.execute(
        'SELECT state, current_question_index FROM sessions WHERE pin = ?', [pin]
      );
      assert.equal(after.state, initialState);
      assert.equal(Number(after.current_question_index), Number(before.current_question_index));

      if (initialState === 'solution') {
        const display = await connect('display', pin, { nickname: 'Display' });
        assert.equal(display.message.data.state, 'solution');
        assert.equal(display.message.data.question.id, initialQuestion.id);
        await closeClient(display);
      }

      const retryStart = host.messages.length;
      host.socket.send(JSON.stringify({ type: transition, role: 'host', sessionPin: pin }));
      assertRanking((await waitForMessage(host.messages, 'quiz_finished', retryStart)).data.ranking, [[name, points]]);
    } finally {
      await connection.end();
      await Promise.all([host, player].map(closeClient));
    }

    await stopServer();
    await startServer();
    const restored = await connect('player', pin, { nickname: name, playerToken: token });
    assertRanking(restored.message.data.ranking, [[name, points]]);
    assert.deepEqual(restored.message.data.ownPlacement, { rank: 1, total: 1 });
    await closeClient(restored);
  }
});

test('automatic completion failures are shown to the host and can be retried', async () => {
  await stopServer();
  await startServer('finish-update', {
    failurePin: FAILED_AUTOMATIC_PIN,
    automaticPin: FAILED_AUTOMATIC_PIN
  });
  const host = await connect('host', FAILED_AUTOMATIC_PIN, { nickname: 'Host', hostToken: HOST_TOKEN });
  const player = await connect('player', FAILED_AUTOMATIC_PIN, {
    nickname: 'Automatic retry', playerToken: 'failed-automatic-player'
  });
  try {
    assert.match((await waitForMessage(host.messages, 'action_rejected', 0, 6000)).data.reason, /automatische Phasenwechsel/);
    assert.equal(host.messages.some(message => message.type === 'quiz_finished'), false);

    const connection = await mysql.createConnection(config.db);
    try {
      const [[row]] = await connection.execute(
        'SELECT state, current_question_index FROM sessions WHERE pin = ?', [FAILED_AUTOMATIC_PIN]
      );
      assert.equal(row.state, 'solution');
      assert.equal(Number(row.current_question_index), lastQuestionIndex);
    } finally {
      await connection.end();
    }

    const start = host.messages.length;
    host.socket.send(JSON.stringify({
      type: 'host_next_question', role: 'host', sessionPin: FAILED_AUTOMATIC_PIN
    }));
    assertRanking((await waitForMessage(host.messages, 'quiz_finished', start)).data.ranking, [['Automatic retry', 42]]);
  } finally {
    await Promise.all([host, player].map(closeClient));
  }

  await stopServer();
  await startServer();
  const restored = await connect('player', FAILED_AUTOMATIC_PIN, {
    nickname: 'Automatic retry', playerToken: 'failed-automatic-player'
  });
  assertRanking(restored.message.data.ranking, [['Automatic retry', 42]]);
  await closeClient(restored);
});

test('session and result loading failures are reported to reconnecting clients', async () => {
  for (const failure of ['session', 'results']) {
    await stopServer();
    await startServer(failure);
    const rejected = await connect('player', LEGACY_PIN, {
      nickname: 'Legacy', playerToken: TOKENS.legacy
    }, 'join_rejected');
    assert.match(rejected.message.data.reason, /Spielstand konnte nicht geladen werden/i);
    assert.equal(rejected.message.data.reason.includes('simulated database failure'), false);
    await closeClient(rejected);
  }
});
