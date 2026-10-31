const mysql = require('mysql2/promise');
const { loadConfig } = require('./config');

(async () => {
  try {
    const connection = await mysql.createConnection(loadConfig().db);

    const [rows] = await connection.execute(
      'SELECT pin, quiz_id, state, created_at FROM sessions ORDER BY created_at DESC LIMIT 1'
    );

    await connection.end();

    if (rows.length > 0) {
      console.log('MOST_RECENT_SESSION:', JSON.stringify(rows[0]));
    } else {
      console.log('NO_SESSIONS_FOUND');
    }
  } catch (error) {
    console.error('DB_ERROR:', error.message);
    process.exit(1);
  }
})();
