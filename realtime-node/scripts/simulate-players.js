const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { loadConfig } = require('../config');

const HELP = `Quizzy-Spielersimulator (nur lokale Test-Sessions)

  node scripts\\simulate-players.js --pin 123456 [--count 100] [--answer]
       [--url ws://localhost:8082] [--interval-ms 30]

--pin          Sechsstellige PIN einer vorhandenen Test-Session (erforderlich)
--count        Anzahl virtueller Spieler, 1 bis 100 (Standard: 100)
--answer       In Antwortphasen automatisch Testantworten senden
--url          Lokaler WebSocket-Endpunkt (Standard: WS_HOST und WS_PORT)
--interval-ms  Abstand zwischen Beitritten, 0 bis 1000 ms (Standard: 30)

Die Simulation veraendert Session- und Antwortdaten. Nur eine eigene
Test-Session verwenden; Spieler bleiben ggf. in der Datenbank gespeichert.
Mit Strg+C beenden.`;

function defaultUrl() {
    const config = loadConfig();
    const host = String(config.ws.host);
    const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    return `ws://${formattedHost}:${config.ws.port}`;
}

function parseInteger(value, name, minimum, maximum) {
    if (value === undefined || value === null || !/^\d+$/.test(String(value))) {
        throw new Error(`${name} muss eine ganze Zahl sein.`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new Error(`${name} muss zwischen ${minimum} und ${maximum} liegen.`);
    }
    return number;
}

function validateOptions(options) {
    if (!/^\d{6}$/.test(String(options.pin || ''))) {
        throw new Error('Eine sechsstellige Test-Session-PIN ist erforderlich (--pin).');
    }
    const count = parseInteger(options.count, '--count', 1, 100);
    const intervalMs = parseInteger(options.intervalMs, '--interval-ms', 0, 1000);
    let url;
    try {
        url = new URL(options.url);
    } catch (error) {
        throw new Error('Der WebSocket-Endpunkt ist keine gueltige URL.');
    }
    if (!['ws:', 'wss:'].includes(url.protocol)
        || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
        || url.username || url.password) {
        throw new Error('Der Simulator erlaubt nur lokale ws://- oder wss://-Endpunkte ohne Zugangsdaten.');
    }
    return { ...options, pin: String(options.pin), count, intervalMs, url: url.toString() };
}

function parseArguments(args, fallbackUrl = defaultUrl()) {
    if (args.includes('--help') || args.includes('-h')) return { help: true };
    const options = { pin: '', count: 100, intervalMs: 30, url: fallbackUrl, autoAnswer: false };
    const valueOptions = {
        '--pin': 'pin',
        '--count': 'count',
        '--interval-ms': 'intervalMs',
        '--url': 'url'
    };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--answer') {
            options.autoAnswer = true;
        } else if (valueOptions[argument]) {
            if (!args[index + 1] || args[index + 1].startsWith('--')) {
                throw new Error(`Ein Wert fuer ${argument} fehlt.`);
            }
            options[valueOptions[argument]] = args[++index];
        } else {
            throw new Error(`Unbekannte Option: ${argument}`);
        }
    }
    return validateOptions(options);
}

function buildAnswerMessage(pin, question, index) {
    const type = String(question?.type || question?.question_type || 'single_choice');
    const base = { type: 'player_submit_answer', role: 'player', sessionPin: pin };
    if (type === 'short_text') {
        return { ...base, answerText: `Testantwort ${index + 1}` };
    }

    const optionCount = Array.isArray(question?.options) ? question.options.length : 0;
    if (optionCount < 1) {
        throw new Error(`Frage ${question?.id || '?'} hat keine Antwortoptionen.`);
    }
    if (type === 'single_choice' || type === 'true_false') {
        return { ...base, answerIndex: index % optionCount };
    }
    if (type === 'multiple_choice') {
        const first = index % optionCount;
        const selectedIndices = index % 2 === 0 && optionCount > 1
            ? [first, (first + 1) % optionCount].sort((a, b) => a - b)
            : [first];
        return { ...base, selectedIndices };
    }
    throw new Error(`Der Fragetyp ${type} wird vom Simulator nicht unterstuetzt.`);
}

class PlayerSimulator extends EventEmitter {
    constructor(options) {
        super();
        this.options = validateOptions(options);
        this.runId = crypto.randomBytes(4).toString('hex');
        this.players = [];
        this.pendingStarts = new Map();
        this.joined = 0;
        this.answersSent = 0;
        this.started = false;
        this.stopping = false;
        this.stopPromise = null;
    }

