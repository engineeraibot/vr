// Buttons you press by looking at them and tapping. They sit low in front of you and
// only fade in when you look down, so they don't cover the screen.
import * as THREE from 'three';

const DIST = 1.25;
const PITCH = THREE.MathUtils.degToRad(-40);
const BW = 0.2, BH = 0.075, GAP = 0.02, PER_ROW = 4;

export class Toolbar {
    constructor(buttons) {
        this.group = new THREE.Group();
        this.group.position.set(0, Math.sin(PITCH) * DIST, -Math.cos(PITCH) * DIST);
        this.group.lookAt(0, 0, 0);
        this.opacity = 0;
        this.buttons = buttons.map((b, i) => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 96;
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
            mesh.renderOrder = 10;
            const row = Math.floor(i / PER_ROW), col = i % PER_ROW;
            const n = Math.min(PER_ROW, buttons.length - row * PER_ROW);
            mesh.position.set((col - (n - 1) / 2) * (BW + GAP), -row * (BH + GAP), 0);
            this.group.add(mesh);
            const button = { ...b, mesh, canvas, tex, hot: false };
            mesh.userData.button = button;
            this.draw(button);
            return button;
        });

        this.statusCanvas = document.createElement('canvas');
        this.statusCanvas.width = 1024;
        this.statusCanvas.height = 64;
        this.statusTex = new THREE.CanvasTexture(this.statusCanvas);
        this.statusTex.colorSpace = THREE.SRGBColorSpace;
        const sw = PER_ROW * (BW + GAP);
        this.status = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 16),
            new THREE.MeshBasicMaterial({ map: this.statusTex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
        this.status.renderOrder = 10;
        this.status.position.set(0, BH / 2 + GAP + sw / 32, 0);
        this.group.add(this.status);
        this.statusText = null;
        this.setStatus('');
    }

    draw(b) {
        const label = typeof b.label === 'function' ? b.label() : b.text;
        const enabled = b.enabled !== false;
        const key = `${label}|${b.hot}|${enabled}|${b.on ? b.on() : ''}`;
        if (key === b.key) return;
        b.key = key;
        const g = b.canvas.getContext('2d'), w = b.canvas.width, h = b.canvas.height;
        g.clearRect(0, 0, w, h);
        g.fillStyle = b.hot ? '#3b82f6' : b.on && b.on() ? '#1e3a66' : 'rgba(20,26,38,0.92)';
        roundRect(g, 3, 3, w - 6, h - 6, 22);
        g.fill();
        g.lineWidth = 5;
        g.strokeStyle = b.hot ? '#ffffff' : '#5b7299';
        g.stroke();
        g.fillStyle = enabled ? '#ffffff' : '#6b7a90';
        g.font = 'bold 38px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, w / 2, h / 2 + 2);
        b.tex.needsUpdate = true;
    }

    setStatus(text) {
        if (text === this.statusText) return;
        this.statusText = text;
        const c = this.statusCanvas, g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = '#c8d4e8';
        g.font = '34px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, c.width / 2, c.height / 2);
        this.statusTex.needsUpdate = true;
    }

    // Fade in when the gaze points down; returns whether the buttons can be pressed.
    update(dt, gazePitch) {
        const want = gazePitch < THREE.MathUtils.degToRad(-20) ? 1 : 0;
        this.opacity += THREE.MathUtils.clamp(want - this.opacity, -4 * dt, 4 * dt);
        for (const b of this.buttons) {
            b.mesh.material.opacity = this.opacity;
            this.draw(b);
        }
        this.status.material.opacity = this.opacity;
        this.group.visible = this.opacity > 0.01;
        return this.opacity > 0.6;
    }

    hit(raycaster) {
        const h = raycaster.intersectObjects(this.buttons.map(b => b.mesh), false)[0];
        return h ? { button: h.object.userData.button, distance: h.distance } : null;
    }

    setHot(button) {
        for (const b of this.buttons) b.hot = b === button;
    }
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}
