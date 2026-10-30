(function (global) {
    'use strict';

    function createWsClient(config) {
        var socket = null;
        var callbacks = {
            onOpen: config.onOpen || function () {},
            onMessage: config.onMessage || function () {},
            onClose: config.onClose || function () {},
            onError: config.onError || function () {}
        };

        function buildUrl() {
            return 'ws://' + config.host + ':' + config.port;
        }

        function connect() {
            socket = new WebSocket(buildUrl());

            socket.onopen = function () {
                callbacks.onOpen();
            };

            socket.onmessage = function (event) {
                try {
                    var parsed = JSON.parse(event.data);
                    callbacks.onMessage(parsed);
                } catch (err) {
                    callbacks.onError(err);
                }
            };

            socket.onclose = function () {
                callbacks.onClose();
            };

            socket.onerror = function (err) {
                callbacks.onError(err);
            };
        }

        function send(payload) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                return false;
            }
            socket.send(JSON.stringify(payload));
            return true;
        }

        function close() {
            if (socket) {
                socket.close();
            }
        }

        function isOpen() {
            return !!socket && socket.readyState === WebSocket.OPEN;
        }

        return {
            connect: connect,
            send: send,
            close: close,
            isOpen: isOpen
        };
    }

    global.QuizzyWsClient = {
        create: createWsClient
    };
})(window);
