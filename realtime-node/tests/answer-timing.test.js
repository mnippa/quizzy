const test = require('node:test');
const assert = require('node:assert/strict');

const { getAnswerTimeMs, buildPublicQuestion } = require('../quiz');

test('captures answer duration as an exact integer millisecond difference', () => {
    assert.equal(getAnswerTimeMs(1_000_000, 1_001_234), 1234);
    assert.equal(getAnswerTimeMs(1_000_000, 1_001_235), 1235);
    assert.equal(getAnswerTimeMs(1_000_000, 1_000_001), 1);
});

test('public question does not reveal solution fields before solution phase', () => {
    const publicQuestion = buildPublicQuestion({
        id: 42,
        text: 'Testfrage',
        options: ['A', 'B'],
        correct_option_index: 1,
        correct_option_indices: [1],
        accepted_answers: ['b'],
        answer_payload: [1]
    });

    assert.deepEqual(publicQuestion, {
        id: 42,
        text: 'Testfrage',
        options: ['A', 'B']
    });
});