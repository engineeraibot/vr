// HUD: HTML on a normal screen; in the headset a head-locked message panel, a reticle for
// popping balloons, and a dashboard screen on the car (look down to read it).
import * as THREE from 'three';

const FONT = '"Press Start 2P", "Courier New", monospace';
const $ = id => document.getElementById(id);

function panel(w, h, width, height) {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
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

export class Hud {
    constructor(game) {
        this.g = game;
        this.el = {
            hud: $('hud'), speed: $('h-speed'), height: $('h-height'), gforce: $('h-g'), score: $('h-score'),
            msg: $('message'), msgTitle: $('msg-title'), msgSub: $('msg-sub'), fade: $('fade'), reticle: $('reticle'),
        };
        this.text = {};
        this.msg = null;
        this.msgUntil = 0;

        // Head-locked message panel and reticle (VR).
        this.box = panel(1024, 512, 1.3, 0.65);
        this.box.mesh.position.set(0, 0.12, -1.2);
        game.camera.add(this.box.mesh);
        this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 20),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false }));
        this.reticle.position.z = -1.2;
        this.reticle.renderOrder = 1002;
        game.camera.add(this.reticle);
        this.veil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }));
        this.veil.renderOrder = 1000;
        game.camera.add(this.veil);

        // Dashboard screen in the car.
        this.dash = panel(512, 256, 0.62, 0.31);
        this.dash.mesh.material.depthTest = true;
        this.dash.mesh.material.transparent = false;
        this.dash.mesh.renderOrder = 0;
        this.dash.mesh.position.set(0, -0.52, -0.9);
        this.dash.mesh.rotation.x = -0.75;
        game.train.cars[0].g.add(this.dash.mesh);
        this.dashT = 0;
    }

    message(title, sub = '', seconds = 2.2, color = '#ffe14d') {
        this.msg = { title, sub, color };
        this.msgUntil = this.g.clock.elapsedTime + seconds;
    }

    clearMessage() { this.msg = null; }

    set(key, value) {
        if (this.text[key] === value) return;
        this.text[key] = value;
        this.el[key].textContent = value;
    }

    update(dt) {
        const g = this.g, vr = g.inVR;
        const now = g.clock.elapsedTime;
        if (this.msg && now > this.msgUntil) this.msg = null;
        const m = this.msg;
        const r = g.ride;
        const flat = !vr && g.state !== 'title';
        this.el.hud.classList.toggle('hidden', !flat);
        this.el.reticle.classList.toggle('hidden', !flat);
        this.el.reticle.classList.toggle('hot', g.gazeHot);
        if (flat) {
            this.set('speed', `${Math.round(r.v * 3.6)} KM/H`);
            this.set('height', `${Math.max(0, Math.round(r.pos.y - 1.2))} M UP`);
            this.set('gforce', `${r.gv.toFixed(1)} G`);
            this.set('score', `\u{1F388} ${g.score}`);
        }
        const showDom = !vr && m && g.state !== 'title';
        this.el.msg.classList.toggle('hidden', !showDom);
        if (showDom) {
            this.el.msgTitle.textContent = m.title;
            this.el.msgTitle.style.color = m.color;
            this.el.msgSub.textContent = m.sub;
        }

        // VR panels.
        this.reticle.visible = vr && g.state !== 'title';
        this.reticle.material.color.set(g.gazeHot ? 0xffe14d : 0xffffff);
        this.reticle.scale.setScalar(g.gazeHot ? 1.6 : 1);
        this.box.mesh.visible = vr && !!m;
        if (vr && m) {
            const key = m.title + '|' + m.sub + '|' + m.color;
            if (key !== this.box.key) {
                this.box.key = key;
                this.drawBox(m);
            }
        }
        this.veil.visible = vr && g.fade > 0.001;
        this.veil.material.opacity = g.fade;
        this.el.fade.style.opacity = vr ? 0 : g.fade;

        this.dashT -= dt;
        if (this.dashT <= 0) {
            this.dashT = 0.12;
            this.drawDash();
        }
    }

    drawBox(m) {
        const c = this.box.ctx, W = 1024, H = 512;
        c.clearRect(0, 0, W, H);
        const lines = m.sub ? m.sub.split('\n') : [];
        const bh = 170 + lines.length * 52;
        c.fillStyle = 'rgba(20,0,40,0.55)';
        roundRect(c, 40, (H - bh) / 2, W - 80, bh, 30);
        c.fill();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        let size = 84;
        c.font = `${size}px ${FONT}`;
        while (c.measureText(m.title).width > W - 120 && size > 20) { size -= 4; c.font = `${size}px ${FONT}`; }
        const y0 = (H - bh) / 2 + 90;
        c.fillStyle = '#000';
        c.fillText(m.title, W / 2 + 5, y0 + 5);
        c.fillStyle = m.color;
        c.fillText(m.title, W / 2, y0);
        c.fillStyle = '#fff';
        lines.forEach((l, i) => {
            let fs = 30;
            c.font = `${fs}px ${FONT}`;
            while (c.measureText(l).width > W - 110 && fs > 14) { fs -= 2; c.font = `${fs}px ${FONT}`; }
            c.fillText(l, W / 2, y0 + 92 + i * 52);
        });
        this.box.tex.needsUpdate = true;
    }

    drawDash() {
        const g = this.g, r = g.ride, c = this.dash.ctx, W = 512, H = 256;
        c.fillStyle = '#10081e';
        c.fillRect(0, 0, W, H);
        c.strokeStyle = '#ff2d8a';
        c.lineWidth = 8;
        c.strokeRect(4, 4, W - 8, H - 8);
        c.textAlign = 'left';
        c.textBaseline = 'middle';
        c.font = `30px ${FONT}`;
        c.fillStyle = '#3bff6a';
        c.fillText(`${Math.round(r.v * 3.6)} KM/H`, 24, 50);
        c.fillStyle = '#3bb4ff';
        c.fillText(`${Math.max(0, Math.round(r.pos.y - 1.2))} M`, 24, 104);
        const gv = r.gv;
        c.fillStyle = gv < 0.2 ? '#ff7ad9' : gv > 3.5 ? '#ff3b3b' : '#ffe14d';
        c.fillText(`${gv.toFixed(1)} G`, 24, 158);
        c.fillStyle = '#fff';
        c.fillText(`• ${g.score}/${g.world.balloonTotal}`, 24, 212);
        c.font = `14px ${FONT}`;
        c.fillStyle = '#b090ff';
        c.textAlign = 'right';
        c.fillText('SPEED', W - 24, 50);
        c.fillText('HEIGHT', W - 24, 104);
        c.fillText('G-FORCE', W - 24, 158);
        c.fillText('POPPED', W - 24, 212);
        this.dash.tex.needsUpdate = true;
    }
}
