const questionTypes = require('./question-types');
const { getRankingData } = require('./ranking');

const RANKING_RELEASE_VIEWS = new Set(['top10', 'ranking']);
const FINISHED_STATES = new Set(['finished', 'endresult']);
const ROUND_TOP_LIMIT = 5;

function isRankingReleased(session) {
    if (!session) return false;
    if (FINISHED_STATES.has(String(session.state || '').toLowerCase())) return true;
    return session.state === 'solution' && RANKING_RELEASE_VIEWS.has(String(session.presentation_view || ''));
}

function getQuestionId(session) {
    return Number(session?.question?.id || 0);
}

function getRoundAnswer(player, questionId) {
    if (!questionId || Number(player?.currentAnswer?.questionId) !== questionId) return null;
    return player.currentAnswer;
}

function requiresReview(question) {
    if (!question) return false;
    try {
        return Boolean(questionTypes.getQuestionType(question).requiresReview);
    } catch (error) {
        return false;
    }
}

function classifyAnswer(answer, reviewRequired) {
    if (!answer) return 'no_answer';
    if (reviewRequired && !answer.isReviewed) return 'pending';
    if (answer.isCorrect) return 'correct';
    if (reviewRequired && Number(answer.pointsAwarded || 0) > 0) return 'partial';
    return 'incorrect';
}

function getSelectedIndices(submittedAnswer) {
    if (Array.isArray(submittedAnswer?.selectedIndices)) {
        return submittedAnswer.selectedIndices.map(Number).filter(Number.isInteger);
    }
    const index = Number(submittedAnswer?.answerIndex);
    return Number.isInteger(index) && submittedAnswer?.answerIndex !== null ? [index] : [];
}

function getRoundPoints(answer) {
    return answer ? Math.max(0, Number(answer.pointsAwarded || 0)) : 0;
}

function sortRoundEntries(entries) {
    return entries.sort((a, b) => {
        const pointsDifference = b.points - a.points;
        if (pointsDifference !== 0) return pointsDifference;
        const timeA = Number.isFinite(a.answerTimeMs) ? a.answerTimeMs : Number.MAX_SAFE_INTEGER;
        const timeB = Number.isFinite(b.answerTimeMs) ? b.answerTimeMs : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
    });
}

// Players with equal round points share a rank (1, 2, 2, 4), so 0-point players are not ordered arbitrarily.
function buildRoundData(session) {
    const players = Object.values(session?.players || {});
    const question = session?.question || null;
    const questionId = getQuestionId(session);
    const reviewRequired = requiresReview(question);
    const optionCount = Array.isArray(question?.options) ? question.options.length : 0;
    const optionCounts = optionCount > 0 ? Array(optionCount).fill(0) : null;
    const counts = { correct: 0, partial: 0, incorrect: 0, noAnswer: 0, pendingReview: 0 };
    let answerTimeTotal = 0;
    let answered = 0;
    let pointsAwarded = 0;

    const entries = players.map(player => {
        const answer = getRoundAnswer(player, questionId);
        const status = classifyAnswer(answer, reviewRequired);
        if (status === 'no_answer') counts.noAnswer += 1;
        else if (status === 'pending') counts.pendingReview += 1;
        else counts[status] += 1;
        if (answer) {
            answered += 1;
            answerTimeTotal += Math.max(0, Number(answer.answerTimeMs || 0));
            if (optionCounts) {
                getSelectedIndices(answer.submittedAnswer).forEach(index => {
                    if (index >= 0 && index < optionCounts.length) optionCounts[index] += 1;
                });
            }
        }
        const points = getRoundPoints(answer);
        pointsAwarded += points;
        return {
            player,
            status,
            points,
            answerTimeMs: answer ? Number(answer.answerTimeMs || 0) : null
        };
    });

    sortRoundEntries(entries);
    const placements = new Map();
    let previousPoints = null;
    let currentRank = 0;
    entries.forEach((entry, index) => {
        if (entry.points !== previousPoints) {
            currentRank = index + 1;
            previousPoints = entry.points;
        }
        entry.rank = currentRank;
    });
    const sharedCounts = new Map();
    entries.forEach(entry => sharedCounts.set(entry.rank, (sharedCounts.get(entry.rank) || 0) + 1));
    entries.forEach(entry => {
        placements.set(entry.player, {
            status: entry.status,
            points: entry.points,
            answerTimeMs: entry.answerTimeMs,
            rank: entry.status === 'pending' ? null : entry.rank,
            total: entries.length,
            sharedWith: entry.status === 'pending' ? 0 : Math.max(0, sharedCounts.get(entry.rank) - 1)
        });
    });

    return {
        stats: {
            questionId: questionId || null,
            total: players.length,
            answered,
            ...counts,
            optionCounts,
            averageTimeMs: answered ? Math.round(answerTimeTotal / answered) : 0,
            pointsAwarded,
            requiresReview: reviewRequired
        },
        top: entries
            .filter(entry => entry.points > 0)
            .slice(0, ROUND_TOP_LIMIT)
            .map(entry => ({
                rank: entry.rank,
                name: entry.player.name,
                points: entry.points,
                answerTimeMs: entry.answerTimeMs
            })),
        placements
    };
}

