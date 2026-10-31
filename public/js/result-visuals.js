(function (root) {
    const OUTCOMES = [
        { key: 'correct', label: 'Richtig', className: 'is-correct' },
        { key: 'partial', label: 'Teilweise', className: 'is-partial' },
        { key: 'incorrect', label: 'Falsch', className: 'is-incorrect' },
        { key: 'pendingReview', label: 'Wird bewertet', className: 'is-pending' },
        { key: 'noAnswer', label: 'Keine Antwort', className: 'is-none' }
    ];
    const VERDICTS = {
        correct: { icon: '✓', title: 'Richtig!', className: 'is-correct' },
        partial: { icon: '◐', title: 'Teilweise richtig', className: 'is-partial' },
        incorrect: { icon: '✕', title: 'Leider falsch', className: 'is-incorrect' },
        pending: { icon: '⏳', title: 'Wird bewertet', className: 'is-pending' },
        no_answer: { icon: '⏱', title: 'Keine Antwort', className: 'is-none' }
    };
    const MEDALS = ['🥇', '🥈', '🥉'];

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString('de-DE');
    }

    function formatSeconds(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value) || value <= 0) return '';
        return `${(value / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
    }

    function percent(part, total) {
        return total > 0 ? Math.round((Number(part || 0) / total) * 100) : 0;
    }

    function barWidth(part, total) {
        if (!(total > 0) || !(part > 0)) return 0;
        return Math.max(2, Math.min(100, (part / total) * 100));
    }

    function outcomeChart(stats, options = {}) {
        if (!stats || !(Number(stats.total) > 0)) return '';
        const total = Number(stats.total);
        const rows = OUTCOMES.filter(outcome => outcome.key === 'correct'
            || outcome.key === 'incorrect'
            || outcome.key === 'noAnswer'
            || Number(stats[outcome.key] || 0) > 0);
        const highlight = options.highlight || null;
        return `<div class="result-chart outcome-chart" role="list" aria-label="Antworten dieser Runde">
            ${rows.map((outcome, index) => {
                const count = Number(stats[outcome.key] || 0);
                const isOwn = highlight === outcome.key;
                return `<div class="chart-row ${outcome.className}${isOwn ? ' is-own' : ''}" role="listitem" style="--i:${index}">
                    <span class="chart-label">${outcome.label}${isOwn ? ' <em>· du</em>' : ''}</span>
                    <span class="chart-track"><span class="chart-fill" style="--w:${barWidth(count, total)}%"></span></span>
                    <span class="chart-value"><strong>${formatNumber(count)}</strong><small>${percent(count, total)}%</small></span>
                </div>`;
            }).join('')}
        </div>`;
    }

    function optionDistribution(question, stats, correctIndices) {
        const counts = Array.isArray(stats?.optionCounts) ? stats.optionCounts : null;
        if (!counts || !Array.isArray(question?.options)) return '';
        const answered = Math.max(1, Number(stats.answered || 0));
        const correct = new Set((correctIndices || []).map(Number));
        return `<div class="result-chart option-chart" role="list" aria-label="Verteilung der Antworten">
            ${question.options.map((option, index) => {
                const count = Number(counts[index] || 0);
                const label = option || question.optionMedia?.[index]?.altText || `Antwort ${String.fromCharCode(65 + index)}`;
                return `<div class="chart-row ${correct.has(index) ? 'is-correct' : 'is-option'}" role="listitem" style="--i:${index}">
                    <span class="chart-label"><b class="chart-letter">${String.fromCharCode(65 + index)}</b>${escapeHtml(label)}${correct.has(index) ? ' <span class="chart-check" aria-label="richtig">✓</span>' : ''}</span>
                    <span class="chart-track"><span class="chart-fill" style="--w:${barWidth(count, answered)}%"></span></span>
                    <span class="chart-value"><strong>${formatNumber(count)}</strong><small>${percent(count, Number(stats.answered || 0))}%</small></span>
                </div>`;
            }).join('')}
        </div>`;
    }

    function verdictKey(roundResult, playerResult) {
        if (roundResult?.status) return roundResult.status;
        if (!playerResult) return 'no_answer';
        return playerResult.isCorrect ? 'correct' : 'incorrect';
    }

    function verdictCard(roundResult, playerResult) {
        const key = verdictKey(roundResult, playerResult);
        const verdict = VERDICTS[key] || VERDICTS.no_answer;
        const points = Number(roundResult?.points ?? playerResult?.pointsAwarded ?? 0);
        const time = formatSeconds(roundResult?.answerTimeMs ?? playerResult?.answerTimeMs);
        const subline = key === 'pending'
            ? 'Der Spielleiter prüft deine Antwort gleich.'
            : key === 'no_answer' ? 'Diesmal keine Antwort abgegeben.' : (time ? `Antwortzeit ${time}` : '');
        return `<div class="verdict-card ${verdict.className}" data-verdict="${key}">
            <span class="verdict-icon" aria-hidden="true">${verdict.icon}</span>
            <div class="verdict-text">
                <strong class="verdict-title">${verdict.title}</strong>
                ${subline ? `<span class="verdict-sub">${escapeHtml(subline)}</span>` : ''}
            </div>
            <div class="verdict-points" aria-label="${formatNumber(points)} Punkte">
                <span class="verdict-points-value" data-count-to="${points}">${key === 'pending' ? '–' : '+0'}</span>
                <small>Punkte</small>
            </div>
        </div>`;
    }

    function roundPlacement(roundResult) {
        if (!roundResult) return '';
        if (roundResult.status === 'pending' || roundResult.rank === null) {
            return '<div class="round-placement is-pending"><span>Rundenplatz folgt nach der Bewertung.</span></div>';
        }
        if (!(Number(roundResult.points) > 0)) {
            return `<div class="round-placement is-none"><span class="round-rank">–</span><span>Diese Runde ohne Punkte. Die nächste Frage zählt!</span></div>`;
        }
        const rank = Number(roundResult.rank);
        const total = Number(roundResult.total || 0);
        const shared = Number(roundResult.sharedWith || 0);
        const topShare = total > 0 ? Math.max(1, Math.ceil((rank / total) * 100)) : 0;
        const medal = rank <= 3 ? `<span class="round-medal" aria-hidden="true">${MEDALS[rank - 1]}</span>` : '';
        const note = shared > 0
            ? `gleichauf mit ${shared} ${shared === 1 ? 'weiteren Person' : 'weiteren Personen'}`
            : (rank > 3 && topShare <= 50 ? `Top ${topShare}% dieser Runde` : 'in dieser Runde');
        return `<div class="round-placement${rank <= 3 ? ' is-podium' : ''}">
            ${medal}<span class="round-rank">Platz ${rank}</span>
            <span>von ${formatNumber(total)} · ${escapeHtml(note)}</span>
        </div>`;
    }

    function movementBadge(movement) {
        if (movement === null || movement === undefined) return '';
        const value = Number(movement);
        if (value > 0) return `<span class="rank-move is-up" title="${value} Plätze gewonnen">▲${value}</span>`;
        if (value < 0) return `<span class="rank-move is-down" title="${Math.abs(value)} Plätze verloren">▼${Math.abs(value)}</span>`;
        return '<span class="rank-move is-same" title="Platz gehalten">●</span>';
    }

    function rankingBars(entries, options = {}) {
        const list = Array.isArray(entries) ? entries : [];
        if (!list.length) return '<p class="small">Noch keine Daten.</p>';
        const trend = Array.isArray(options.trend) ? options.trend : [];
        const offset = Number(options.offset || 0);
        const maxPoints = Math.max(1, Number(options.maxPoints || 0), ...list.map(entry => Number(entry.points || 0)));
        const highlightRank = Number(options.highlightRank || 0);
        return `<ol class="ranking-bars" role="list">
            ${list.map((entry, index) => {
                const rank = Number(entry.rank || offset + index + 1);
                const info = trend[offset + index] || null;
                const points = Number(entry.points || 0);
                const medal = rank <= 3 ? MEDALS[rank - 1] : '';
                return `<li class="ranking-bar${rank <= 3 ? ` is-top is-top-${rank}` : ''}${rank === highlightRank ? ' is-own' : ''}" style="--i:${index}">
                    <span class="ranking-bar-rank">${medal || rank}</span>
                    <span class="ranking-bar-body">
                        <span class="ranking-bar-name">${escapeHtml(entry.name || 'Spieler')}${rank === highlightRank ? ' <em>(du)</em>' : ''}</span>
                        <span class="chart-track"><span class="chart-fill" style="--w:${barWidth(points, maxPoints)}%"></span></span>
                    </span>
                    <span class="ranking-bar-meta">
                        <strong>${formatNumber(points)}</strong>
                        ${info && Number(info.roundPoints) > 0 ? `<small class="round-gain">+${formatNumber(info.roundPoints)}</small>` : ''}
                        ${info ? movementBadge(info.movement) : ''}
                    </span>
                </li>`;
            }).join('')}
        </ol>`;
    }

    function roundTopList(top) {
        if (!Array.isArray(top) || !top.length) {
            return '<p class="small round-top-empty">Diese Runde hat niemand gepunktet.</p>';
        }
        return `<ol class="round-top" role="list">
            ${top.map((entry, index) => `<li style="--i:${index}">
                <span class="round-top-rank">${Number(entry.rank) <= 3 ? MEDALS[Number(entry.rank) - 1] : Number(entry.rank)}</span>
                <span class="round-top-name">${escapeHtml(entry.name || 'Spieler')}</span>
                <span class="round-top-time">${formatSeconds(entry.answerTimeMs)}</span>
                <strong>+${formatNumber(entry.points)}</strong>
            </li>`).join('')}
        </ol>`;
    }

    function standingSummary(standing) {
        if (!standing) return '';
        const movement = standing.movement === null || standing.movement === undefined ? '' : movementBadge(standing.movement);
        return `<div class="standing-summary">
            <span class="standing-rank">${Number(standing.rank) <= 3 ? `${MEDALS[Number(standing.rank) - 1]} ` : ''}Platz ${Number(standing.rank)}</span>
            <span class="standing-meta">von ${formatNumber(standing.total)} · ${formatNumber(standing.points)} Punkte ${movement}</span>
        </div>`;
    }

    function prefersReducedMotion() {
        return Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function countUp(element, duration = 900) {
        if (!element) return;
        const target = Number(element.dataset.countTo || 0);
        if (!Number.isFinite(target)) return;
        if (prefersReducedMotion() || target <= 0 || typeof root.requestAnimationFrame !== 'function') {
            element.textContent = `+${formatNumber(target)}`;
            return;
        }
        const started = root.performance ? root.performance.now() : Date.now();
        function step(now) {
            const progress = Math.min(1, (now - started) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = `+${formatNumber(Math.round(target * eased))}`;
            if (progress < 1) root.requestAnimationFrame(step);
        }
        root.requestAnimationFrame(step);
    }

    function burst(container, pieces = 36) {
        if (!container || prefersReducedMotion() || !root.document) return;
        const layer = root.document.createElement('div');
        layer.className = 'confetti-layer';
        layer.setAttribute('aria-hidden', 'true');
        const colors = ['#ffcf4a', '#2fd38a', '#48c6ff', '#ff6b8b', '#b28dff', '#ffffff'];
        for (let index = 0; index < pieces; index += 1) {
            const piece = root.document.createElement('span');
            piece.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
            piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
            piece.style.setProperty('--delay', `${Math.round(Math.random() * 350)}ms`);
            piece.style.setProperty('--spin', `${Math.round(360 + Math.random() * 540)}deg`);
            piece.style.background = colors[index % colors.length];
            layer.appendChild(piece);
        }
        container.appendChild(layer);
        root.setTimeout(() => layer.remove(), 2600);
    }

    root.QuizResultVisuals = {
        escapeHtml,
        formatSeconds,
        outcomeChart,
        optionDistribution,
        verdictCard,
        roundPlacement,
        rankingBars,
        roundTopList,
        standingSummary,
        movementBadge,
        countUp,
        burst
    };
})(typeof window !== 'undefined' ? window : globalThis);
