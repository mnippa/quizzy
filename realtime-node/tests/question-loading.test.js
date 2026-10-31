const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const utilsFactory = require('../utils');
const { findTestQuizId } = require('./helpers/session-fixtures');

test('loadNextQuestion loads a question from the database', async () => {
  const config = loadConfig();
  await initDb(config.db);
  const quizId = await findTestQuizId(config.db);

  const utils = utilsFactory(config.db);
  const session = {
    quiz_id: quizId,
    current_question_index: 0,
    players: {},
    hosts: [],
    displays: []
  };

  await utils.loadNextQuestion('910020', session);

  assert.ok(session.question, 'expected a loaded question');
  assert.equal(session.question.text, 'Was ist die Hauptstadt von Frankreich?');
  assert.deepEqual(session.question.options, ['Paris', 'Berlin', 'Rom', 'Madrid']);
  assert.equal(session.question.correct_option_index, 0);
});
