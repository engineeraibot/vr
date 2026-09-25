// HUD: HTML on a normal screen, head-locked canvas panels in the phone headset view.
import * as THREE from 'three';

const FONT = '"Press Start 2P", "Courier New", monospace';
const $ = id => document.getElementById(id);
export const ordinal = n => n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');
export const fmtTime = t => {
    const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
    return `${m}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`;
};
const POS_COLORS = ['#ffd83a', '#e8e8f0', '#e0a060', '#ffffff'];

function panel(w, h, width, height, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    mesh.position.set(x, y, z);
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
    c.fill();
}

export class Hud {
    constructor(game) {
        this.g = game;
        this.el = {
            hud: $('hud'), lap: $('h-lap'), time: $('h-time'), pos: $('h-pos'), speed: $('h-speed'),
            hands: $('h-hands'), msg: $('message'), msgTitle: $('msg-title'), msgSub: $('msg-sub'),
            fade: $('fade'), map: $('minimap'), pip: $('pip'),
        };
        this.text = {};
        this.msg = null;
        this.msgUntil = Infinity;
        this.vr = new THREE.Group();
        game.camera.add(this.vr);
        this.bar = panel(1024, 128, 0.78, 0.0975, 0, 0.23, -0.9);
        this.box = panel(1024, 512, 0.8, 0.4, 0, 0.0, -0.95);
        this.vr.add(this.bar.mesh, this.box.mesh);
        this.veil = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
        this.veil.renderOrder = 1000;
        game.camera.add(this.veil);
    }

    message(title, sub = '', seconds = Infinity) {
        this.msg = { title, sub };
        this.msgUntil = this.g.clock.elapsedTime + seconds;
    }

    clearMessage() { this.msg = null; }

    set(key, el, value) {
        if (this.text[key] === value) return;
        this.text[key] = value;
        if (el) el.textContent = value;
    }

    update() {
        const g = this.g;
        const vr = g.inVR;
        if (this.msg && g.clock.elapsedTime > this.msgUntil) this.msg = null;
        const racing = g.state === 'countdown' || g.state === 'race' || g.state === 'finished';
        const P = g.player;
        const lap = `LAP ${Math.min(Math.max(P.lap, 1), g.laps)}/${g.laps}`;
        const time = fmtTime(g.raceTime);
        const pos = ordinal(g.position);
        const speed = `${Math.round(P.speed * 3.6)} KM/H`;
        const hands = g.handStatus;

        this.el.hud.classList.toggle('hidden', !racing || vr);
        this.set('lap', this.el.lap, lap);
        this.set('time', this.el.time, time);
        this.set('pos', this.el.pos, pos);
        if (this.text.posColor !== g.position) {
            this.text.posColor = g.position;
            this.el.pos.style.color = POS_COLORS[Math.min(g.position, 4) - 1];
        }
        this.set('speed', this.el.speed, speed);
        this.set('hands', this.el.hands, hands.text);
        this.el.hands.style.color = hands.color;

        const msgKey = this.msg ? this.msg.title + '|' + this.msg.sub : '';
        if (this.text.msg !== msgKey) {
            this.text.msg = msgKey;
            if (this.msg) {
                this.el.msgTitle.textContent = this.msg.title;
                this.el.msgSub.textContent = this.msg.sub;
            }
        }
        this.el.msg.classList.toggle('hidden', !this.msg || vr);
        this.el.fade.style.opacity = vr ? '0' : String(g.fade);

        const showPip = racing && !vr && g.hands.status === 'running';
        this.el.pip.classList.toggle('hidden', !showPip);
        if (showPip) g.hands.drawPreview(this.el.pip);
        if (racing && !vr) this.drawMap(this.el.map);

        this.vr.visible = this.veil.visible = vr;
        if (!vr) return;
        this.veil.material.opacity = g.fade;

        const barKey = [lap, time, pos, hands.text, racing].join('|');
        if (barKey !== this.bar.key) {
            this.bar.key = barKey;
            const c = this.bar.ctx;
            c.clearRect(0, 0, 1024, 128);
            if (racing) {
                c.fillStyle = 'rgba(0,0,0,0.4)';
                roundRect(c, 4, 4, 1016, 120, 24);
                c.textBaseline = 'middle';
                c.font = `30px ${FONT}`;
                c.fillStyle = '#fff';
                c.textAlign = 'left';
                c.fillText(lap, 36, 44);
                c.fillText(time, 36, 92);
                c.textAlign = 'center';
                c.font = `22px ${FONT}`;
                c.fillStyle = hands.color;
                c.fillText(hands.text, 560, 64);
                c.textAlign = 'right';
                c.font = `56px ${FONT}`;
                c.fillStyle = POS_COLORS[Math.min(g.position, 4) - 1];
                c.fillText(pos, 990, 68);
            }
            this.bar.tex.needsUpdate = true;
        }
        if (msgKey !== this.box.key) {
            this.box.key = msgKey;
            const c = this.box.ctx;
            c.clearRect(0, 0, 1024, 512);
            if (this.msg) {
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillStyle = 'rgba(0,0,0,0.5)';
                roundRect(c, 40, 90, 944, 330, 30);
                c.fillStyle = '#fff';
                c.font = `64px ${FONT}`;
                c.fillText(this.msg.title, 512, 180);
                c.font = `22px ${FONT}`;
                this.msg.sub.split('\n').forEach((l, i, a) => c.fillText(l, 512, 290 + (i - (a.length - 1) / 2) * 36));
            }
            this.box.tex.needsUpdate = true;
        }
    }

    drawMap(canvas) {
        const g = this.g, map = g.track.map;
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height, pad = 10, k = w - pad * 2;
        c.clearRect(0, 0, w, h);
        c.lineJoin = 'round';
        c.lineWidth = 7;
        c.strokeStyle = 'rgba(0,0,0,0.5)';
        c.beginPath();
        map.pts.forEach(([x, z], i) => (i ? c.lineTo(pad + x * k, pad + z * k) : c.moveTo(pad + x * k, pad + z * k)));
        c.closePath();
        c.stroke();
        c.lineWidth = 3;
        c.strokeStyle = '#e8e8e8';
        c.stroke();
        const dot = (kart, r) => {
            c.fillStyle = '#' + new THREE.Color(kart.ch.kart).getHexString();
            c.beginPath();
            c.arc(pad + (kart.x - map.minX) / map.span * k, pad + (kart.z - map.minZ) / map.span * k, r, 0, Math.PI * 2);
            c.fill();
        };
        for (const cpu of g.cpus) dot(cpu, 3.5);
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        dot(g.player, 5.5);
        c.stroke();
    }
}