function buildRankingTrend(session, rankingData = getRankingData(session?.players)) {
    const questionId = getQuestionId(session);
    const isFirstQuestion = Number(session?.current_question_index || 0) === 0;
    const players = [...rankingData.placements.keys()];
    const previous = players
        .map(player => ({ player, points: Number(player.points || 0) - getRoundPoints(getRoundAnswer(player, questionId)) }))
        .sort((a, b) => {
            const pointsDifference = b.points - a.points;
            if (pointsDifference !== 0) return pointsDifference;
            if (Number.isSafeInteger(a.player.databaseId) && Number.isSafeInteger(b.player.databaseId)) {
                return a.player.databaseId - b.player.databaseId;
            }
            return 0;
        });
    const previousRanks = new Map(previous.map((entry, index) => [entry.player, index + 1]));
    const trendByPlayer = new Map(players.map(player => {
        const rank = rankingData.placements.get(player).rank;
        return [player, {
            roundPoints: getRoundPoints(getRoundAnswer(player, questionId)),
            movement: isFirstQuestion || !questionId ? null : previousRanks.get(player) - rank
        }];
    }));
    return {
        trend: players.map(player => trendByPlayer.get(player)),
        byPlayer: trendByPlayer
    };
}

function buildOwnStanding(player, rankingData, trendData) {
    const placement = rankingData.placements.get(player);
    if (!placement) return null;
    const trend = trendData.byPlayer.get(player) || {};
    return {
        rank: placement.rank,
        total: placement.total,
        points: Number(player.points || 0),
        roundPoints: trend.roundPoints || 0,
        movement: trend.movement ?? null
    };
}

function buildPublicRoundPayload(session, rankingData = getRankingData(session?.players), roundData = buildRoundData(session)) {
    return {
        roundStats: roundData.stats,
        roundTop: roundData.top,
        rankingTrend: buildRankingTrend(session, rankingData).trend
    };
}

function buildPlayerRoundPayload(session, player, options = {}) {
    const rankingData = options.rankingData || getRankingData(session?.players);
    const roundData = options.roundData || buildRoundData(session);
    const released = isRankingReleased(session);
    const payload = {
        roundStats: roundData.stats,
        roundResult: roundData.placements.get(player) || null,
        rankingReleased: released
    };
    if (released) {
        const trendData = options.trendData || buildRankingTrend(session, rankingData);
        payload.ranking = String(session?.presentation_view) === 'top10' && !FINISHED_STATES.has(session?.state)
            ? rankingData.ranking.slice(0, 10)
            : rankingData.ranking;
        payload.rankingTrend = trendData.trend.slice(0, payload.ranking.length);
        payload.ownPlacement = rankingData.placements.get(player) || null;
        payload.ownStanding = buildOwnStanding(player, rankingData, trendData);
    }
    return payload;
}

module.exports = {
    RANKING_RELEASE_VIEWS,
    isRankingReleased,
    buildRoundData,
    buildRankingTrend,
    buildPublicRoundPayload,
    buildPlayerRoundPayload
};
