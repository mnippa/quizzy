const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerQuestionType,
  getQuestionType,
  buildPublicQuestion,
  buildSolution
} = require('../question-types');

test('base question types normalize, validate, and evaluate through one contract', () => {
  const cases = [
    ['single_choice', { correct_option_index: 2 }, { answerIndex: '2' }, true],
    ['true_false', { correct_option_index: 0 }, { answerIndex: 1 }, false],
    ['multiple_choice', { correct_option_indices: [2, 0] }, { selectedIndices: [0, 2, 2] }, true],
    ['short_text', { accepted_answers: ['php'] }, { answerText: ' PHP ' }, true]
  ];

  for (const [type, questionData, message, expected] of cases) {
    const question = { id: 1, type, text: 'Test', answer_payload: ['secret'], ...questionData };
    const definition = getQuestionType(question);
    assert.equal(typeof definition.editor.label, 'string');
    assert.equal(typeof definition.editor.answerKind, 'string');
    const submission = definition.normalizeSubmission(message);
    assert.equal(definition.validateQuestion(question), true);
    assert.equal(definition.evaluate(question, submission), expected);
    const publicQuestion = buildPublicQuestion(question);
    assert.equal('answer_payload' in publicQuestion, false);
    assert.equal('correct_option_index' in publicQuestion, false);
    assert.equal('correct_option_indices' in publicQuestion, false);
    assert.equal('accepted_answers' in publicQuestion, false);
    assert.equal(buildSolution(question).type, type);
  }
});

test('unknown types are rejected explicitly', () => {
  assert.throws(() => getQuestionType('not_registered'), /unknown question type/i);
});

test('a reference type is added without changing the central router', () => {
  registerQuestionType('numeric_reference', {
    editor: { label: 'Zahl', answerKind: 'number' },
    normalizeSubmission: message => ({ value: Number(message.value) }),
    evaluate: (question, answer) => answer.value === Number(question.expected_value),
    validateQuestion: question => Number.isFinite(Number(question.expected_value)),
    buildSolution: question => ({ expectedValue: Number(question.expected_value) })
  });

  const question = { type: 'numeric_reference', text: '2 + 2', expected_value: 4 };
  const definition = getQuestionType(question);
  assert.equal(definition.evaluate(question, definition.normalizeSubmission({ value: '4' })), true);
  assert.equal(buildSolution(question).expectedValue, 4);
});