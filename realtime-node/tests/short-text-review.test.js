const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const utilsFactory = require('../utils');
const { handleReviewShortTextAnswer } = require('../quiz');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PIN = '910040';
const PLAYER_TOKEN = 'short-text-review-player';
let config;
let utils;
let reviewId;
let questionId;
let playerId;
let maximumPoints;
const sentMessages = [];
const liveStatsMessages = [];
let originalBroadcastToSession;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, [TEST_PIN]);
  utils = utilsFactory(config.db);
  originalBroadcastToSession = utils.broadcastToSession;
  utils.broadcastToSession = (pin, message, sessions, allowedRoles) => {
    if (message.type === 'live_answer_stats') {
      liveStatsMessages.push({ data: message.data, roles: allowedRoles });
    }
    return originalBroadcastToSession(pin, message, sessions, allowedRoles);
  };

  const connection = await mysql.createConnection(config.db);
  const [[question]] = await connection.execute(`
    SELECT question.id, question.points_max
    FROM sessions session
    INNER JOIN questions question ON question.quiz_id = session.quiz_id
    WHERE session.pin = ? AND question.question_type = 'short_text'
    LIMIT 1
  `, [TEST_PIN]);
  questionId = Number(question.id);
  maximumPoints = Number(question.points_max);
  const [playerInsert] = await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname) VALUES (?, ?, ?)',
    [TEST_PIN, PLAYER_TOKEN, 'Text Player']
  );
  playerId = Number(playerInsert.insertId);
  await connection.execute(`
    INSERT INTO session_answers (
      session_pin, player_token, question_id, answer_payload, answer_time_ms, is_correct, points_awarded
    ) VALUES (?, ?, ?, ?, ?, 0, 0)
  `, [TEST_PIN, PLAYER_TOKEN, questionId, JSON.stringify({ answerText: 'php' }), 3210]);
  const [reviewInsert] = await connection.execute(`
    INSERT INTO short_text_reviews (
      session_pin, player_id, nickname, question_id, answer_text, player_token
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [TEST_PIN, playerId, 'Text Player', questionId, 'php', PLAYER_TOKEN]);
  reviewId = Number(reviewInsert.insertId);
  await connection.end();
});

test.after(async () => {
  if (utils && originalBroadcastToSession) {
    utils.broadcastToSession = originalBroadcastToSession;
  }
  if (config) await cleanupSessions(config.db, [TEST_PIN]);
});

async function review(points, comment = '') {
  const player = {
    id: 77,
    databaseId: playerId,
    playerToken: PLAYER_TOKEN,
    name: 'Text Player',
    points: 0,
    currentAnswer: { questionId, pointsAwarded: 0, isCorrect: false }
  };
  const sessions = {
    [TEST_PIN]: {
      question: { id: questionId, type: 'short_text' },
      players: { 77: player },
      hosts: []
    }
  };
  const ws = {
    role: 'host',
    sessionPin: TEST_PIN,
    nickname: 'Review Host',
    readyState: 1,
    send(payload) { sentMessages.push(JSON.parse(payload)); }
  };
  await handleReviewShortTextAnswer(ws, { reviewId, points, comment }, sessions, utils);
  return player;
}

async function readState() {
  const connection = await mysql.createConnection(config.db);
  const [[answer]] = await connection.execute(
    'SELECT points_awarded, is_correct FROM session_answers WHERE session_pin = ? AND player_token = ? AND question_id = ?',
    [TEST_PIN, PLAYER_TOKEN, questionId]
  );
  const [[result]] = await connection.execute(
    'SELECT points, correct_answers, answered_questions FROM session_results WHERE session_pin = ? AND player_id = ?',
    [TEST_PIN, playerId]
  );
  const [[reviewRow]] = await connection.execute(
    'SELECT points_awarded, review_comment, reviewed_by, reviewed_at FROM short_text_reviews WHERE id = ?',
    [reviewId]
  );
  await connection.end();
  return { answer, result, reviewRow };
}

test('short text review supports idempotent partial points and corrections', async () => {
  await review(maximumPoints, 'voll richtig');
  let state = await readState();
  assert.equal(Number(state.answer.points_awarded), maximumPoints);
  assert.equal(Number(state.result.correct_answers), 1);
  assert.equal(Number(state.result.answered_questions), 1);
  const correctlyReviewed = liveStatsMessages.filter(entry => entry.roles?.includes('host')).at(-1);
  assert.deepEqual(correctlyReviewed.data, {
    total: 1,
    answered: 1,
    correct: 1,
    incorrect: 0,
    pendingReview: 0,
    enabled: false,
    threshold: 1,
    correctnessVisible: true
  });

  await review(35, 'teilweise richtig');
  await review(35, 'teilweise richtig');
  state = await readState();
  assert.equal(Number(state.answer.points_awarded), 35);
  assert.equal(Number(state.result.points), 35);
  assert.equal(Number(state.result.correct_answers), 0);
  assert.equal(Number(state.result.answered_questions), 1);
  assert.equal(state.reviewRow.review_comment, 'teilweise richtig');
  assert.equal(state.reviewRow.reviewed_by, 'Review Host');
  assert.ok(state.reviewRow.reviewed_at);
  const partiallyReviewed = liveStatsMessages.filter(entry => entry.roles?.includes('host')).at(-1);
  assert.equal(partiallyReviewed.data.correct, 0);
  assert.equal(partiallyReviewed.data.incorrect, 1);
  assert.equal(partiallyReviewed.data.pendingReview, 0);

  await review(maximumPoints + 1);
  state = await readState();
  assert.equal(Number(state.answer.points_awarded), 35);
  assert.match(sentMessages.at(-1).data.reason, /zwischen 0 und/i);

  await Promise.all([
    review(20, 'parallel 20'),
    review(60, 'parallel 60')
  ]);
  state = await readState();
  const finalPoints = Number(state.answer.points_awarded);
  assert.ok([20, 60].includes(finalPoints));
  assert.equal(Number(state.result.points), finalPoints);
  assert.equal(Number(state.result.answered_questions), 1);
  assert.equal(Number(state.reviewRow.points_awarded), finalPoints);
});

test('review updates each player placement during solution and after finish, but not during the answer phase', async () => {
  const playerMessages = [[], []];
  const broadcasts = [];
  const firstPlayer = {
    id: 777,
    databaseId: playerId,
    playerToken: PLAYER_TOKEN,
    name: 'Text Player',
    points: 0,
    currentAnswer: { questionId, pointsAwarded: 0, isCorrect: false },
    ws: { readyState: 1, send: payload => playerMessages[0].push(JSON.parse(payload)) }
  };
  const secondPlayer = {
    id: 778,
    name: 'Other Player',
    points: 1,
    ws: { readyState: 1, send: payload => playerMessages[1].push(JSON.parse(payload)) }
  };
  const sessions = {
    [TEST_PIN]: {
      state: 'solution',
      presentation_view: 'ranking',
      question: { id: questionId, type: 'short_text' },
      players: { 777: firstPlayer, 778: secondPlayer },
      hosts: [],
      displays: []
    }
  };
  const testUtils = {
    ...utils,
    broadcastToSession(_pin, message, _sessions, roles) { broadcasts.push({ message, roles }); }
  };
  const host = { role: 'host', sessionPin: TEST_PIN, nickname: 'Review Host', readyState: 1, send() {} };

  await handleReviewShortTextAnswer(host, { reviewId, points: maximumPoints }, sessions, testUtils);
  const firstUpdate = playerMessages[0].find(message => message.type === 'ranking_updated');
  const secondUpdate = playerMessages[1].find(message => message.type === 'ranking_updated');
  assert.deepEqual(firstUpdate.data.ownPlacement, { rank: 1, total: 2 });
  assert.deepEqual(secondUpdate.data.ownPlacement, { rank: 2, total: 2 });
  assert.equal(firstPlayer.points, maximumPoints);
  const publicUpdate = broadcasts.find(entry => entry.message.type === 'ranking_updated');
  assert.deepEqual(publicUpdate.roles, ['host', 'display']);
  assert.equal(Object.hasOwn(publicUpdate.message.data, 'ownPlacement'), false);
  assert.equal(firstUpdate.data.roundResult.status, 'correct');
  assert.equal(firstUpdate.data.roundResult.points, maximumPoints);
  assert.equal(publicUpdate.message.data.roundStats.correct, 1);
  assert.equal(publicUpdate.message.data.roundTop[0].name, 'Text Player');

  playerMessages.forEach(messages => { messages.length = 0; });
  sessions[TEST_PIN].presentation_view = 'solution';
  await handleReviewShortTextAnswer(host, { reviewId, points: maximumPoints }, sessions, testUtils);
  const hiddenUpdate = playerMessages[0].find(message => message.type === 'ranking_updated');
  assert.equal(Object.hasOwn(hiddenUpdate.data, 'ranking'), false);
  assert.equal(Object.hasOwn(hiddenUpdate.data, 'ownPlacement'), false);
  assert.equal(hiddenUpdate.data.rankingReleased, false);
  assert.equal(hiddenUpdate.data.roundResult.rank, 1);
  assert.equal(playerMessages[1].find(message => message.type === 'ranking_updated').data.roundResult.status, 'no_answer');

  playerMessages.forEach(messages => { messages.length = 0; });
  sessions[TEST_PIN].state = 'answer';
  await handleReviewShortTextAnswer(host, { reviewId, points: 0 }, sessions, testUtils);
  assert.equal(playerMessages.flat().some(message => message.type === 'ranking_updated'), false);

  for (const state of ['finished', 'endresult']) {
    playerMessages.forEach(messages => { messages.length = 0; });
    sessions[TEST_PIN].state = state;
    await handleReviewShortTextAnswer(host, { reviewId, points: 0 }, sessions, testUtils);
    assert.deepEqual(playerMessages[0].find(message => message.type === 'ranking_updated').data.ownPlacement, { rank: 2, total: 2 });
    assert.deepEqual(playerMessages[1].find(message => message.type === 'ranking_updated').data.ownPlacement, { rank: 1, total: 2 });
  }
});