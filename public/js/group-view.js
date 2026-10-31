(function (root) {
    function filterParticipants(players, query) {
        const search = String(query || '').trim().toLocaleLowerCase('de');
        return (Array.isArray(players) ? players : [])
            .map((player, index) => ({ player, index }))
            .filter(entry => String(entry.player?.name || 'Spieler').toLocaleLowerCase('de').includes(search));
    }

    function rankingPage(entries, requestedPage, pageSize) {
        if (!Number.isInteger(pageSize) || pageSize < 1) {
            throw new Error('Die Seitengroesse muss eine positive ganze Zahl sein.');
        }
        const ranking = Array.isArray(entries) ? entries : [];
        const totalPages = Math.max(1, Math.ceil(ranking.length / pageSize));
        const page = Math.min(totalPages - 1, Math.max(0, Number.isInteger(requestedPage) ? requestedPage : 0));
        const offset = page * pageSize;
        return {
            items: ranking.slice(offset, offset + pageSize),
            page,
            totalPages,
            total: ranking.length,
            first: ranking.length ? offset + 1 : 0,
            last: Math.min(offset + pageSize, ranking.length)
        };
    }

    function placementText(placement) {
        const rank = Number(placement?.rank);
        const total = Number(placement?.total);
        if (!Number.isInteger(rank) || !Number.isInteger(total) || rank < 1 || rank > total) return '';
        return `Dein Platz: ${rank} von ${total}`;
    }

    const api = { filterParticipants, rankingPage, placementText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.QuizGroupView = api;
})(typeof window === 'undefined' ? null : window);
