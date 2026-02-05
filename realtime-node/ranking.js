function getRanking(players) {
    return Object.values(players)
        .sort((a, b) => b.points - a.points)
        .map((player, index) => ({
            rank: index + 1,
            name: player.name,
            points: player.points
        }));
}

module.exports = { getRanking };