    async start() {
        if (this.started) throw new Error('Diese Simulation wurde bereits gestartet.');
        this.started = true;
        const starts = Array.from({ length: this.options.count }, (_, index) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingStarts.delete(timer);
                this.connectPlayer(index).then(resolve, reject);
            }, index * this.options.intervalMs);
            this.pendingStarts.set(timer, reject);
        }));

        try {
            await Promise.all(starts);
        } catch (error) {
            await this.stop();
            throw error;
        }
        return { joined: this.joined, total: this.options.count };
    }

    connectPlayer(index) {
        const number = String(index + 1).padStart(3, '0');
        const name = `Test-${this.runId}-${number}`;
        const token = `sim-${this.runId}-${number}`;
        const socket = new WebSocket(this.options.url, {
            headers: { 'User-Agent': `Quizzy-Simulator/${this.runId}/${number}` }
        });
        const player = { index, name, socket, joined: false, answerTimer: null, questionId: null };
        this.players.push(player);

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                fail(new Error(`${name}: Zeitueberschreitung beim Beitritt.`));
                socket.terminate();
            }, 20000);
            const fail = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                reject(error);
            };

            socket.on('open', () => {
                socket.send(JSON.stringify({
                    type: 'join',
                    role: 'player',
                    sessionPin: this.options.pin,
                    data: { nickname: name, playerToken: token }
                }));
            });
            socket.on('message', raw => {
                let message;
                try {
                    message = JSON.parse(raw.toString());
                } catch (error) {
                    const problem = new Error(`${name}: ungueltige Servernachricht.`);
                    if (!player.joined) fail(problem);
                    else this.emit('problem', problem.message);
                    return;
                }

                if (message.type === 'join_rejected') {
                    const reason = message.data?.reason || 'Beitritt abgelehnt';
                    fail(new Error(`${name}: ${reason}`));
                    socket.close();
                } else if (message.type === 'lobby_joined' && !player.joined) {
                    player.joined = true;
                    this.joined += 1;
                    clearTimeout(timeout);
                    settled = true;
                    this.emit('joined', { name, joined: this.joined, total: this.options.count });
                    resolve();
                } else if (this.options.autoAnswer && player.joined
                    && (message.type === 'answer_phase_started'
                        || (message.type === 'session_state_sync' && message.data?.state === 'answer' && !message.data?.playerAnswered))) {
                    this.scheduleAnswer(player, message.data?.question);
                } else if (message.type === 'answer_rejected') {
                    this.emit('problem', `${name}: ${message.data?.reason || 'Antwort abgelehnt'}`);
                } else if (['show_solution', 'next_question', 'quiz_finished'].includes(message.type)) {
                    clearTimeout(player.answerTimer);
                    player.answerTimer = null;
                    if (message.type === 'quiz_finished') this.emit('finished', name);
                }
            });
            socket.on('error', error => {
                if (!player.joined) fail(new Error(`${name}: ${error.message}`));
                else if (!this.stopping) this.emit('problem', `${name}: ${error.message}`);
            });
            socket.on('close', (code, reason) => {
                clearTimeout(timeout);
                clearTimeout(player.answerTimer);
                if (!player.joined) {
                    fail(new Error(`${name}: Verbindung vor dem Beitritt geschlossen (${code}).`));
                } else if (!this.stopping) {
                    this.emit('disconnected', { name, code, reason: reason.toString() });
                }
            });
        });
    }

    scheduleAnswer(player, question) {
        const questionId = Number(question?.id);
        if (!Number.isInteger(questionId) || questionId < 1) {
            this.emit('problem', `${player.name}: Frage ohne gueltige ID.`);
            return;
        }
        if (player.questionId === questionId) return;
        let answer;
        try {
            answer = buildAnswerMessage(this.options.pin, question, player.index);
        } catch (error) {
            this.emit('problem', `${player.name}: ${error.message}`);
            return;
        }
        player.questionId = questionId;
        clearTimeout(player.answerTimer);
        player.answerTimer = setTimeout(() => {
            if (player.socket.readyState !== WebSocket.OPEN) {
                this.emit('problem', `${player.name}: Antwort nicht gesendet, Verbindung geschlossen.`);
                return;
            }
            player.socket.send(JSON.stringify(answer), error => {
                if (error) {
                    this.emit('problem', `${player.name}: Antwort nicht gesendet: ${error.message}`);
                    return;
                }
                this.answersSent += 1;
                this.emit('answer', { name: player.name, sent: this.answersSent });
            });
        }, 200 + (player.index % 10) * 100);
    }

    async stop() {
        if (this.stopPromise) return this.stopPromise;
        this.stopping = true;
        for (const [timer, reject] of this.pendingStarts) {
            clearTimeout(timer);
            reject(new Error('Simulation beendet.'));
        }
        this.pendingStarts.clear();
        this.stopPromise = Promise.all(this.players.map(player => new Promise(resolve => {
            clearTimeout(player.answerTimer);
            const socket = player.socket;
            if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }
            const timeout = setTimeout(() => socket.terminate(), 2000);
            socket.once('close', () => {
                clearTimeout(timeout);
                resolve();
            });
            if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
            else if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Simulator beendet');
        })));
        return this.stopPromise;
    }
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        console.log(HELP);
        return;
    }
    console.log(`Test-Session ${options.pin}: ${options.count} Spieler, ${options.url}`);
    console.log('Nur Testdaten verwenden; simulierte Spieler koennen in der Datenbank verbleiben.');
    const simulator = new PlayerSimulator(options);
    let finishedLogged = false;
    let interrupted = false;
    simulator.on('joined', ({ joined, total }) => {
        if (joined % 10 === 0 || joined === total) console.log(`Beigetreten: ${joined}/${total}`);
    });
    simulator.on('answer', ({ sent }) => {
        if (sent % 10 === 0) console.log(`Testantworten gesendet: ${sent}`);
    });
    simulator.on('problem', message => console.error(message));
    simulator.on('disconnected', ({ name, code, reason }) => {
        console.error(`${name}: Verbindung geschlossen (${code}${reason ? `: ${reason}` : ''}).`);
        if (code !== 4001) process.exitCode = 1;
    });
    simulator.on('finished', () => {
        if (!finishedLogged) {
            finishedLogged = true;
            console.log('Quiz beendet. Simulator mit Strg+C schliessen.');
        }
    });
    process.once('SIGINT', () => {
        interrupted = true;
        console.log('Simulation wird beendet ...');
        simulator.stop().catch(error => {
            console.error(`Simulator konnte nicht sauber beendet werden: ${error.message}`);
            process.exitCode = 1;
        });
    });
    try {
        await simulator.start();
        if (!interrupted) console.log('Simulation laeuft. Mit Strg+C beenden.');
    } catch (error) {
        if (!interrupted) throw error;
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Simulation fehlgeschlagen: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { PlayerSimulator, parseArguments, buildAnswerMessage };
