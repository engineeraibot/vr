export class HUD {
    constructor() {
        this.elScore = document.getElementById('h-score');
        this.elBonus = document.getElementById('h-bonus');
        this.elStage = document.getElementById('h-stage');
        this.elLives = document.getElementById('h-lives');
        this.elMotion = document.getElementById('h-motion');
        this.crosshair = document.getElementById('crosshair');
        this.hint = document.getElementById('hint');
        this.hud = document.getElementById('hud');
        this.fade = document.getElementById('fade');
        this.message = document.getElementById('message');
        this.msgTitle = document.getElementById('msg-title');
        this.msgSub = document.getElementById('msg-sub');
    }

    setScore(v) {
        if (this.elScore) this.elScore.textContent = String(v).padStart(6, '0');
    }

    setBonus(v) {
        if (this.elBonus) this.elBonus.textContent = String(Math.max(0, v));
    }

    setLives(v) {
        if (this.elLives) this.elLives.textContent = String(v);
    }

    setMotionState(st) {
        if (!this.elMotion) return;
        this.elMotion.className = st; // 'step', 'jump', 'stale', ''
    }

    setCrosshairTarget(active) {
        if (!this.crosshair) return;
        if (active) this.crosshair.classList.add('cannon-target');
        else this.crosshair.classList.remove('cannon-target');
    }

    showHint(msg, timeout = 0) {
        if (!this.hint) return;
        if (!msg) { this.hint.classList.add('hidden'); return; }
        this.hint.textContent = msg;
        this.hint.classList.remove('hidden');
        if (timeout > 0) setTimeout(() => this.hint.classList.add('hidden'), timeout);
    }

    showTitle(show) {
        document.getElementById('title')?.classList.toggle('hidden', !show);
        this.hud?.classList.toggle('hidden', show);
        this.crosshair?.classList.toggle('hidden', show);
    }

    showMessage(title, sub = '') {
        if (!this.message) return;
        if (!title) { this.message.classList.add('hidden'); return; }
        this.msgTitle.textContent = title;
        this.msgSub.textContent = sub;
        this.message.classList.remove('hidden');
    }
}
