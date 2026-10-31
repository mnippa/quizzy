const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const utilsFactory = require('../utils');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PIN = '910020';
const PLAYER_TOKEN = 'canonical-result-player';
let config;
let questionId;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, [TEST_PIN]);

  const connection = await mysql.createConnection(config.db);
  const [questionRows] = await connection.execute(`
    SELECT question.id
    FROM sessions session
    INNER JOIN questions question ON question.quiz_id = session.quiz_id
    WHERE session.pin = ?
    ORDER BY question.position, question.id
    LIMIT 1
  `, [TEST_PIN]);
  questionId = Number(questionRows[0].id);
  await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname) VALUES (?, ?, ?)',
    [TEST_PIN, PLAYER_TOKEN, 'Parallel Player']
  );
  await connection.end();
});

test.after(async () => {
  if (config) await cleanupSessions(config.db, [TEST_PIN]);
});

test('parallel duplicate answers update canonical totals exactly once', async () => {
  const answer = {
    submittedAnswer: { answerIndex: 0 },
    answerTimeMs: 4079,
    isCorrect: true,
    pointsAwarded: 73
  };
  const player = { playerToken: PLAYER_TOKEN };
  const question = { id: questionId };
  const firstUtils = utilsFactory(config.db);
  const secondUtils = utilsFactory(config.db);

  const outcomes = await Promise.all([
    firstUtils.persistCanonicalAnswer(TEST_PIN, player, question, answer),
    secondUtils.persistCanonicalAnswer(TEST_PIN, player, question, answer)
  ]);

  assert.equal(outcomes.filter(outcome => outcome.inserted).length, 1);

  const connection = await mysql.createConnection(config.db);
  const [[answerTotals]] = await connection.execute(`
    SELECT COUNT(*) AS answer_count, SUM(points_awarded) AS points,
      SUM(is_correct) AS correct_answers, MIN(answer_time_ms) AS answer_time_ms
    FROM session_answers
    WHERE session_pin = ? AND player_token = ?
  `, [TEST_PIN, PLAYER_TOKEN]);
  const [[playerState]] = await connection.execute(
    'SELECT id, points, answered FROM session_players WHERE session_pin = ? AND player_token = ?',
    [TEST_PIN, PLAYER_TOKEN]
  );
  const [[resultState]] = await connection.execute(`
    SELECT player_id, points, correct_answers, answered_questions
    FROM session_results
    WHERE session_pin = ?
  `, [TEST_PIN]);
  await connection.end();

  assert.deepEqual({
    answerCount: Number(answerTotals.answer_count),
    points: Number(answerTotals.points),
    correctAnswers: Number(answerTotals.correct_answers),
    answerTimeMs: Number(answerTotals.answer_time_ms)
  }, {
    answerCount: 1,
    points: 73,
    correctAnswers: 1,
    answerTimeMs: 4079
  });
  assert.equal(Number(playerState.points), 73);
  assert.equal(Number(playerState.answered), 1);
  assert.equal(Number(resultState.player_id), Number(playerState.id));
  assert.equal(Number(resultState.points), 73);
  assert.equal(Number(resultState.correct_answers), 1);
  assert.equal(Number(resultState.answered_questions), 1);

  const stateConnection = await mysql.createConnection(config.db);
  await stateConnection.execute(
    'UPDATE session_players SET points = 999 WHERE session_pin = ? AND player_token = ?',
    [TEST_PIN, PLAYER_TOKEN]
  );
  await stateConnection.execute(
    'UPDATE session_results SET points = 999, correct_answers = 9, answered_questions = 9 WHERE session_pin = ?',
    [TEST_PIN]
  );
  await utilsFactory(config.db).rebuildSessionResults(TEST_PIN);
  const [[repairedPlayer]] = await stateConnection.execute(
    'SELECT points FROM session_players WHERE session_pin = ? AND player_token = ?',
    [TEST_PIN, PLAYER_TOKEN]
  );
  const [[repairedResult]] = await stateConnection.execute(
    'SELECT points, correct_answers, answered_questions FROM session_results WHERE session_pin = ?',
    [TEST_PIN]
  );
  assert.equal(Number(repairedPlayer.points), 73);
  assert.deepEqual({
    points: Number(repairedResult.points),
    correctAnswers: Number(repairedResult.correct_answers),
    answeredQuestions: Number(repairedResult.answered_questions)
  }, { points: 73, correctAnswers: 1, answeredQuestions: 1 });

  await stateConnection.execute(
    "UPDATE sessions SET state = 'solution', current_question_index = 0 WHERE pin = ?",
    [TEST_PIN]
  );
  await stateConnection.end();

  const restoredSession = await utilsFactory(config.db).loadSessionData(TEST_PIN, {});
  const restoredPlayer = Object.values(restoredSession.players)[0];
  assert.equal(restoredSession.state, 'solution');
  assert.equal(restoredPlayer.answered, true);
  assert.deepEqual(restoredPlayer.currentAnswer, {
    questionId,
    submittedAnswer: { answerIndex: 0 },
    answerTimeMs: 4079,
    isCorrect: true,
    pointsAwarded: 73
  });
});