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

export class HUD {
    constructor(game) {
        this.g = game;
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

        this.msg = null;
        this.stepFlash = 0;
        this.jumpFlash = 0;
        this.text = {};

        // VR head-locked panel group
        this.vr = new THREE.Group();
        this.vr.visible = false;
        if (game && game.camera) {
            game.camera.add(this.vr);
        }
        this.bar = canvasPanel(1024, 128, 0.76, 0.095, 0, 0.21, -0.9);
        this.box = canvasPanel(1024, 512, 0.8, 0.4, 0, -0.04, -0.95);
        this.vr.add(this.bar.mesh, this.box.mesh);

        this.reticle = new THREE.Mesh(
            new THREE.RingGeometry(0.005, 0.009, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false })
        );
        this.reticle.position.z = -0.9;
        this.reticle.renderOrder = 1002;
        this.vr.add(this.reticle);
    }

    setScore(v) {
        if (this.elScore) this.elScore.textContent = String(v).padStart(6, '0');
    }

    setBonus(v) {
        if (this.elBonus) this.elBonus.textContent = String(Math.max(0, Math.floor(v)));
    }

    setLives(v) {
        if (this.elLives) this.elLives.textContent = String(v);
    }

    setMotionState(st) {
        if (!this.elMotion) return;
        this.elMotion.className = st;
    }

    setCrosshairTarget(active) {
        if (!this.crosshair) return;
        if (active) this.crosshair.classList.add('cannon-target');
        else this.crosshair.classList.remove('cannon-target');
        if (this.reticle) {
            this.reticle.material.color.setHex(active ? 0xffd700 : 0xffffff);
            this.reticle.scale.setScalar(active ? 1.5 : 1.0);
        }
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
        if (!title) {
            this.msg = null;
            if (this.message) this.message.classList.add('hidden');
            return;
        }
        this.msg = { title, sub };
        if (this.msgTitle) this.msgTitle.textContent = title;
        if (this.msgSub) this.msgSub.textContent = sub;
        if (this.message) this.message.classList.remove('hidden');
    }

    update(dt) {
        const g = this.g;
        if (!g) return;
        const vr = g.inVR;
        const showHud = g.state !== 'title';

        this.stepFlash = Math.max(0, this.stepFlash - dt);
        this.jumpFlash = Math.max(0, this.jumpFlash - dt);

        if (this.elMotion) {
            this.elMotion.className = this.jumpFlash > 0 ? 'jump' : this.stepFlash > 0 ? 'step' : g.sensorStale ? 'stale' : '';
        }

        if (this.hud) this.hud.classList.toggle('hidden', !showHud || vr);
        if (this.crosshair) this.crosshair.classList.toggle('hidden', !showHud || vr || g.state !== 'play');
        if (this.message) this.message.classList.toggle('hidden', !this.msg || vr);

        // VR Panels
        this.vr.visible = vr;
        if (!vr) return;

        const score = String(g.score).padStart(6, '0');
        const bonus = String(Math.max(0, Math.floor(g.bonus)));
        const lives = String(g.lives);

        const barKey = [score, bonus, lives, this.stepFlash > 0, this.jumpFlash > 0, showHud, g.sensorStale].join('|');
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
                const cols = [['SCORE', score], ['BONUS', bonus], ['STAGE', '25M'], ['LIVES', lives]];
                cols.forEach(([a, b], i) => {
                    const x = 40 + i * 220;
                    c.fillText(a, x, 24);
                    c.fillText(b, x, 70);
                });
                c.fillStyle = this.jumpFlash > 0 ? '#ffd83a' : this.stepFlash > 0 ? '#44e060' : g.sensorStale ? '#ff3030' : 'rgba(255,255,255,0.25)';
                c.beginPath(); c.arc(985, 64, 16, 0, Math.PI * 2); c.fill();
            }
            this.bar.tex.needsUpdate = true;
        }

        const msgKey = this.msg ? this.msg.title + '|' + this.msg.sub : '';
        if (msgKey !== this.box.key) {
            this.box.key = msgKey;
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
