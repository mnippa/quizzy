const test = require('node:test');
const assert = require('node:assert/strict');
const groupView = require('../../public/js/group-view');
const { getRanking, getRankingData } = require('../ranking');

test('participant search keeps original positions and matches names case-insensitively', () => {
    const players = Array.from({ length: 101 }, (_, index) => ({
        id: index + 1,
        name: `Spieler-${String(index + 1).padStart(3, '0')}`
    }));
    players[50].name = 'Änne <Test>';

    assert.equal(groupView.filterParticipants(players, '').length, 101);
    assert.deepEqual(groupView.filterParticipants(players, ' äNNE '), [{ player: players[50], index: 50 }]);
    assert.deepEqual(groupView.filterParticipants(players, 'spieler-100'), [{ player: players[99], index: 99 }]);
    assert.deepEqual(groupView.filterParticipants(players, 'nicht vorhanden'), []);
});

test('ranking pages cover all 101 entries exactly once and clamp page indices', () => {
    const ranking = Array.from({ length: 101 }, (_, index) => ({ rank: index + 1 }));
    const pages = Array.from({ length: 11 }, (_, page) => groupView.rankingPage(ranking, page, 10));

    assert.equal(pages[0].first, 1);
    assert.equal(pages[0].last, 10);
    assert.equal(pages[10].first, 101);
    assert.equal(pages[10].last, 101);
    assert.equal(pages[10].totalPages, 11);
    assert.deepEqual(pages.flatMap(page => page.items), ranking);
    assert.equal(groupView.rankingPage(ranking, -4, 10).page, 0);
    assert.equal(groupView.rankingPage(ranking, 100, 10).page, 10);
    assert.deepEqual(groupView.rankingPage([], 3, 10), {
        items: [], page: 0, totalPages: 1, total: 0, first: 0, last: 0
    });
    assert.throws(() => groupView.rankingPage(ranking, 0, 0), /positive ganze Zahl/);
});

test('personal placements are valid only for a rank inside the field', () => {
    assert.equal(groupView.placementText({ rank: 51, total: 101 }), 'Dein Platz: 51 von 101');
    assert.equal(groupView.placementText({ rank: 0, total: 101 }), '');
    assert.equal(groupView.placementText({ rank: 102, total: 101 }), '');
    assert.equal(groupView.placementText(null), '');
});

test('ranking placements use player identity while public entries retain their original shape', () => {
    const alice = { name: 'Gleicher Name', points: 10, playerToken: 'secret-a' };
    const bob = { name: 'Gleicher Name', points: 40, playerToken: 'secret-b' };
    const noAnswer = { name: 'Ohne Antwort', points: 0, playerToken: 'secret-c' };
    const players = { alice, bob, noAnswer };
    const data = getRankingData(players);

    assert.deepEqual(data.ranking, [
        { rank: 1, name: 'Gleicher Name', points: 40 },
        { rank: 2, name: 'Gleicher Name', points: 10 },
        { rank: 3, name: 'Ohne Antwort', points: 0 }
    ]);
    assert.deepEqual(getRanking(players), data.ranking);
    assert.deepEqual(data.placements.get(alice), { rank: 2, total: 3 });
    assert.deepEqual(data.placements.get(bob), { rank: 1, total: 3 });
    assert.deepEqual(data.placements.get(noAnswer), { rank: 3, total: 3 });
    assert.equal(JSON.stringify(data.ranking).includes('secret'), false);
    assert.deepEqual(getRankingData({}).ranking, []);
});

test('equal scores retain their order when player connections are replaced', () => {
    const first = { name: 'First', points: 0, databaseId: 10 };
    const second = { name: 'Second', points: 0, databaseId: 11 };
    const third = { name: 'Third', points: 0, databaseId: 12 };
    const initial = getRankingData({ 1: first, 2: second, 3: third });
    const reconnected = getRankingData({ 2: second, 3: third, 4: first });

    assert.deepEqual(initial.ranking, reconnected.ranking);
    assert.deepEqual(reconnected.placements.get(first), { rank: 1, total: 3 });
});
