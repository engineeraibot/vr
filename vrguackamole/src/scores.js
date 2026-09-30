// Top 10 leaderboard in localStorage, same entries as the eye-toy games: { name, score, level, date }.
const LB_KEY = 'vrguacamoleLeaderboard';
const NAME_KEY = 'vrguacamoleLastName';

export function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Scores {
    load() {
        try {
            const arr = JSON.parse(localStorage.getItem(LB_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    }

    get name() {
        try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
    }

    set name(v) {
        try { localStorage.setItem(NAME_KEY, v); } catch { /* ignore */ }
    }

    // Returns the saved entry and its rank (0-based, -1 when it didn't make the top 10).
    add(name, score, level) {
        const board = this.load();
        const entry = { name: (name || 'Player').slice(0, 20), score, level, date: Date.now() };
        board.push(entry);
        board.sort((a, b) => b.score - a.score || b.level - a.level || a.date - b.date);
        const top = board.slice(0, 10);
        try { localStorage.setItem(LB_KEY, JSON.stringify(top)); } catch { /* ignore */ }
        return { entry, rank: top.indexOf(entry) };
    }

    html(highlight) {
        const board = this.load();
        if (!board.length) return '<p class="empty">No scores yet: be the first!</p>';
        const rows = board.map((e, i) => {
            const hl = highlight && e.date === highlight.date && e.name === highlight.name;
            return `<tr${hl ? ' class="hl"' : ''}><td class="rank">${i + 1}</td><td>${escapeHTML(e.name)}</td>` +
                `<td class="score">${e.score}</td><td>L${e.level}</td></tr>`;
        }).join('');
        return `<table><thead><tr><th></th><th>Player</th><th style="text-align:right">Score</th><th>Level</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
}
