const test = require('node:test');
const assert = require('node:assert/strict');

const roundResults = require('../round-results');
const { getRankingData } = require('../ranking');

function player(id, name, points, answer = null) {
  return { id, databaseId: id, name, points, currentAnswer: answer, playerToken: `secret-${id}` };
}

function choiceSession(overrides = {}) {
  const question = { id: 46, type: 'multiple_choice', options: ['A', 'B', 'C', 'D'] };
  const players = {
    1: player(1, 'Anna', 900, { questionId: 46, submittedAnswer: { selectedIndices: [0, 2] }, answerTimeMs: 1200, isCorrect: true, pointsAwarded: 600 }),
    2: player(2, 'Ben', 1000, { questionId: 46, submittedAnswer: { selectedIndices: [0, 2] }, answerTimeMs: 800, isCorrect: true, pointsAwarded: 600 }),
    3: player(3, 'Cleo', 1200, { questionId: 46, submittedAnswer: { selectedIndices: [1] }, answerTimeMs: 500, isCorrect: false, pointsAwarded: 0 }),
    4: player(4, 'Dora', 50, { questionId: 45, submittedAnswer: { answerIndex: 1 }, answerTimeMs: 400, isCorrect: true, pointsAwarded: 50 })
  };
  return { state: 'solution', presentation_view: 'solution', current_question_index: 2, question, players, ...overrides };
}

test('round data counts outcomes and option choices and shares ranks on equal points', () => {
  const session = choiceSession();
  const round = roundResults.buildRoundData(session);

  assert.deepEqual(
    { total: round.stats.total, answered: round.stats.answered, correct: round.stats.correct, incorrect: round.stats.incorrect, noAnswer: round.stats.noAnswer },
    { total: 4, answered: 3, correct: 2, incorrect: 1, noAnswer: 1 }
  );
  assert.deepEqual(round.stats.optionCounts, [2, 1, 2, 0]);
  assert.equal(round.stats.pointsAwarded, 1200);
  assert.equal(round.stats.averageTimeMs, Math.round((1200 + 800 + 500) / 3));

  const anna = round.placements.get(session.players[1]);
  const ben = round.placements.get(session.players[2]);
  const cleo = round.placements.get(session.players[3]);
  const dora = round.placements.get(session.players[4]);
  assert.deepEqual([anna.rank, ben.rank, cleo.rank, dora.rank], [1, 1, 3, 3]);
  assert.equal(anna.sharedWith, 1);
  assert.equal(dora.status, 'no_answer', 'answers to earlier questions must not count for this round');
  assert.equal(dora.points, 0);
  assert.deepEqual(round.top.map(entry => entry.name), ['Ben', 'Anna'], 'faster answers lead equal round points');
  assert.equal(JSON.stringify(round.top).includes('secret-'), false);
});

test('free text answers stay pending until reviewed', () => {
  const session = {
    state: 'solution',
    question: { id: 47, type: 'short_text', options: [] },
    players: {
      1: player(1, 'Pending', 0, { questionId: 47, submittedAnswer: { answerText: 'php' }, answerTimeMs: 900, isCorrect: false, pointsAwarded: 0 }),
      2: player(2, 'Partial', 30, { questionId: 47, submittedAnswer: { answerText: 'ph' }, answerTimeMs: 900, isCorrect: false, pointsAwarded: 30, isReviewed: true })
    }
  };
  const round = roundResults.buildRoundData(session);
  assert.equal(round.stats.pendingReview, 1);
  assert.equal(round.stats.partial, 1);
  assert.equal(round.stats.optionCounts, null);
  assert.equal(round.placements.get(session.players[1]).rank, null);
  assert.equal(round.placements.get(session.players[1]).status, 'pending');
  assert.equal(round.placements.get(session.players[2]).rank, 1);
});

test('ranking trend reports movement caused by the current round', () => {
  const session = {
    state: 'solution',
    current_question_index: 3,
    question: { id: 44, type: 'single_choice', options: ['A', 'B'] },
    players: {
      1: player(1, 'Leader before', 500, { questionId: 44, submittedAnswer: { answerIndex: 1 }, answerTimeMs: 700, isCorrect: false, pointsAwarded: 0 }),
      2: player(2, 'Climber', 700, { questionId: 44, submittedAnswer: { answerIndex: 0 }, answerTimeMs: 600, isCorrect: true, pointsAwarded: 300 }),
      3: player(3, 'Silent', 350)
    }
  };
  const rankingData = getRankingData(session.players);
  const trend = roundResults.buildRankingTrend(session, rankingData).trend;
  assert.deepEqual(rankingData.ranking.map(entry => entry.name), ['Climber', 'Leader before', 'Silent']);
  assert.deepEqual(trend, [
    { roundPoints: 300, movement: 1 },
    { roundPoints: 0, movement: -1 },
    { roundPoints: 0, movement: 0 }
  ]);

  const first = roundResults.buildRankingTrend({ ...session, current_question_index: 0 });
  assert.ok(first.trend.every(entry => entry.movement === null));
});

test('players only receive overall standings after the host releases them', () => {
  const session = choiceSession();
  const anna = session.players[1];
  const hidden = roundResults.buildPlayerRoundPayload(session, anna);
  assert.equal(hidden.rankingReleased, false);
  assert.equal(Object.hasOwn(hidden, 'ranking'), false);
  assert.equal(Object.hasOwn(hidden, 'ownPlacement'), false);
  assert.equal(hidden.roundResult.rank, 1);
  assert.equal(JSON.stringify(hidden).includes('Ben'), false, 'other player names stay private in the round view');

  session.presentation_view = 'top10';
  const top10 = roundResults.buildPlayerRoundPayload(session, anna);
  assert.equal(top10.rankingReleased, true);
  assert.equal(top10.ranking.length, 4);
  assert.deepEqual(top10.ownPlacement, { rank: 3, total: 4 });
  assert.deepEqual(top10.ownStanding, { rank: 3, total: 4, points: 900, roundPoints: 600, movement: 0 });

  session.presentation_view = 'free_text';
  assert.equal(roundResults.buildPlayerRoundPayload(session, anna).rankingReleased, false);
  assert.equal(roundResults.isRankingReleased({ state: 'finished', presentation_view: 'solution' }), true);
  assert.equal(roundResults.isRankingReleased({ state: 'answer', presentation_view: 'ranking' }), false);
});
