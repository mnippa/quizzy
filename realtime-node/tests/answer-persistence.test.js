const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../config');
const { initDb } = require('../db');
const createUtils = require('../utils');

test('persists answer timing with exact millisecond precision', async () => {
    const config = loadConfig();
    await initDb(config.db);
    const utils = createUtils(config.db);
    const connection = await mysql.createConnection(config.db);
    const sessionPin = 'MS4079';
    const playerToken = 'answer-persistence-test';

    try {
        await connection.execute(
            'DELETE FROM session_answers WHERE session_pin = ? AND player_token = ?',
            [sessionPin, playerToken]
        );

        await utils.saveSessionAnswer(
            sessionPin,
            { playerToken },
            { id: 999999 },
            {
                submittedAnswer: { answerIndex: 0 },
                answerTimeMs: 4079,
                isCorrect: false,
                pointsAwarded: 0
            }
        );

        const [rows] = await connection.execute(`
            SELECT answer_payload, answer_time_ms, is_correct, points_awarded
            FROM session_answers
            WHERE session_pin = ? AND player_token = ? AND question_id = ?
        `, [sessionPin, playerToken, 999999]);

        assert.equal(rows.length, 1);
        assert.equal(Number(rows[0].answer_time_ms), 4079);
        assert.deepEqual(JSON.parse(rows[0].answer_payload), { answerIndex: 0 });
        assert.equal(Number(rows[0].is_correct), 0);
        assert.equal(Number(rows[0].points_awarded), 0);
    } finally {
        await connection.execute(
            'DELETE FROM session_answers WHERE session_pin = ? AND player_token = ?',
            [sessionPin, playerToken]
        );
        await connection.end();
    }
});