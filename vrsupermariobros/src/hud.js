// HUD: HTML overlay on a normal screen, head-locked canvas panels inside VR.
import * as THREE from 'three';

const FONT = '"Press Start 2P", "Courier New", monospace';
const $ = id => document.getElementById(id);

function canvasPanel(w, h, width, height, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 1001;
    return { canvas, ctx: canvas.getContext('2d'), tex, mesh, key: '' };
}

export class Hud {
    constructor(game) {
        this.g = game;
        this.el = {
            hud: $('hud'), score: $('h-score'), coins: $('h-coins'), time: $('h-time'), lives: $('h-lives'),
            msg: $('message'), msgTitle: $('msg-title'), msgSub: $('msg-sub'),
            fade: $('fade'), hint: $('hint'), cross: $('crosshair'), motion: $('h-motion'),
        };
        this.text = {};
        this.msg = null;
        this.hintText = '';
        this.hintUntil = 0;
        this.stepFlash = 0;
        this.jumpFlash = 0;

        // VR panels are children of the camera so they follow your head.
        this.vr = new THREE.Group();
        this.vr.visible = false;
        game.camera.add(this.vr);
        this.bar = canvasPanel(1024, 128, 0.76, 0.095, 0, 0.21, -0.9);
        this.box = canvasPanel(1024, 512, 0.8, 0.4, 0, -0.04, -0.95);
        this.vr.add(this.bar.mesh, this.box.mesh);
        this.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.005, 0.009, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }),
        );
        this.reticle.position.z = -0.9;
        this.reticle.renderOrder = 1002;
        this.vr.add(this.reticle);
        this.veil = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }),
        );
        this.veil.renderOrder = 1000;
        game.camera.add(this.veil);
    }

    message(title, sub = '') { this.msg = { title, sub }; }
    clearMessage() { this.msg = null; }

    hint(text, seconds = 4) {
        this.hintText = text;
        this.hintUntil = this.g.gameTime + seconds;
    }

    set(key, el, value) {
        if (this.text[key] === value) return;
        this.text[key] = value;
        if (el) el.textContent = value;
    }

    update(dt) {
        const g = this.g;
        const vr = g.inVR;
        const showHud = g.state !== 'title';
        const score = String(g.score).padStart(6, '0');
        const coins = String(g.coins).padStart(2, '0');
        const time = String(Math.max(0, g.time)).padStart(3, '0');
        const lives = String(g.lives);
        this.stepFlash = Math.max(0, this.stepFlash - dt);
        this.jumpFlash = Math.max(0, this.jumpFlash - dt);
        const now = g.gameTime;
        const hint = now < this.hintUntil ? this.hintText : '';

        // HTML
        this.el.hud.classList.toggle('hidden', !showHud || vr);
        this.set('score', this.el.score, score);
        this.set('coins', this.el.coins, coins);
        this.set('time', this.el.time, time);
        this.set('lives', this.el.lives, lives);
        const msgKey = this.msg ? this.msg.title + '|' + this.msg.sub : '';
        if (this.text.msg !== msgKey) {
            this.text.msg = msgKey;
            if (this.msg) {
                this.el.msgTitle.textContent = this.msg.title;
                this.el.msgSub.textContent = this.msg.sub;
            }
        }
        this.el.msg.classList.toggle('hidden', !this.msg || vr);
        this.set('hint', this.el.hint, hint);
        this.el.hint.classList.toggle('hidden', !hint || vr);
        this.el.cross.classList.toggle('hidden', !showHud || vr || g.state !== 'playing');
        const tint = g.tint;
        this.el.fade.style.background = g.fade > 0.01 ? '#000' : tint.css;
        this.el.fade.style.opacity = vr ? '0' : String(g.fade > 0.01 ? g.fade : tint.alpha);
        if (this.el.motion) this.el.motion.className = this.jumpFlash > 0 ? 'jump' : this.stepFlash > 0 ? 'step' : g.sensorStale ? 'stale' : '';

        // VR
        this.vr.visible = vr;
        this.veil.visible = vr;
        if (!vr) return;
        const veil = this.veil.material;
        if (g.fade > 0.01) { veil.color.set(0x000000); veil.opacity = g.fade; } else { veil.color.set(tint.color); veil.opacity = tint.alpha; }
        this.reticle.visible = g.state === 'playing';

        const barKey = [score, coins, time, lives, this.stepFlash > 0, this.jumpFlash > 0, showHud, g.sensorStale].join('|');
        if (barKey !== this.bar.key) {
            this.bar.key = barKey;
            const c = this.bar.ctx;
            c.clearRect(0, 0, 1024, 128);
            if (showHud) {
                c.fillStyle = 'rgba(0,0,0,0.35)';
                roundRect(c, 4, 4, 1016, 120, 24);
                c.font = `26px ${FONT}`;
                c.textBaseline = 'top';
                c.fillStyle = '#fff';
                const cols = [['MARIO', score], ['COINS', 'x' + coins], ['WORLD', '1-1'], ['TIME', time], ['LIVES', lives]];
                cols.forEach(([a, b], i) => {
                    const x = 40 + i * 190;
                    c.fillText(a, x, 24);
                    c.fillText(b, x, 70);
                });
                // Body-motion indicator: green = step, yellow = hop, red = motion sensor not reporting.
                c.fillStyle = this.jumpFlash > 0 ? '#ffd83a' : this.stepFlash > 0 ? '#44e060' : g.sensorStale ? '#ff3030' : 'rgba(255,255,255,0.25)';
                c.beginPath(); c.arc(985, 64, 16, 0, Math.PI * 2); c.fill();
            }
            this.bar.tex.needsUpdate = true;
        }
        const boxKey = msgKey + '|' + hint;
        if (boxKey !== this.box.key) {
            this.box.key = boxKey;
            const c = this.box.ctx;
            c.clearRect(0, 0, 1024, 512);
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            if (this.msg) {
                c.fillStyle = 'rgba(0,0,0,0.55)';
                roundRect(c, 40, 120, 944, 260, 30);
                c.fillStyle = '#fff';
                c.font = `52px ${FONT}`;
                c.fillText(this.msg.title, 512, 210);
                c.font = `24px ${FONT}`;
                wrap(c, this.msg.sub, 512, 300, 880, 36);
            }
            if (hint) {
                c.fillStyle = 'rgba(0,0,0,0.55)';
                roundRect(c, 60, 420, 904, 80, 20);
                c.fillStyle = '#ffe680';
                c.font = `20px ${FONT}`;
                wrap(c, hint, 512, 460, 860, 30);
            }
            this.box.tex.needsUpdate = true;
        }
    }
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    c.fill();
}

function wrap(c, text, x, y, maxW, lineH) {
    const lines = [];
    for (const para of String(text).split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
            const t = line ? line + ' ' + word : word;
            if (c.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
        }
        lines.push(line);
    }
    const y0 = y - (lines.length - 1) * lineH / 2;
    lines.forEach((l, i) => c.fillText(l, x, y0 + i * lineH));
}
