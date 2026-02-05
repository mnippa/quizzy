async function initDb(dbConfig) {
    const connection = await mysql.createConnection(dbConfig);
    
    // Session-Tabelle sicherstellen
    await connection.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
            pin VARCHAR(6) PRIMARY KEY,
            state VARCHAR(20) DEFAULT 'lobby',
            current_question_index INT DEFAULT 0
        )
    `);
    
    await connection.end();
}

module.exports = { initDb };
