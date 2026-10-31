const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const utilsFactory = require('../utils');
const { cleanupSessions, createSessions } = require('./helpers/session-fixtures');

const TEST_PIN = '910050';
let config;

test.before(async () => {
  config = loadConfig();
  await initDb(config.db);
  await createSessions(config.db, [TEST_PIN]);
});

test.after(async () => {
  if (config) await cleanupSessions(config.db, [TEST_PIN]);
});

test('question loader preserves text, image, and mixed option metadata', async () => {
  const connection = await mysql.createConnection(config.db);
  const [[session]] = await connection.execute('SELECT quiz_id FROM sessions WHERE pin = ?', [TEST_PIN]);
  const [[question]] = await connection.execute(
    'SELECT id FROM questions WHERE quiz_id = ? ORDER BY position, id LIMIT 1',
    [session.quiz_id]
  );
  const [originalRows] = await connection.execute(
    'SELECT id, option_image_url, option_alt_text FROM question_options WHERE question_id = ? ORDER BY option_index',
    [question.id]
  );
  await connection.execute(
    'UPDATE question_options SET option_image_url = ?, option_alt_text = ? WHERE id = ?',
    ['uploads/options/paris.jpg', 'Ansicht von Paris', originalRows[0].id]
  );
  await connection.end();

  try {
    const sessionState = await utilsFactory(config.db).loadSessionData(TEST_PIN, {});
    await utilsFactory(config.db).loadNextQuestion(TEST_PIN, sessionState);
    assert.equal(sessionState.question.options[0], 'Paris');
    assert.deepEqual(sessionState.question.optionMedia[0], {
      text: 'Paris',
      imageUrl: 'uploads/options/paris.jpg',
      altText: 'Ansicht von Paris'
    });
    assert.equal(sessionState.question.optionMedia[1].imageUrl, '');
  } finally {
    const restoreConnection = await mysql.createConnection(config.db);
    for (const row of originalRows) {
      await restoreConnection.execute(
        'UPDATE question_options SET option_image_url = ?, option_alt_text = ? WHERE id = ?',
        [row.option_image_url, row.option_alt_text, row.id]
      );
    }
    await restoreConnection.end();
  }
});