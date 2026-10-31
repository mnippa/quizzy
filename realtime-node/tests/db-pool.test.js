const test = require('node:test');
const assert = require('node:assert/strict');
const { createDbPool } = require('../db');

test('database pool bounds connections and queues overflow', async () => {
    const config = {
        host: '127.0.0.1',
        user: 'quizzy-test',
        password: '',
        database: 'quizzy-test',
        connectionLimit: 4
    };

    const pool = createDbPool(config);
    try {
        assert.equal(pool.pool.config.connectionLimit, 4);
        assert.equal(pool.pool.config.waitForConnections, true);
        assert.equal(pool.pool.config.queueLimit, 0);
    } finally {
        await pool.end();
    }
});
