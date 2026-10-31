const mysql = require('mysql2/promise');

async function withConnection(dbConfig, callback) {
  const connection = await mysql.createConnection({
    ...dbConfig,
    charset: dbConfig.charset || 'utf8mb4'
  });

  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function cleanupSessions(dbConfig, pins) {
  if (!pins.length) return;

  await withConnection(dbConfig, async connection => {
    const placeholders = pins.map(() => '?').join(', ');
    const dependentTables = [
      'session_answers',
      'short_text_reviews',
      'session_results',
      'session_players'
    ];

    for (const table of dependentTables) {
      await connection.execute(`DELETE FROM ${table} WHERE session_pin IN (${placeholders})`, pins);
    }

    await connection.execute(`DELETE FROM sessions WHERE pin IN (${placeholders})`, pins);
  });
}

async function findTestQuizId(dbConfig) {
  return withConnection(dbConfig, async connection => {
    const [quizRows] = await connection.execute(`
      SELECT q.id
      FROM quizzes q
      INNER JOIN questions question ON question.quiz_id = q.id
      GROUP BY q.id, q.title
      HAVING COUNT(question.id) >= 2
      ORDER BY (q.title = 'Quizzy Demo') DESC, q.id
      LIMIT 1
    `);

    if (!quizRows.length) {
      throw new Error('No quiz with at least two questions is available for workflow tests.');
    }

    return Number(quizRows[0].id);
  });
}

async function createSessions(dbConfig, pins) {
  await cleanupSessions(dbConfig, pins);
  const quizId = await findTestQuizId(dbConfig);

  await withConnection(dbConfig, async connection => {
    for (const pin of pins) {
      await connection.execute(
        "INSERT INTO sessions (pin, quiz_id, state, current_question_index) VALUES (?, ?, 'lobby', 0)",
        [pin, quizId]
      );
    }
  });
}

module.exports = {
  cleanupSessions,
  createSessions,
  findTestQuizId
};