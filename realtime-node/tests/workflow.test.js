const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const { once } = require('node:events');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const { calculateDynamicPoints } = require('../quiz');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PINS = ['910001', '910002'];
const WORKFLOW_HOST_TOKEN = 'workflow-host-token-910002';
let serverModule = null;
let config = null;
let serverUrl = null;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, TEST_PINS);

  const connection = await mysql.createConnection(config.db);
  await connection.execute(
    'UPDATE sessions SET host_token_hash = ? WHERE pin = ?',
    [crypto.createHash('sha256').update(WORKFLOW_HOST_TOKEN).digest('hex'), TEST_PINS[1]]
  );
  await connection.end();

  serverModule = require('../server');
  const server = await serverModule.startServer({
    host: '127.0.0.1',
    port: 0,
    allowPortFallback: false
  });
  const address = server.address();
  serverUrl = `ws://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (serverModule) await serverModule.stopServer();
  if (config) await cleanupSessions(config.db, TEST_PINS);
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForMessage(messages, expectedType, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = messages.find(message => message && message.type === expectedType);
    if (found) {
      return found;
    }
    await wait(50);
  }
  return null;
}

async function fetchSessionRecord(dbConfig, pin) {
  const connection = await mysql.createConnection({
    ...dbConfig,
    charset: dbConfig.charset || 'utf8mb4'
  });

  try {
    const [rows] = await connection.execute('SELECT pin, state, current_question_index FROM sessions WHERE pin = ?', [pin]);
    return rows[0] || null;
  } finally {
    await connection.end();
  }
}

async function fetchSessionResults(dbConfig, pin) {
  const connection = await mysql.createConnection({
    ...dbConfig,
    charset: dbConfig.charset || 'utf8mb4'
  });

  try {
    const [rows] = await connection.execute(
      'SELECT session_pin, player_id, nickname, points, correct_answers, answered_questions FROM session_results WHERE session_pin = ? ORDER BY points DESC, updated_at DESC',
      [pin]
    );
    return rows;
  } finally {
    await connection.end();
  }
}

async function restartAndJoinAllRoles(sessionPin) {
  await serverModule.stopServer();
  const restartedServer = await serverModule.startServer({
    host: '127.0.0.1',
    port: 0,
    allowPortFallback: false
  });
  serverUrl = `ws://127.0.0.1:${restartedServer.address().port}`;

  const hostSocket = new WebSocket(serverUrl);
  const playerSocket = new WebSocket(serverUrl);
  const displaySocket = new WebSocket(serverUrl);
  const hostMessages = [];
  const playerMessages = [];
  const displayMessages = [];
  hostSocket.on('message', data => hostMessages.push(JSON.parse(data.toString())));
  playerSocket.on('message', data => playerMessages.push(JSON.parse(data.toString())));
  displaySocket.on('message', data => displayMessages.push(JSON.parse(data.toString())));
  await Promise.all([once(hostSocket, 'open'), once(playerSocket, 'open'), once(displaySocket, 'open')]);

  hostSocket.send(JSON.stringify({
    type: 'join', role: 'host', sessionPin,
    data: { nickname: 'Host', hostToken: WORKFLOW_HOST_TOKEN }
  }));
  playerSocket.send(JSON.stringify({
    type: 'join', role: 'player', sessionPin,
    data: { nickname: 'Alice', playerToken: 'workflow-alice' }
  }));
  displaySocket.send(JSON.stringify({
    type: 'join', role: 'display', sessionPin,
    data: { nickname: 'Display' }
  }));

  const syncMessages = await Promise.all([
    waitForMessage(hostMessages, 'session_state_sync'),
    waitForMessage(playerMessages, 'session_state_sync'),
    waitForMessage(displayMessages, 'session_state_sync')
  ]);
  return {
    hostSocket, playerSocket, displaySocket,
    hostMessages, playerMessages, displayMessages, syncMessages
  };
}

test('dynamic scoring decreases over the configured time window', () => {
  const question = {
    time_limit: 20,
    points_max: 100,
    points_min: 40,
    points_delay: 5,
    points_decay_time: 10
  };

  assert.equal(calculateDynamicPoints(question, 0), 100);
  assert.equal(calculateDynamicPoints(question, 5), 100);
  assert.equal(calculateDynamicPoints(question, 10), 70);
  assert.equal(calculateDynamicPoints(question, 15), 40);
  assert.equal(calculateDynamicPoints(question, 30), 40);
});

