const test = require('node:test');
const assert = require('node:assert/strict');

const createUtils = require('../utils');
const { broadcastLiveAnswerStats } = require('../quiz');

const utils = createUtils({});

function createSession(question = { id: 1, type: 'single_choice' }) {
  return {
    question,
    live_tracking_enabled: false,
    live_tracking_threshold: 1,
    players: {}
  };
}

function captureLiveStats(session) {
  const messages = [];
  const mockUtils = {
    buildLiveAnswerStats: utils.buildLiveAnswerStats,
    buildDisplayLiveAnswerStats: utils.buildDisplayLiveAnswerStats,
    broadcastToSession(_pin, message, _sessions, roles) {
      messages.push({ message, roles });
    }
  };

  broadcastLiveAnswerStats('910050', session, { '910050': session }, mockUtils);
  return messages;
}

test('live stats count only answers to the current question', () => {
  const session = createSession();
  session.players = {
    first: { id: 1, currentAnswer: { questionId: 1, isCorrect: true } },
    second: { id: 2, currentAnswer: { questionId: 1, isCorrect: false } },
    previous: { id: 3, currentAnswer: { questionId: 2, isCorrect: true } }
  };

  assert.deepEqual(utils.buildLiveAnswerStats(session), {
    total: 3,
    answered: 2,
    correct: 1,
    incorrect: 1,
    pendingReview: 0
  });
});

test('live stats move reviewed free-text answers from open to correct or incorrect', () => {
  const session = createSession({ id: 1, type: 'short_text' });
  session.players = {
    pending: { id: 1, currentAnswer: { questionId: 1, isCorrect: false, isReviewed: false } },
    correct: { id: 2, currentAnswer: { questionId: 1, isCorrect: true, isReviewed: true } },
    incorrect: { id: 3, currentAnswer: { questionId: 1, isCorrect: false, isReviewed: true } }
  };

  assert.deepEqual(utils.buildLiveAnswerStats(session), {
    total: 3,
    answered: 3,
    correct: 1,
    incorrect: 1,
    pendingReview: 1
  });
});

test('host always receives aggregates but disabled display receives no answer counts', () => {
  const session = createSession();
  session.players = {
    player: { id: 7, playerToken: 'private-token', currentAnswer: { questionId: 1, isCorrect: true } }
  };

  const messages = captureLiveStats(session);
  assert.deepEqual(messages.map(entry => entry.roles), [['host'], ['display']]);
  assert.deepEqual(messages[0].message.data, {
    total: 1,
    answered: 1,
    correct: 1,
    incorrect: 0,
    pendingReview: 0,
    enabled: false,
    threshold: 1,
    correctnessVisible: true
  });
  assert.deepEqual(messages[1].message.data, { enabled: false });
  assert.equal(JSON.stringify(messages[1]).includes('private-token'), false);
});

test('display correctness is hidden below thresholds 1 and 10 and visible at the boundary', () => {
  const session = createSession();
  for (let id = 1; id <= 10; id += 1) {
    session.players[id] = {
      id,
      playerToken: `private-${id}`,
      currentAnswer: id <= 9 ? { questionId: 1, isCorrect: id % 2 === 0 } : null
    };
  }
  session.live_tracking_enabled = true;
  session.live_tracking_threshold = 10;

  let displayMessage = captureLiveStats(session)[1].message;
  assert.equal(displayMessage.data.answered, 9);
  assert.equal(displayMessage.data.correctnessVisible, false);
  assert.equal(displayMessage.data.correct, 0);
  assert.equal(displayMessage.data.incorrect, 0);
  assert.equal(displayMessage.data.pendingReview, 0);

  session.live_tracking_threshold = 1;
  displayMessage = captureLiveStats(session)[1].message;
  assert.equal(displayMessage.data.correctnessVisible, true);

  session.players[10].currentAnswer = { questionId: 1, isCorrect: true };
  session.live_tracking_threshold = 10;
  displayMessage = captureLiveStats(session)[1].message;
  assert.equal(displayMessage.data.answered, 10);
  assert.equal(displayMessage.data.correctnessVisible, true);
  assert.deepEqual(Object.keys(displayMessage.data).sort(), [
    'answered', 'correct', 'correctnessVisible', 'enabled',
    'incorrect', 'pendingReview', 'threshold', 'total'
  ]);
  assert.equal(JSON.stringify(displayMessage).includes('private-'), false);
});

test('display snapshots hide correctness and counts when tracking is disabled', () => {
  const session = createSession();
  session.players = {
    player: { id: 5, currentAnswer: { questionId: 1, isCorrect: true } }
  };
  const stats = utils.buildLiveAnswerStats(session);
  assert.deepEqual(utils.buildDisplayLiveAnswerStats(stats, false, 1), { enabled: false });
  assert.deepEqual(utils.buildDisplayLiveAnswerStats(stats, true, 10), {
    total: 1,
    answered: 1,
    correct: 0,
    incorrect: 0,
    pendingReview: 0,
    enabled: true,
    threshold: 10,
    correctnessVisible: false
  });
});
