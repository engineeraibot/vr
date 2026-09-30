// HUD. On a screen: HTML. In the headset:
//   - a marquee board fixed in the room above the field: level, score, lives, hands, and the
//     start / game over text (not in front of your eyes, where the moles are),
//   - short toasts ("GO!", "LEVEL 2!") just above where you look, for a moment,
//   - colour flashes over the whole view (bomb, extra life).
import * as THREE from 'three';

const FONT = 'Fredoka, "Trebuchet MS", sans-serif';
const MARQUEE_PITCH = 30;     // degrees above the horizon
const $ = id => document.getElementById(id);

function panel(w, h, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    mesh.renderOrder = 1001;
    return { canvas, ctx: canvas.getContext('2d'), tex, mesh, key: '' };
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function heart(c, x, y, s, full) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.beginPath();
    c.moveTo(0, 0.35);
    c.bezierCurveTo(-0.1, 0.2, -0.5, 0.05, -0.5, -0.2);
    c.bezierCurveTo(-0.5, -0.45, -0.2, -0.55, 0, -0.3);
    c.bezierCurveTo(0.2, -0.55, 0.5, -0.45, 0.5, -0.2);
    c.bezierCurveTo(0.5, 0.05, 0.1, 0.2, 0, 0.35);
    c.fillStyle = full ? '#ff3b4f' : 'rgba(255,255,255,0.18)';
    c.fill();
    c.lineWidth = 0.06;
    c.strokeStyle = full ? '#7a0010' : 'rgba(255,255,255,0.35)';
    c.stroke();
    c.restore();
}

export class Hud {
    constructor(game) {
        this.g = game;
        this.el = {
            hud: $('hud'), level: $('h-level'), score: $('h-score'), lives: $('h-lives'), hands: $('h-hands'),
            msg: $('message'), msgTitle: $('msg-title'), msgSub: $('msg-sub'), flash: $('flash'),
        };
        this.text = {};
        this.toastMsg = null;       // short message
        this.toastUntil = 0;
        this.boardMsg = null;       // start / game over text, set every frame while it applies

        this.marquee = panel(1024, 448, 0.92, 0.4025);
        const e = THREE.MathUtils.degToRad(MARQUEE_PITCH), d = 1.1;
        this.marquee.mesh.position.set(0, Math.sin(e) * d, -Math.cos(e) * d);
        this.marquee.mesh.lookAt(0, 0, 0);
        game.scene.add(this.marquee.mesh);
        this.toast = panel(1024, 256, 0.6, 0.15);
        this.toast.mesh.position.set(0, 0.12, -0.9);
        game.camera.add(this.toast.mesh);
        this.veil = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
        this.veil.renderOrder = 1000;
        game.camera.add(this.veil);
        // Gaze reticle, for whacking by looking + tapping when there's no camera.
        this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.009, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
        this.reticle.position.z = -0.6;
        this.reticle.renderOrder = 1002;
        game.camera.add(this.reticle);
        this.flashColor = new THREE.Color();
        this.flashA = 0;
        this.lastLives = -1;
        if (document.fonts) document.fonts.ready.then(() => { this.marquee.key = this.toast.key = ''; });
    }

    // A short message ("GO!", "LEVEL 3!").
    message(title, sub = '', seconds = 1.2) {
        this.toastMsg = { title, sub };
        this.toastUntil = performance.now() / 1000 + seconds;
    }

    // Longer text for the current state (start, game over); call every frame while it applies.
    board(title, sub = '') {
        this.boardMsg = { title, sub };
    }

    clearMessage() {
        this.toastMsg = null;
        this.boardMsg = null;
    }

    flash(color, strength) {
        this.flashColor.set(color);
        this.flashA = strength;
    }

    set(key, el, value) {
        if (this.text[key] === value) return;
        this.text[key] = value;
        if (el) el.textContent = value;
    }