test('join uses an existing persisted session record', async () => {
  const socket = new WebSocket(serverUrl);
  await once(socket, 'open');

  socket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin: TEST_PINS[0],
    data: {
      nickname: 'PersistedPlayer',
      playerToken: 'workflow-persisted-player'
    }
  }));

  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  const joined = await waitForMessage(messages, 'lobby_joined');
  const sessionRecord = await fetchSessionRecord(config.db, TEST_PINS[0]);

  assert.ok(joined, 'player should receive lobby_joined for a persisted session');
  assert.ok(sessionRecord, 'persisted session should remain available after join');
  assert.equal(sessionRecord.state, 'lobby');

  socket.close();
});

test('full quiz workflow works from join to finish', async () => {
  const sessionPin = TEST_PINS[1];
  let hostSocket = new WebSocket(serverUrl);
  let playerSocket = new WebSocket(serverUrl);
  const nonRespondingSocket = new WebSocket(serverUrl);
  let displaySocket = null;

  let hostMessages = [];
  let playerMessages = [];
  const nonRespondingMessages = [];
  let displayMessages = [];

  hostSocket.on('message', (data) => {
    try {
      hostMessages.push(JSON.parse(data.toString()));
    } catch (error) {
      console.error('Host message parse error', error.message);
    }
  });

  playerSocket.on('message', (data) => {
    try {
      playerMessages.push(JSON.parse(data.toString()));
    } catch (error) {
      console.error('Player message parse error', error.message);
    }
  });

  nonRespondingSocket.on('message', data => nonRespondingMessages.push(JSON.parse(data.toString())));
  await Promise.all([
    once(hostSocket, 'open'),
    once(playerSocket, 'open'),
    once(nonRespondingSocket, 'open')
  ]);

  hostSocket.send(JSON.stringify({
    type: 'join',
    role: 'host',
    sessionPin,
    data: { nickname: 'Host', hostToken: WORKFLOW_HOST_TOKEN }
  }));

  playerSocket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin,
    data: {
      nickname: 'Alice',
      playerToken: 'workflow-alice'
    }
  }));

  nonRespondingSocket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin,
    data: { nickname: 'Bob ohne Antwort', playerToken: 'workflow-bob' }
  }));
  assert.ok(await waitForMessage(nonRespondingMessages, 'lobby_joined'));

  const lobbyUpdate = await waitForMessage(playerMessages, 'lobby_update');
  assert.ok(lobbyUpdate, 'player should receive lobby_update');

  const liveTrackingConfigured = waitForMessage(hostMessages, 'live_answer_stats');
  hostSocket.send(JSON.stringify({
    type: 'host_configure_live_tracking',
    role: 'host',
    sessionPin,
    enabled: true,
    threshold: 10
  }));
  const configuredStats = await liveTrackingConfigured;
  assert.equal(configuredStats.data.enabled, true);
  assert.equal(configuredStats.data.threshold, 10);

  hostSocket.send(JSON.stringify({
    type: 'host_start_quiz',
    role: 'host',
    sessionPin,
    nickname: 'Host'
  }));

  const quizStarting = await waitForMessage(hostMessages, 'quiz_starting');
  assert.ok(quizStarting, 'host should receive quiz_starting');

  let sessionState = await fetchSessionRecord(config.db, sessionPin);
  assert.equal(sessionState.state, 'start', 'session state should switch to start before the first question');
  assert.equal(Number(sessionState.current_question_index), 0, 'start state should reset the question index');

  playerSocket.send(JSON.stringify({
    type: 'player_answer_single',
    role: 'player',
    sessionPin,
    answerIndex: 0
  }));
  hostSocket.send(JSON.stringify({
    type: 'host_show_answer_options',
    role: 'host',
    sessionPin
  }));
  await wait(200);
  sessionState = await fetchSessionRecord(config.db, sessionPin);
  assert.equal(sessionState.state, 'start', 'answers and later phase events must not skip the start state');

  await serverModule.stopServer();
  const restartedServer = await serverModule.startServer({
    host: '127.0.0.1',
    port: 0,
    allowPortFallback: false
  });
  serverUrl = `ws://127.0.0.1:${restartedServer.address().port}`;

  hostSocket = new WebSocket(serverUrl);
  playerSocket = new WebSocket(serverUrl);
  displaySocket = new WebSocket(serverUrl);
  hostMessages = [];
  playerMessages = [];
  displayMessages = [];
  hostSocket.on('message', data => hostMessages.push(JSON.parse(data.toString())));
  playerSocket.on('message', data => playerMessages.push(JSON.parse(data.toString())));
  displaySocket.on('message', data => displayMessages.push(JSON.parse(data.toString())));
  await Promise.all([once(hostSocket, 'open'), once(playerSocket, 'open'), once(displaySocket, 'open')]);

  hostSocket.send(JSON.stringify({
    type: 'join',
    role: 'host',
    sessionPin,
    data: { nickname: 'Host', hostToken: WORKFLOW_HOST_TOKEN }
  }));
  playerSocket.send(JSON.stringify({
    type: 'join',
    role: 'player',
    sessionPin,
    data: { nickname: 'Alice', playerToken: 'workflow-alice' }
  }));
  displaySocket.send(JSON.stringify({
    type: 'join',
    role: 'display',
    sessionPin,
    data: { nickname: 'Display' }
  }));

  const restoredStates = await Promise.all([
    waitForMessage(hostMessages, 'session_state_sync'),
    waitForMessage(playerMessages, 'session_state_sync'),
    waitForMessage(displayMessages, 'session_state_sync')
  ]);
  restoredStates.forEach((message, index) => {
    assert.ok(message, `role ${index + 1} should receive session_state_sync after restart`);
    assert.equal(message.data.state, 'start');
    assert.equal(message.data.question, null, 'start sync must not leak a question');
  });

  hostSocket.send(JSON.stringify({
    type: 'host_show_first_question',
    role: 'host',
    sessionPin
  }));

  const quizStarted = await waitForMessage(hostMessages, 'quiz_started');
  assert.ok(quizStarted, 'host should receive quiz_started');

  sessionState = await fetchSessionRecord(config.db, sessionPin);
  assert.ok(sessionState, 'session should be persisted in the database');
  assert.equal(sessionState.state, 'question', 'session state should switch to question when quiz starts');
  assert.equal(Number(sessionState.current_question_index), 0, 'current question index should reset to 0 when quiz starts');

  playerSocket.send(JSON.stringify({
    type: 'player_answer_single',
    role: 'player',
    sessionPin,
    answerIndex: 0
  }));

  await wait(300);

  let persistedResults = await fetchSessionResults(config.db, sessionPin);
  assert.equal(persistedResults.length, 0, 'answer should be rejected while only the question is visible');

  hostSocket.send(JSON.stringify({
    type: 'host_show_answer_options',
    role: 'host',
    sessionPin
  }));

  const optionsShown = await waitForMessage(hostMessages, 'answer_options_shown');
  assert.ok(optionsShown, 'host should receive answer_options_shown');

  const optionsState = await fetchSessionRecord(config.db, sessionPin);
  assert.equal(optionsState.state, 'options', 'session state should switch to options');

  playerSocket.send(JSON.stringify({
    type: 'player_answer_single',
    role: 'player',
    sessionPin,
    answerIndex: 0
  }));

  await wait(300);

  persistedResults = await fetchSessionResults(config.db, sessionPin);
  assert.equal(persistedResults.length, 0, 'answer should be rejected while options are still locked');

  hostSocket.send(JSON.stringify({
    type: 'host_start_answer_phase',
    role: 'host',
    sessionPin
  }));

  const answerPhaseStarted = await waitForMessage(hostMessages, 'answer_phase_started');
  assert.ok(answerPhaseStarted, 'host should receive answer_phase_started');

  const answerState = await fetchSessionRecord(config.db, sessionPin);
  assert.equal(answerState.state, 'answer', 'session state should switch to answer');

  playerSocket.send(JSON.stringify({
    type: 'player_answer_single',
    role: 'player',
    sessionPin,
    answerIndex: 0
  }));

  await wait(300);

  persistedResults = await fetchSessionResults(config.db, sessionPin);
  assert.ok(
    persistedResults.some(result => result.nickname === 'Alice' && Number(result.answered_questions) >= 1),
    'player result should be stored in the database after submitting an answer'
  );
  assert.equal(persistedResults.some(result => result.nickname === 'Bob ohne Antwort'), false);

  let restored = await restartAndJoinAllRoles(sessionPin);
  hostSocket = restored.hostSocket;
  playerSocket = restored.playerSocket;
  displaySocket = restored.displaySocket;
  hostMessages = restored.hostMessages;
  playerMessages = restored.playerMessages;
  displayMessages = restored.displayMessages;
  restored.syncMessages.forEach(message => assert.equal(message?.data?.state, 'answer'));
  assert.equal(restored.syncMessages[1].data.playerAnswered, true);
  assert.equal(restored.syncMessages[1].data.playerSubmission.submittedAnswer.answerIndex, 0);
  assert.ok(restored.syncMessages[1].data.timeLeft > 0 && restored.syncMessages[1].data.timeLeft <= 15);
  assert.equal(restored.syncMessages[0].data.liveAnswerStats.enabled, true);
  assert.equal(restored.syncMessages[0].data.liveAnswerStats.threshold, 10);
  assert.equal(restored.syncMessages[0].data.liveAnswerStats.answered, 1);
  assert.equal(restored.syncMessages[0].data.liveAnswerStats.total, 2);
  assert.equal(restored.syncMessages[0].data.liveAnswerStats.correctnessVisible, true);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.enabled, true);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.threshold, 10);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.answered, 1);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.correctnessVisible, false);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.correct, 0);
  assert.equal(restored.syncMessages[2].data.liveAnswerStats.incorrect, 0);
  assert.equal(JSON.stringify(restored.syncMessages[2].data.liveAnswerStats).includes('workflow-alice'), false);

  const displayLiveStatsCount = displayMessages.filter(message => message.type === 'live_answer_stats').length;
  hostSocket.send(JSON.stringify({
    type: 'host_configure_live_tracking',
    role: 'host',
    sessionPin,
    enabled: false,
    threshold: 10
  }));
  await wait(100);
  assert.ok(displayMessages.filter(message => message.type === 'live_answer_stats').length > displayLiveStatsCount);
  const disabledDisplayStats = displayMessages.filter(message => message.type === 'live_answer_stats').at(-1);
  assert.deepEqual(disabledDisplayStats.data, { enabled: false });

  hostSocket.send(JSON.stringify({
    type: 'host_end_answer_phase',
    role: 'host',
    sessionPin
  }));

  const solutionMessages = await Promise.all([
    waitForMessage(hostMessages, 'show_solution'),
    waitForMessage(playerMessages, 'show_solution'),
    waitForMessage(displayMessages, 'show_solution')
  ]);
  solutionMessages.forEach(message => assert.ok(message));
  assert.equal(solutionMessages[0].data.ranking.length, 2);
  assert.ok(solutionMessages[0].data.ranking.some(entry => entry.name === 'Bob ohne Antwort'));
  const aliceRank = solutionMessages[0].data.ranking.find(entry => entry.name === 'Alice').rank;
  assert.equal(Object.hasOwn(solutionMessages[1].data, 'ranking'), false, 'overall ranking stays hidden for players until released');
  assert.equal(Object.hasOwn(solutionMessages[1].data, 'ownPlacement'), false);
  assert.equal(solutionMessages[1].data.rankingReleased, false);
  assert.equal(solutionMessages[1].data.roundResult.status, 'correct');
  assert.equal(solutionMessages[1].data.roundResult.rank, 1);
  assert.equal(solutionMessages[1].data.roundResult.total, 2);
  assert.ok(solutionMessages[1].data.roundResult.points > 0);
  assert.equal(solutionMessages[1].data.roundStats.correct, 1);
  assert.equal(solutionMessages[1].data.roundStats.noAnswer, 1);
  assert.equal(JSON.stringify(solutionMessages[1].data).includes('Bob ohne Antwort'), false);
  assert.equal(solutionMessages[2].data.roundStats.optionCounts[0], 1);
  assert.equal(solutionMessages[2].data.roundTop[0].name, 'Alice');
  assert.equal(Object.hasOwn(solutionMessages[0].data, 'ownPlacement'), false);
  assert.equal(Object.hasOwn(solutionMessages[2].data, 'ownPlacement'), false);

  hostSocket.send(JSON.stringify({
    type: 'host_select_presentation_view',
    role: 'host',
    sessionPin,
    view: 'ranking'
  }));
  const rankingView = await waitForMessage(hostMessages, 'presentation_view_changed');
  assert.equal(rankingView?.data?.view, 'ranking');
  assert.equal(rankingView.data.ranking.length, 2);
  assert.ok(rankingView.data.ranking.some(entry => entry.name === 'Bob ohne Antwort'));
  assert.equal(rankingView.data.rankingTrend.length, 2);
  const playerRankingView = await waitForMessage(playerMessages, 'presentation_view_changed');
  assert.ok(playerRankingView, 'players should receive the released overall ranking');
  assert.equal(playerRankingView.data.rankingReleased, true);
  assert.equal(playerRankingView.data.ranking.length, 2);
  assert.deepEqual(playerRankingView.data.ownPlacement, { rank: aliceRank, total: 2 });
  assert.equal(playerRankingView.data.ownStanding.rank, aliceRank);

  const reviewConnection = await mysql.createConnection(config.db);
  const [[reviewPlayer]] = await reviewConnection.execute(
    'SELECT id FROM session_players WHERE session_pin = ? AND player_token = ?',
    [sessionPin, 'workflow-bob']
  );
  const [[reviewQuestion]] = await reviewConnection.execute(`
    SELECT question.id FROM sessions session
    INNER JOIN questions question ON question.quiz_id = session.quiz_id
    WHERE session.pin = ? AND question.question_type = 'short_text'
    LIMIT 1
  `, [sessionPin]);
  const [pendingReview] = await reviewConnection.execute(`
    INSERT INTO short_text_reviews (session_pin, player_id, nickname, question_id, answer_text, player_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [sessionPin, reviewPlayer.id, 'Bob ohne Antwort', reviewQuestion.id, 'Wartet auf Bewertung', 'workflow-bob']);
  await reviewConnection.end();

  restored = await restartAndJoinAllRoles(sessionPin);
  hostSocket = restored.hostSocket;
  playerSocket = restored.playerSocket;
  displaySocket = restored.displaySocket;
  hostMessages = restored.hostMessages;
  playerMessages = restored.playerMessages;
  displayMessages = restored.displayMessages;
  restored.syncMessages.forEach(message => {
    assert.equal(message?.data?.state, 'solution');
    assert.equal(message?.data?.presentationView, 'ranking');
  });
  assert.deepEqual(restored.syncMessages[2].data.liveAnswerStats, { enabled: false });
  assert.equal(restored.syncMessages[1].data.playerAnswered, true);
  assert.equal(restored.syncMessages[1].data.ranking.length, 2);
  const restoredAliceRank = restored.syncMessages[1].data.ranking.find(entry => entry.name === 'Alice').rank;
  assert.deepEqual(restored.syncMessages[1].data.ownPlacement, { rank: restoredAliceRank, total: 2 });
  assert.equal(restored.syncMessages[1].data.rankingReleased, true);
  assert.equal(restored.syncMessages[1].data.roundResult.status, 'correct');
  assert.equal(restored.syncMessages[1].data.playerResult.questionId > 0, true);
  assert.equal(restored.syncMessages[2].data.roundStats.correct, 1);
  assert.equal(Object.hasOwn(restored.syncMessages[2].data, 'roundResult'), false);
  assert.equal(Object.hasOwn(restored.syncMessages[0].data, 'ownPlacement'), false);
  assert.equal(Object.hasOwn(restored.syncMessages[2].data, 'ownPlacement'), false);
  const restoredReviewQueue = await waitForMessage(hostMessages, 'review_queue_updated');
  assert.ok(restoredReviewQueue.data.reviews.some(review => Number(review.id) === Number(pendingReview.insertId)));
  assert.equal(playerMessages.some(message => message.type === 'review_queue_updated'), false);
  assert.equal(displayMessages.some(message => message.type === 'review_queue_updated'), false);
  const restoredAlice = Object.values(serverModule.sessions[sessionPin].players)
    .find(player => player.playerToken === 'workflow-alice');
  const aliceResult = persistedResults.find(result => result.nickname === 'Alice');
  assert.equal(restoredAlice.databaseId, Number(aliceResult.player_id));

  hostSocket.send(JSON.stringify({
    type: 'host_next_question',
    role: 'host',
    sessionPin
  }));

  await wait(300);

  const finished = hostMessages.some(message => message.type === 'quiz_finished');
  assert.equal(finished, false, 'quiz should continue when a second question exists');

  hostSocket.close();
  playerSocket.close();
  displaySocket.close();
});
