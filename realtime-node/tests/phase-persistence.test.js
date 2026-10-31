const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const { getRemainingPhaseTime, handleJoinLobby, handleHostKickPlayer } = require('../lobby');
const utilsFactory = require('../utils');
const ranking = require('../ranking');
const {
  handleHostEndAnswerPhase,
  handleHostNextQuestion,
  handleHostShowAnswerOptions,
  handleHostShowFirstQuestion,
  handleHostStartAnswerPhase,
  restoreAutomaticTransition
} = require('../quiz');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PIN = '910070';
const RECONNECT_PIN = '910071';
let config;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, [TEST_PIN, RECONNECT_PIN]);
});

test.after(async () => {
  if (config) await cleanupSessions(config.db, [TEST_PIN, RECONNECT_PIN]);
});

test('answer phase restores persisted absolute timing after session reload', async () => {
  const startedAt = Date.now() - 2000;
  const deadlineAt = startedAt + 15000;
  const connection = await mysql.createConnection(config.db);
  await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname, answered) VALUES (?, ?, ?, 1)',
    [TEST_PIN, 'phase-player-token', 'Phase Player']
  );
  const [[question]] = await connection.execute(`
    SELECT question.id
    FROM sessions session
    INNER JOIN questions question ON question.quiz_id = session.quiz_id
    WHERE session.pin = ?
    ORDER BY question.position, question.id
    LIMIT 1
  `, [TEST_PIN]);
  await connection.execute(`
    INSERT INTO session_answers (
      session_pin, player_token, question_id, answer_payload, answer_time_ms, is_correct, points_awarded
    ) VALUES (?, ?, ?, ?, 900, 1, 75)
  `, [TEST_PIN, 'phase-player-token', question.id, JSON.stringify({ answerIndex: 0 })]);
  await connection.execute(`
    UPDATE sessions
    SET state = 'answer', phase_started_ms = ?, phase_deadline_ms = ?
    WHERE pin = ?
  `, [startedAt, deadlineAt, TEST_PIN]);
  await connection.end();

  const session = await utilsFactory(config.db).loadSessionData(TEST_PIN, {});
  assert.equal(session.phaseStartedAt, startedAt);
  assert.equal(session.answerStartTime, startedAt);
  assert.equal(session.phaseDeadlineAt, deadlineAt);
  assert.ok(getRemainingPhaseTime(session) >= 12 && getRemainingPhaseTime(session) <= 13);
  const restoredPlayer = Object.values(session.players)[0];
  assert.equal(restoredPlayer.answered, true);
  assert.equal(restoredPlayer.currentAnswer.answerTimeMs, 900);
  assert.equal(restoredPlayer.currentAnswer.pointsAwarded, 75);
});

test('restored players cannot be overwritten by a reconnecting client ID', async () => {
  const connection = await mysql.createConnection(config.db);
  const [first] = await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname) VALUES (?, ?, ?)',
    [RECONNECT_PIN, 'restored-first', 'First']
  );
  const [second] = await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname) VALUES (?, ?, ?)',
    [RECONNECT_PIN, 'restored-second', 'Second']
  );
  await connection.end();

  const utils = utilsFactory(config.db);
  const session = await utils.loadSessionData(RECONNECT_PIN, {});
  const sessions = { [RECONNECT_PIN]: session };
  const messages = [];
  const playerSocket = {
    clientId: Number(second.insertId),
    readyState: 1,
    send(payload) { messages.push(JSON.parse(payload)); }
  };
  const testUtils = { ...utils, broadcastToSession() {} };
  await handleJoinLobby(playerSocket, {
    role: 'player',
    sessionPin: RECONNECT_PIN,
    data: { nickname: 'First', playerToken: 'restored-first' }
  }, sessions, testUtils);

  const players = Object.values(session.players);
  assert.equal(players.length, 2);
  assert.equal(players.find(player => player.name === 'First').databaseId, Number(first.insertId));
  assert.equal(players.find(player => player.name === 'Second').databaseId, Number(second.insertId));
  assert.equal(messages.find(message => message.type === 'lobby_joined').data.playerCount, 2);

  await handleHostKickPlayer(
    { role: 'host', sessionPin: RECONNECT_PIN },
    { playerId: -Number(second.insertId) },
    sessions,
    testUtils
  );
  assert.deepEqual(Object.values(session.players).map(player => player.name), ['First']);
  const verify = await mysql.createConnection(config.db);
  const [remaining] = await verify.execute('SELECT nickname FROM session_players WHERE session_pin = ?', [RECONNECT_PIN]);
  await verify.end();
  assert.deepEqual(remaining.map(row => row.nickname), ['First']);
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await wait(10);
  }
}

