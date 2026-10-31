function getRankingData(players) {
    const rankedPlayers = Object.values(players || {}).sort((a, b) => {
        const pointsDifference = b.points - a.points;
        if (pointsDifference !== 0) return pointsDifference;
        if (Number.isSafeInteger(a.databaseId) && Number.isSafeInteger(b.databaseId)) {
            return a.databaseId - b.databaseId;
        }
        return 0;
    });
    return {
        ranking: rankedPlayers.map((player, index) => ({
            rank: index + 1,
            name: player.name,
            points: player.points
        })),
        placements: new Map(rankedPlayers.map((player, index) => [
            player,
            { rank: index + 1, total: rankedPlayers.length }
        ]))
    };
}

function getRanking(players) {
    return getRankingData(players).ranking;
}

module.exports = { getRanking, getRankingData };
