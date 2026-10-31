const fs = require('fs');
const path = require('path');

function findEnvFile() {
    const candidates = [
        path.resolve(__dirname, '..', '.env'),
        path.resolve(__dirname, '.env')
    ];

    return candidates.find(filePath => fs.existsSync(filePath)) || candidates[0];
}

function parseEnvFile(filePath) {
    const values = {};

    if (!filePath || !fs.existsSync(filePath)) {
        return values;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

function getEnvValue(key, fallback) {
    const value = process.env[key];
    if (value !== undefined && value !== '') {
        return value;
    }

    return fallback;
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function loadConfig(envFilePath = null) {
    const resolvedEnvFile = envFilePath || findEnvFile();
    const fileValues = parseEnvFile(resolvedEnvFile);

    return {
        server: {
            port: Number(getEnvValue('PORT', fileValues.PORT || '8081')),
            host: getEnvValue('WS_HOST', fileValues.WS_HOST || '127.0.0.1')
        },
        db: {
            host: getEnvValue('DB_HOST', fileValues.DB_HOST || 'localhost'),
            user: getEnvValue('DB_USER', fileValues.DB_USER || 'root'),
            password: getEnvValue('DB_PASS', fileValues.DB_PASS || ''),
            database: getEnvValue('DB_NAME', fileValues.DB_NAME || 'quizgame'),
            charset: getEnvValue('DB_CHARSET', fileValues.DB_CHARSET || 'utf8mb4'),
            connectionLimit: Number(getEnvValue('DB_CONNECTION_LIMIT', fileValues.DB_CONNECTION_LIMIT || '20'))
        },
        ws: {
            host: getEnvValue('WS_HOST', fileValues.WS_HOST || '127.0.0.1'),
            port: Number(getEnvValue('WS_PORT', fileValues.WS_PORT || '8081')),
            path: getEnvValue('WS_PATH', fileValues.WS_PATH || '/ws')
        },
        gameplay: {
            allowJoinAfterStart: parseBoolean(getEnvValue('ALLOW_JOIN_AFTER_START', fileValues.ALLOW_JOIN_AFTER_START || 'false'), false),
            useEndresultState: parseBoolean(getEnvValue('USE_ENDRESULT_STATE', fileValues.USE_ENDRESULT_STATE || 'true'), true)
        }
    };
}

module.exports = {
    loadConfig,
    findEnvFile,
    parseEnvFile
};
