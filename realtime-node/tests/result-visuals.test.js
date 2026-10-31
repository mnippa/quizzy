const test = require('node:test');
const assert = require('node:assert/strict');

require('../../public/js/result-visuals');
const visuals = globalThis.QuizResultVisuals;

test('ranking bars escape names, use page offsets and show round gains', () => {
    const html = visuals.rankingBars([
        { rank: 11, name: '<b>Eve</b>', points: 500 },
        { rank: 12, name: 'Bob', points: 250 }
    ], {
        offset: 10,
        maxPoints: 1000,
        highlightRank: 12,
        trend: Object.assign(new Array(10).fill(null), { 10: { roundPoints: 120, movement: 3 }, 11: { roundPoints: 0, movement: -2 } })
    });

    assert.ok(html.includes('&lt;b&gt;Eve&lt;/b&gt;'));
    assert.ok(!html.includes('<b>Eve</b>'));
    assert.ok(html.includes('--w:50%'));
    assert.ok(html.includes('+120'));
    assert.ok(html.includes('rank-move is-up'));
    assert.ok(html.includes('rank-move is-down'));
    assert.match(html, /ranking-bar is-own[^>]*>\s*<span class="ranking-bar-rank">12/);
});

test('round placement explains podium, ties, pending reviews and zero points', () => {
    assert.match(visuals.roundPlacement({ status: 'correct', rank: 1, total: 80, points: 950, sharedWith: 0 }), /is-podium[\s\S]*Platz 1/);
    assert.match(visuals.roundPlacement({ status: 'correct', rank: 4, total: 80, points: 700, sharedWith: 2 }), /gleichauf mit 2 weiteren Personen/);
    assert.match(visuals.roundPlacement({ status: 'pending', rank: null, total: 80, points: 0 }), /nach der Bewertung/);
    assert.match(visuals.roundPlacement({ status: 'incorrect', rank: 30, total: 80, points: 0 }), /ohne Punkte/);
});

test('outcome chart highlights the own result and always lists the core outcomes', () => {
    const html = visuals.outcomeChart({ total: 4, correct: 3, partial: 0, incorrect: 1, noAnswer: 0, pendingReview: 0 }, { highlight: 'incorrect' });
    assert.ok(html.includes('Richtig'));
    assert.ok(html.includes('Keine Antwort'));
    assert.ok(!html.includes('Teilweise'));
    assert.match(html, /is-incorrect is-own/);
    assert.ok(html.includes('75%'));
    assert.equal(visuals.outcomeChart({ total: 0 }), '');
});
