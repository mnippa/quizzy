const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const utilsFactory = require('../utils');
const { handleHostEndQuiz, handleHostNextQuestion, handleHostSelectPresentationView } = require('../quiz');
const ranking = require('../ranking');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PIN = '910060';
const TERMINATION_PINS = ['910061', '910062', '910063', '910064', '910065', '910066'];
const FINAL_PLACEMENT_PINS = ['910067', '910068'];
const TEST_PINS = [TEST_PIN, ...TERMINATION_PINS, ...FINAL_PLACEMENT_PINS];
let config;
let utils;
let questionId;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, TEST_PINS);
  utils = utilsFactory(config.db);

  const connection = await mysql.createConnection(config.db);
  const [[question]] = await connection.execute(`
    SELECT question.id
    FROM sessions session
    INNER JOIN questions question ON question.quiz_id = session.quiz_id
    WHERE session.pin = ? AND question.question_type = 'short_text'
    LIMIT 1
  `, [TEST_PIN]);
  questionId = Number(question.id);
  await connection.execute("UPDATE sessions SET state = 'solution' WHERE pin = ?", [TEST_PIN]);
  const [player] = await connection.execute(
    'INSERT INTO session_players (session_pin, player_token, nickname) VALUES (?, ?, ?)',
    [TEST_PIN, 'presentation-secret-token', 'Secret Name']
  );
  await connection.execute(`
    INSERT INTO short_text_reviews (
      session_pin, player_id, nickname, question_id, answer_text, player_token
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [TEST_PIN, player.insertId, 'Secret Name', questionId, 'Anonyme Antwort', 'presentation-secret-token']);
  await connection.execute(`
    INSERT INTO session_answers (
      session_pin, player_token, question_id, answer_payload, answer_time_ms, is_correct, points_awarded
    ) VALUES (?, ?, ?, ?, 1250, 1, 80)
  `, [TEST_PIN, 'presentation-secret-token', questionId, JSON.stringify({ answerText: 'Anonyme Antwort' })]);
  await connection.end();
});

test.after(async () => {
  if (config) await cleanupSessions(config.db, TEST_PINS);
});

async function readPresentationView() {
  const connection = await mysql.createConnection(config.db);
  const [[row]] = await connection.execute('SELECT presentation_view FROM sessions WHERE pin = ?', [TEST_PIN]);
  await connection.end();
  return row.presentation_view;
}

test('host presentation selection persists and releases free text anonymously', async () => {
  const broadcasts = [];
  const sessions = {
    [TEST_PIN]: {
      state: 'solution',
      question: { id: questionId, type: 'short_text' },
      players: {},
      hosts: [],
      displays: []
    }
  };
  const ws = { role: 'host', sessionPin: TEST_PIN };
  const testUtils = {
    ...utils,
    broadcastToSession(pin, message, allSessions, roles) {
      broadcasts.push({ pin, message, allSessions, roles });
    }
  };

  await handleHostSelectPresentationView(ws, { view: 'free_text' }, sessions, testUtils);
  assert.equal(await readPresentationView(), 'free_text');
  assert.equal(broadcasts.length, 1);
  assert.deepEqual(broadcasts[0].roles, ['host', 'display']);
  assert.deepEqual(broadcasts[0].message.data.freeTextAnswers, [{ answerText: 'Anonyme Antwort' }]);
  assert.deepEqual(broadcasts[0].message.data.questionStats, {
    answerCount: 1,
    correctCount: 1,
    averageTimeMs: 1250,
    pointsAwarded: 80
  });
  assert.equal(JSON.stringify(broadcasts[0]).includes('Secret Name'), false);
  assert.equal(JSON.stringify(broadcasts[0]).includes('presentation-secret-token'), false);

  await handleHostSelectPresentationView(ws, { view: 'not_allowed' }, sessions, testUtils);
  assert.equal(await readPresentationView(), 'free_text');
  assert.equal(broadcasts.length, 1);
});

test('presentation ranking includes all participants, including non-respondents', async () => {
  const broadcasts = [];
  const players = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
    index + 1, { name: `Spieler ${index + 1}`, points: index, answered: index !== 0 }
  ]));
  const sessions = {
    [TEST_PIN]: { state: 'solution', question: { id: questionId }, players, hosts: [], displays: [] }
  };
  const testUtils = {
    ...utils,
    async loadSessionResults() { return [{ rank: 1, name: 'Nur eine gespeicherte Antwort', points: 100 }]; },
    async loadQuestionStats() { return null; },
    broadcastToSession(_pin, message, _sessions, roles) { broadcasts.push({ message, roles }); }
  };
  const host = { role: 'host', sessionPin: TEST_PIN };

  await handleHostSelectPresentationView(host, { view: 'ranking' }, sessions, testUtils);
  assert.equal(broadcasts[0].message.data.ranking.length, 101);
  assert.deepEqual(broadcasts[0].message.data.ranking.at(-1), { rank: 101, name: 'Spieler 1', points: 0 });
  assert.deepEqual(broadcasts[0].roles, ['host', 'display']);
  await handleHostSelectPresentationView(host, { view: 'top10' }, sessions, testUtils);
  assert.equal(broadcasts[1].message.data.ranking.length, 10);
  assert.equal(broadcasts[1].message.data.ranking[0].name, 'Spieler 101');
});

test('manual and natural finish send each connected player only their own placement', async () => {
  for (const [index, pin] of FINAL_PLACEMENT_PINS.entries()) {
    const received = [[], []];
    const broadcasts = [];
    const players = {
      first: { name: 'First', points: 20, ws: { readyState: 1, send: payload => received[0].push(JSON.parse(payload)) } },
      second: { name: 'Second', points: 50, ws: { readyState: 1, send: payload => received[1].push(JSON.parse(payload)) } },
      absent: { name: 'No Answer', points: 0, ws: null }
    };
    const sessions = { [pin]: { state: 'solution', current_question_index: 0, players, hosts: [], displays: [] } };
    const testUtils = {
      ...utils,
      async loadSessionResults() { return []; },
      async loadNextQuestion(_pin, session) { session.state = 'finished'; },
      broadcastToSession(_pin, message, _sessions, roles) { broadcasts.push({ message, roles }); }
    };
    const host = { role: 'host', sessionPin: pin };

    if (index === 0) {
      await handleHostEndQuiz(host, {}, sessions, testUtils, ranking);
    } else {
      await handleHostNextQuestion(host, {}, sessions, testUtils, ranking);
    }

    assert.deepEqual(broadcasts[0].roles, ['host', 'display']);
    assert.equal(broadcasts[0].message.data.ranking.length, 3);
    assert.equal(Object.hasOwn(broadcasts[0].message.data, 'ownPlacement'), false);
    assert.deepEqual(received[0][0].data.ownPlacement, { rank: 2, total: 3 });
    assert.deepEqual(received[1][0].data.ownPlacement, { rank: 1, total: 3 });
    assert.equal(received[0][0].type, 'quiz_finished');
    assert.equal(received[1][0].type, 'quiz_finished');
  }
});

test('host can end the session from every active phase', async () => {
  const phases = ['lobby', 'start', 'question', 'options', 'answer', 'solution'];
  const connection = await mysql.createConnection(config.db);
  const broadcasts = [];
  const testUtils = {
    ...utils,
    broadcastToSession(pin, message) {
      broadcasts.push({ pin, message });
    }
  };

  for (let index = 0; index < phases.length; index += 1) {
    const pin = TERMINATION_PINS[index];
    const phase = phases[index];
    await connection.execute('UPDATE sessions SET state = ? WHERE pin = ?', [phase, pin]);
    const sessions = {
      [pin]: {
        state: phase,
        current_question_index: 0,
        players: {},
        hosts: [],
        displays: []
      }
    };
    await handleHostEndQuiz({ role: 'host', sessionPin: pin }, {}, sessions, testUtils, ranking);
    const [[row]] = await connection.execute('SELECT state FROM sessions WHERE pin = ?', [pin]);
    assert.match(row.state, /^(finished|endresult)$/, `phase ${phase} should persist a final state`);
  }

  await connection.end();
  assert.equal(broadcasts.length, phases.length);
});