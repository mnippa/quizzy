const mysql = require('mysql2/promise');
const { loadConfig } = require('../config');
const { initDb } = require('../db');

const SOURCE_TITLE = 'Deutschland-Quiz';
const TARGET_TITLE = 'Deutschland-Quiz Automatisch';

async function cloneAutomaticQuiz() {
    const config = loadConfig();
    await initDb(config.db);

    const connection = await mysql.createConnection(config.db);
    await connection.beginTransaction();

    try {
        const [sourceRows] = await connection.execute(
            'SELECT id, description, image_url FROM quizzes WHERE title = ? ORDER BY id LIMIT 1',
            [SOURCE_TITLE]
        );
        if (!sourceRows.length) {
            throw new Error(`Source quiz not found: ${SOURCE_TITLE}`);
        }

        const source = sourceRows[0];
        const [existingRows] = await connection.execute(
            'SELECT id FROM quizzes WHERE title = ? ORDER BY id LIMIT 1',
            [TARGET_TITLE]
        );

        let targetQuizId;
        if (existingRows.length) {
            targetQuizId = Number(existingRows[0].id);
            await connection.execute('DELETE FROM questions WHERE quiz_id = ?', [targetQuizId]);
            await connection.execute(`
                UPDATE quizzes
                SET description = ?, image_url = ?, automatic_mode = 1,
                    start_phase_seconds = 2, question_phase_seconds = 2,
                    options_phase_seconds = 2, solution_phase_seconds = 2
                WHERE id = ?
            `, [source.description, source.image_url, targetQuizId]);
        } else {
            const [insertQuiz] = await connection.execute(`
                INSERT INTO quizzes (
                    title, description, image_url, automatic_mode,
                    start_phase_seconds, question_phase_seconds, options_phase_seconds, solution_phase_seconds
                ) VALUES (?, ?, ?, 1, 2, 2, 2, 2)
            `, [TARGET_TITLE, source.description, source.image_url]);
            targetQuizId = Number(insertQuiz.insertId);
        }

        const [questions] = await connection.execute(`
            SELECT id, question_text, image_url, position, text, question_type,
                correct_option_index, answer_payload, points_max, points_min, points_delay
            FROM questions
            WHERE quiz_id = ?
            ORDER BY position, id
        `, [source.id]);

        for (const question of questions) {
            const [insertQuestion] = await connection.execute(`
                INSERT INTO questions (
                    quiz_id, question_text, image_url, position, text, question_type,
                    correct_option_index, answer_payload, time_limit, points_max,
                    points_min, points_delay, points_decay_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, 10)
            `, [
                targetQuizId,
                question.question_text,
                question.image_url,
                question.position,
                question.text,
                question.question_type,
                question.correct_option_index,
                question.answer_payload,
                question.points_max,
                question.points_min,
                question.points_delay
            ]);

            const [options] = await connection.execute(
                'SELECT option_text, option_index FROM question_options WHERE question_id = ? ORDER BY option_index',
                [question.id]
            );
            for (const option of options) {
                await connection.execute(
                    'INSERT INTO question_options (question_id, option_text, option_index) VALUES (?, ?, ?)',
                    [insertQuestion.insertId, option.option_text, option.option_index]
                );
            }
        }

        await connection.commit();
        console.log(JSON.stringify({
            targetQuizId,
            title: TARGET_TITLE,
            questionCount: questions.length,
            phases: { start: 2, question: 2, options: 2, answer: 10, solution: 2 }
        }));
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

cloneAutomaticQuiz().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});