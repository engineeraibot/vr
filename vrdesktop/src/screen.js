// The virtual monitor: a (curved) screen around the viewer that shows the PC's video,
// or a message while there is none.
import * as THREE from 'three';

const LS = 'vrdesktop.screen';
const TILT = THREE.MathUtils.degToRad(4);   // screen centre a little below eye level
const MAX_ARC = THREE.MathUtils.degToRad(170);

export class VirtualScreen {
    constructor(renderer) {
        this.group = new THREE.Group();
        this.width = 2.6;       // metres (along the curve)
        this.distance = 2.0;    // metres from the eyes (the curve's radius)
        this.curved = true;
        this.aspect = 16 / 9;
        try { Object.assign(this, pick(JSON.parse(localStorage.getItem(LS)))); } catch { /* ignore */ }

        const v = this.video = document.createElement('video');
        v.playsInline = true;
        v.autoplay = true;
        v.muted = true;
        v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(v);
        v.addEventListener('resize', () => {
            if (v.videoWidth && v.videoHeight) this.setAspect(v.videoWidth / v.videoHeight);
        });

        const aniso = renderer.capabilities.getMaxAnisotropy();
        const vt = this.videoTexture = new THREE.VideoTexture(v);
        vt.colorSpace = THREE.SRGBColorSpace;
        // Mipmaps + anisotropy keep small text from shimmering on the curve.
        vt.generateMipmaps = true;
        vt.minFilter = THREE.LinearMipmapLinearFilter;
        vt.anisotropy = aniso;

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1280;
        this.canvas.height = 720;
        const ct = this.messageTexture = new THREE.CanvasTexture(this.canvas);
        ct.colorSpace = THREE.SRGBColorSpace;
        ct.anisotropy = aniso;

        this.material = new THREE.MeshBasicMaterial({ map: ct, side: THREE.DoubleSide, toneMapped: false, fog: false });
        this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        this.group.add(this.mesh);

        // A soft glow on the floor under the screen.
        const glow = document.createElement('canvas');
        glow.width = glow.height = 128;
        const g = glow.getContext('2d');
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(120,160,255,0.35)');
        grad.addColorStop(1, 'rgba(120,160,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(glow), transparent: true, depthWrite: false, fog: false,
        }));
        this.glow.rotation.x = -Math.PI / 2;
        this.group.add(this.glow);

        this.showMessage('VR Desktop', 'Waiting for your PC...');
        this.build();
    }

    get live() { return this.material.map === this.videoTexture; }

    setStream(stream) {
        if (stream) {
            this.video.srcObject = stream;
            this.video.play().catch(() => {});
            this.material.map = this.videoTexture;
        } else {
            this.video.srcObject = null;
            this.material.map = this.messageTexture;
            this.setAspect(16 / 9);
        }
        this.material.needsUpdate = true;
    }

    setSound(on) {
        this.video.muted = !on;
        if (this.video.srcObject) this.video.play().catch(() => {});
    }

    showMessage(title, sub = '') {
        const c = this.canvas, g = c.getContext('2d');
        const bg = g.createLinearGradient(0, 0, 0, c.height);
        bg.addColorStop(0, '#1b2433');
        bg.addColorStop(1, '#0d121b');
        g.fillStyle = bg;
        g.fillRect(0, 0, c.width, c.height);
        g.strokeStyle = '#3b82f6';
        g.lineWidth = 8;
        g.strokeRect(4, 4, c.width - 8, c.height - 8);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.font = 'bold 84px system-ui, sans-serif';
        g.fillText(title, c.width / 2, c.height * 0.36);
        g.fillStyle = '#a9b8d0';
        g.font = '40px system-ui, sans-serif';
        const lines = wrap(g, sub, c.width - 160);
        lines.forEach((line, i) => g.fillText(line, c.width / 2, c.height * 0.56 + i * 56));
        this.messageTexture.needsUpdate = true;
    }

    setAspect(a) {
        if (Math.abs(a - this.aspect) < 1e-3) return;
        this.aspect = a;
        this.build();
    }

    // Resize / move: factor > 1 makes it bigger / further.
    resize(factor) {
        this.width = THREE.MathUtils.clamp(this.width * factor, 0.6, 12);
        this.build();
        this.save();
    }

    move(factor) {
        const d = THREE.MathUtils.clamp(this.distance * factor, 0.6, 8);
        this.width *= d / this.distance;   // same apparent size, just further away
        this.distance = d;
        this.build();
        this.save();
    }

    toggleCurve() {
        this.curved = !this.curved;
        this.build();
        this.save();
    }

    save() {
        try {
            localStorage.setItem(LS, JSON.stringify({ width: this.width, distance: this.distance, curved: this.curved }));
        } catch { /* ignore */ }
    }

    build() {
        const R = this.distance;
        let W = this.width;
        if (this.curved) W = Math.min(W, MAX_ARC * R);
        const H = W / this.aspect;
        const yc = -Math.tan(TILT) * R;
        let geo;
        if (this.curved) {
            // A slice of a cylinder around the eyes, so every part of the screen is equally far away.
            const arc = W / R, seg = Math.max(8, Math.ceil(arc / 0.03));
            const pos = [], uv = [], idx = [];
            for (let i = 0; i <= seg; i++) {
                const u = i / seg, a = (u - 0.5) * arc;
                const x = R * Math.sin(a), z = -R * Math.cos(a);
                pos.push(x, yc - H / 2, z, x, yc + H / 2, z);
                uv.push(u, 0, u, 1);
                if (i < seg) {
                    const k = i * 2;
                    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
                }
            }
            geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            geo.setIndex(idx);
            geo.computeBoundingSphere();
        } else {
            geo = new THREE.PlaneGeometry(W, H);
            geo.translate(0, yc, -R);
        }
        this.mesh.geometry.dispose();
        this.mesh.geometry = geo;
        this.glow.scale.set(W * 1.3, R * 1.2, 1);
        this.glow.position.set(0, -1.19, -R * 0.75);
    }

    // Where the ray hits the screen, as 0..1 from the top-left corner, or null.
    hit(raycaster) {
        const h = raycaster.intersectObject(this.mesh, false)[0];
        if (!h || !h.uv) return null;
        return { x: h.uv.x, y: 1 - h.uv.y, distance: h.distance };
    }
}

function pick(o) {
    const out = {};
    if (o && o.width > 0) out.width = o.width;
    if (o && o.distance > 0) out.distance = o.distance;
    if (o && typeof o.curved === 'boolean') out.curved = o.curved;
    return out;
}

function wrap(g, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
            const t = line ? line + ' ' + word : word;
            if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
        }
        out.push(line);
    }
    return out;
}