    update(dt) {
        const g = this.g;
        const vr = g.inVR;
        if (this.toastMsg && performance.now() / 1000 > this.toastUntil) this.toastMsg = null;
        const playing = g.state !== 'title';
        const hands = g.handStatus;
        const toast = this.toastMsg, board = playing ? this.boardMsg : null;
        this.boardMsg = null;

        // Flat screen: HTML.
        this.el.hud.classList.toggle('hidden', !playing || vr);
        this.set('level', this.el.level, String(g.level));
        this.set('score', this.el.score, String(g.score));
        if (this.lastLives !== g.lives) {
            this.lastLives = g.lives;
            this.el.lives.querySelectorAll('.heart').forEach((h, i) => h.classList.toggle('lost', i >= g.lives));
        }
        this.set('hands', this.el.hands, hands.text);
        this.el.hands.style.color = hands.color;
        const shown = toast || board;
        const msgKey = shown ? shown.title + '|' + shown.sub : '';
        if (this.text.msg !== msgKey) {
            this.text.msg = msgKey;
            if (shown) {
                this.el.msgTitle.textContent = shown.title;
                this.el.msgSub.textContent = shown.sub;
            }
        }
        this.el.msg.classList.toggle('hidden', !shown || vr || !playing);
        this.flashA = Math.max(0, this.flashA - dt * 2.2);
        const fc = this.flashColor;
        this.el.flash.style.background = vr ? 'transparent'
            : `rgba(${Math.round(fc.r * 255)},${Math.round(fc.g * 255)},${Math.round(fc.b * 255)},${this.flashA.toFixed(3)})`;

        // Headset.
        this.marquee.mesh.visible = this.toast.mesh.visible = this.veil.visible = vr && playing;
        this.reticle.visible = vr && g.gazeMode;
        if (!vr || !playing) return;
        this.veil.material.color.copy(fc);
        this.veil.material.opacity = this.flashA;
        this.drawMarquee(board, hands);
        this.drawToast(toast);
    }

    drawMarquee(board, hands) {
        const g = this.g, m = this.marquee;
        const key = [g.level, g.score, g.lives, hands.text, board ? board.title + board.sub : ''].join('|');
        if (key === m.key) return;
        m.key = key;
        const c = m.ctx;
        c.clearRect(0, 0, 1024, 448);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        if (board) {
            const lines = board.sub ? board.sub.split('\n') : [];
            const h = 104 + lines.length * 40;
            const y0 = 300 - h;
            c.fillStyle = 'rgba(40,20,10,0.62)';
            roundRect(c, 40, y0, 944, h, 26);
            c.fill();
            c.fillStyle = '#ffc14a';
            c.font = `bold 68px ${FONT}`;
            c.fillText(board.title, 512, y0 + 56);
            c.fillStyle = '#fff';
            c.font = `28px ${FONT}`;
            lines.forEach((l, i) => c.fillText(l, 512, y0 + 118 + i * 40));
        }
        // Scoreboard strip.
        c.fillStyle = 'rgba(40,20,10,0.62)';
        roundRect(c, 6, 314, 1012, 128, 30);
        c.fill();
        c.lineWidth = 5;
        c.strokeStyle = '#ff7a3a';
        c.stroke();
        c.fillStyle = '#fff';
        c.font = `bold 44px ${FONT}`;
        c.textAlign = 'left';
        c.fillText(`LEVEL ${g.level}`, 40, 362);
        c.textAlign = 'center';
        c.fillText(`SCORE ${g.score}`, 512, 362);
        c.font = `28px ${FONT}`;
        c.fillStyle = hands.color;
        c.fillText(hands.text, 512, 412);
        for (let i = 0; i < 3; i++) heart(c, 830 + i * 68, 376, 62, i < g.lives);
        m.tex.needsUpdate = true;
    }

    drawToast(toast) {
        const t = this.toast;
        const key = toast ? toast.title + '|' + toast.sub : '';
        t.mesh.visible = !!toast;
        if (key === t.key) return;
        t.key = key;
        const c = t.ctx;
        c.clearRect(0, 0, 1024, 256);
        if (toast) {
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.lineWidth = 14;
            c.strokeStyle = 'rgba(40,20,10,0.85)';
            c.fillStyle = '#ffc14a';
            c.font = `bold 96px ${FONT}`;
            const y = toast.sub ? 100 : 128;
            c.strokeText(toast.title, 512, y);
            c.fillText(toast.title, 512, y);
            if (toast.sub) {
                c.font = `bold 40px ${FONT}`;
                c.lineWidth = 10;
                c.fillStyle = '#fff';
                c.strokeText(toast.sub, 512, 190);
                c.fillText(toast.sub, 512, 190);
            }
        }
        t.tex.needsUpdate = true;
    }
}
