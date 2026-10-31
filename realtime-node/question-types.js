const registry = new Map();

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeIndex(value) {
    const index = Number(value);
    return Number.isInteger(index) ? index : null;
}

function normalizeIndices(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(normalizeIndex).filter(index => index !== null))].sort((a, b) => a - b);
}

function registerQuestionType(name, definition) {
    const type = String(name || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(type)) {
        throw new Error('Invalid question type name.');
    }
    const requiredMethods = ['normalizeSubmission', 'evaluate', 'validateQuestion'];
    if (!definition || !definition.editor || requiredMethods.some(method => typeof definition[method] !== 'function')) {
        throw new Error(`Incomplete question type contract: ${type}`);
    }
    registry.set(type, Object.freeze({ ...definition, type }));
    return registry.get(type);
}

function getQuestionType(questionOrType) {
    const rawType = typeof questionOrType === 'string'
        ? questionOrType
        : questionOrType?.type || questionOrType?.question_type || 'single_choice';
    const type = String(rawType || '').trim().toLowerCase();
    const definition = registry.get(type);
    if (!definition) {
        throw new Error(`Unknown question type: ${type || '(empty)'}`);
    }
    return definition;
}

function stripSolutions(question) {
    const {
        correct_option_index,
        correct_option_indices,
        accepted_answers,
        answer_payload,
        ...publicQuestion
    } = question || {};
    return publicQuestion;
}

function buildPublicQuestion(question) {
    if (!question) return null;
    const definition = getQuestionType(question);
    return definition.buildPublicQuestion
        ? definition.buildPublicQuestion(question)
        : stripSolutions(question);
}

function buildSolution(question) {
    const definition = getQuestionType(question);
    return {
        question,
        type: definition.type,
        ...(definition.buildSolution ? definition.buildSolution(question) : {})
    };
}

registerQuestionType('single_choice', {
    editor: { label: 'Single Choice', answerKind: 'single_option' },
    normalizeSubmission: message => ({ answerIndex: normalizeIndex(message?.answerIndex) }),
    evaluate: (question, answer) => answer.answerIndex !== null
        && answer.answerIndex === normalizeIndex(question.correct_option_index),
    validateQuestion: question => normalizeIndex(question.correct_option_index) !== null,
    buildSolution: question => ({ correctOptionIndex: normalizeIndex(question.correct_option_index) })
});

registerQuestionType('true_false', {
    editor: { label: 'Wahr/Falsch', answerKind: 'boolean_option' },
    normalizeSubmission: message => ({ answerIndex: normalizeIndex(message?.answerIndex) }),
    evaluate: (question, answer) => answer.answerIndex !== null
        && answer.answerIndex === normalizeIndex(question.correct_option_index),
    validateQuestion: question => [0, 1].includes(normalizeIndex(question.correct_option_index)),
    buildSolution: question => ({ correctOptionIndex: normalizeIndex(question.correct_option_index) })
});

registerQuestionType('multiple_choice', {
    editor: { label: 'Multiple Choice', answerKind: 'multiple_options' },
    normalizeSubmission: message => ({ selectedIndices: normalizeIndices(message?.selectedIndices) }),
    evaluate: (question, answer) => {
        const correct = normalizeIndices(question.correct_option_indices || question.answer_payload);
        return answer.selectedIndices.length === correct.length
            && answer.selectedIndices.every((value, index) => value === correct[index]);
    },
    validateQuestion: question => normalizeIndices(question.correct_option_indices || question.answer_payload).length > 0,
    buildSolution: question => ({
        correctOptionIndices: normalizeIndices(question.correct_option_indices || question.answer_payload)
    })
});

registerQuestionType('short_text', {
    editor: { label: 'Freitext', answerKind: 'accepted_texts' },
    normalizeSubmission: message => ({ answerText: String(message?.answerText || '').trim() }),
    evaluate: (question, answer) => {
        const accepted = Array.isArray(question.accepted_answers)
            ? question.accepted_answers.map(normalizeText)
            : [];
        return accepted.includes(normalizeText(answer.answerText));
    },
    validateQuestion: question => Array.isArray(question.accepted_answers || question.answer_payload),
    requiresReview: true,
    buildSolution: question => ({ acceptedAnswers: question.accepted_answers || question.answer_payload || [] })
});

module.exports = {
    registerQuestionType,
    getQuestionType,
    buildPublicQuestion,
    buildSolution
};