(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    root.StatusUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function normalizeState(state) {
        const value = String(state || '').toLowerCase();
        if (['online', 'connected', 'verbunden'].includes(value)) return 'online';
        if (['ready', 'bereit', 'lobby', 'lobby_ready', 'offen', 'start'].includes(value)) return 'ready';
        if (['options', 'antwortmoeglichkeiten', 'antwortmöglichkeiten'].includes(value)) return 'options';
        if (['running', 'active', 'frage', 'frage_laeuft', 'question', 'antwort', 'answer'].includes(value)) return 'running';
        if (['solution', 'lösung', 'show_solution', 'ergebnis'].includes(value)) return 'solution';
        if (['finished', 'ende', 'quiz_beendet', 'geschlossen', 'endresult', 'endergebnis'].includes(value)) return 'finished';
        if (['offline', 'disconnected', 'getrennt'].includes(value)) return 'offline';
        return value || 'ready';
    }

    function resolveStatusText(text, state, role) {
        const normalizedState = normalizeState(state);
        const baseText = String(text || '').trim();

        if (role === 'host') {
            if (normalizedState === 'online') return baseText || 'Verbunden';
            if (normalizedState === 'ready') return baseText || 'Lobby bereit';
            if (normalizedState === 'options') return baseText || 'Antwortmöglichkeiten';
            if (normalizedState === 'running') return baseText || 'Frage läuft';
            if (normalizedState === 'solution') return baseText || 'Lösung';
            if (normalizedState === 'finished') return baseText || 'Beendet';
            if (normalizedState === 'offline') return baseText || 'Offline';
            return baseText || 'Status';
        }

        if (normalizedState === 'online') return baseText || 'Verbunden';
        if (normalizedState === 'ready') return baseText || 'Bereit';
        if (normalizedState === 'options') return baseText || 'Antwortmöglichkeiten';
        if (normalizedState === 'running') return baseText || 'Frage läuft';
        if (normalizedState === 'solution') return baseText || 'Lösung';
        if (normalizedState === 'finished') return baseText || 'Quiz beendet';
        if (normalizedState === 'offline') return baseText || 'Offline';
        return baseText || 'Status';
    }

    return {
        normalizeState,
        resolveStatusText
    };
});