test('expired automatic start, answer and solution phases restore exactly one transition', async () => {
  const transitionCounts = { quiz_started: 0, show_solution: 0, next_question: 0 };
  const testUtils = {
    buildLiveAnswerStats(session) {
      return {
        total: Object.keys(session.players || {}).length,
        answered: 0,
        correct: 0,
        incorrect: 0,
        pendingReview: 0
      };
    },
    buildDisplayLiveAnswerStats(stats, enabled, threshold) {
      return { ...stats, enabled, threshold, correctnessVisible: false };
    },
    async loadQuestionStats() { return null; },
    async loadSessionResults() { return []; },
    async saveSessionPlayer() {},
    async loadNextQuestion(pin, session) {
      session.question = { id: 2, type: 'single_choice', text: 'Next', options: ['A', 'B'], correct_option_index: 0 };
    },
    broadcastToSession(pin, message, sessions) {
      if (message.type === 'quiz_started') transitionCounts.quiz_started += 1;
      if (message.type === 'show_solution') transitionCounts.show_solution += 1;
      if (message.type === 'next_question') transitionCounts.next_question += 1;
      sessions[pin].quiz_automatic_mode = false;
    }
  };

  const startSession = {
    state: 'start',
    quiz_automatic_mode: true,
    phaseDeadlineAt: Date.now() - 1,
    quiz_question_phase_seconds: 30,
    current_question_index: 0,
    question: null,
    players: {},
    hosts: [],
    displays: []
  };
  restoreAutomaticTransition(TEST_PIN, startSession, testUtils, ranking);
  const startTimer = startSession.automaticTimer;
  restoreAutomaticTransition(TEST_PIN, startSession, testUtils, ranking);
  assert.equal(startSession.automaticTimer, startTimer);
  await waitFor(() => transitionCounts.quiz_started === 1);
  assert.equal(transitionCounts.quiz_started, 1);

  const answerSession = {
    state: 'answer',
    quiz_automatic_mode: true,
    phaseDeadlineAt: Date.now() - 1,
    quiz_solution_phase_seconds: 30,
    current_question_index: 0,
    question: { id: 1, type: 'single_choice', text: 'Q', options: ['A', 'B'], correct_option_index: 0 },
    players: {},
    hosts: [],
    displays: []
  };
  restoreAutomaticTransition(TEST_PIN, answerSession, testUtils, ranking);
  const answerTimer = answerSession.automaticTimer;
  restoreAutomaticTransition(TEST_PIN, answerSession, testUtils, ranking);
  assert.equal(answerSession.automaticTimer, answerTimer);
  await waitFor(() => transitionCounts.show_solution === 1);
  assert.equal(transitionCounts.show_solution, 1);

  const solutionSession = {
    state: 'solution',
    quiz_automatic_mode: true,
    phaseDeadlineAt: Date.now() - 1,
    current_question_index: 0,
    question: { id: 1, type: 'single_choice', text: 'Q', options: ['A', 'B'], correct_option_index: 0 },
    players: {},
    hosts: [],
    displays: []
  };
  restoreAutomaticTransition(TEST_PIN, solutionSession, testUtils, ranking);
  const solutionTimer = solutionSession.automaticTimer;
  restoreAutomaticTransition(TEST_PIN, solutionSession, testUtils, ranking);
  assert.equal(solutionSession.automaticTimer, solutionTimer);
  await waitFor(() => transitionCounts.next_question === 1);
  assert.equal(transitionCounts.next_question, 1);
});

test('manual skips cancel pending automatic transitions in every phase', async () => {
  const counts = { quiz_started: 0, answer_options_shown: 0, answer_phase_started: 0, show_solution: 0, next_question: 0 };
  let questionId = 10;
  const testUtils = {
    buildLiveAnswerStats(session) {
      return {
        total: Object.keys(session.players || {}).length,
        answered: 0,
        correct: 0,
        incorrect: 0,
        pendingReview: 0
      };
    },
    buildDisplayLiveAnswerStats(stats, enabled, threshold) {
      return { ...stats, enabled, threshold, correctnessVisible: false };
    },
    async loadQuestionStats() { return null; },
    async loadSessionResults() { return []; },
    async saveSessionPlayer() {},
    async loadNextQuestion(pin, session) {
      questionId += 1;
      session.question = {
        id: questionId,
        type: 'single_choice',
        text: `Question ${questionId}`,
        options: ['A', 'B'],
        correct_option_index: 0,
        time_limit: 30
      };
    },
    broadcastToSession(pin, message) {
      if (Object.prototype.hasOwnProperty.call(counts, message.type)) counts[message.type] += 1;
    }
  };
  const session = {
    state: 'start',
    quiz_automatic_mode: true,
    quiz_start_phase_seconds: 30,
    quiz_question_phase_seconds: 30,
    quiz_options_phase_seconds: 30,
    quiz_solution_phase_seconds: 30,
    phaseDeadlineAt: Date.now() + 20,
    current_question_index: 0,
    question: null,
    players: {},
    hosts: [],
    displays: []
  };
  const sessions = { [TEST_PIN]: session };
  const host = { role: 'host', sessionPin: TEST_PIN, nickname: 'Host' };
  const armImminentTransition = () => {
    if (session.automaticTimer) clearTimeout(session.automaticTimer);
    session.automaticTimer = null;
    session.phaseDeadlineAt = Date.now() + 20;
    restoreAutomaticTransition(TEST_PIN, session, testUtils, ranking);
  };

  armImminentTransition();
  await handleHostShowFirstQuestion(host, {}, sessions, testUtils, ranking);
  await wait(50);
  assert.equal(session.state, 'question');
  assert.equal(counts.quiz_started, 1);

  armImminentTransition();
  await handleHostShowAnswerOptions(host, {}, sessions, testUtils, ranking);
  await wait(50);
  assert.equal(session.state, 'options');
  assert.equal(counts.answer_options_shown, 1);

  armImminentTransition();
  await handleHostStartAnswerPhase(host, {}, sessions, testUtils, ranking);
  await wait(50);
  assert.equal(session.state, 'answer');
  assert.equal(counts.answer_phase_started, 1);

  armImminentTransition();
  await handleHostEndAnswerPhase(host, {}, sessions, testUtils, ranking);
  await wait(50);
  assert.equal(session.state, 'solution');
  assert.equal(counts.show_solution, 1);

  armImminentTransition();
  await handleHostNextQuestion(host, {}, sessions, testUtils, ranking);
  await wait(50);
  assert.equal(session.state, 'question');
  assert.equal(counts.next_question, 1);
  clearTimeout(session.automaticTimer);
  session.automaticTimer = null;
});