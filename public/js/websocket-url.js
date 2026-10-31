(function (root) {
    function getQuizWebSocketUrl(location, host, port, path = '/ws') {
        if (location.protocol === 'https:') {
            const wsPath = String(path || '/ws');
            return `wss://${location.host}${wsPath.startsWith('/') ? wsPath : `/${wsPath}`}`;
        }

        return `ws://${host}:${port}`;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = getQuizWebSocketUrl;
    }
    if (root) {
        root.getQuizWebSocketUrl = getQuizWebSocketUrl;
    }
})(typeof window === 'undefined' ? null : window);
