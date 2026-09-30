// Hit effects: flying chips, spinning stars, "+1" labels and bomb blasts. Sizes in metres.
import * as THREE from 'three';
import { glowTexture } from './moles.js';

const MAX_CHIPS = 240;
const MAX_STARS = 40;
const GRAVITY = 1.1;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

function starGeometry() {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.45 : 1;
        if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    return new THREE.ShapeGeometry(s);
}

function pool(n) {
    return Array.from({ length: n }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 0, rot: 0, spin: 0 }));
}

export class Effects {
    constructor() {
        this.group = new THREE.Group();
        this.chipMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), MAX_CHIPS);
        this.starMesh = new THREE.InstancedMesh(starGeometry(), new THREE.MeshBasicMaterial({ color: 0xffe14a, side: THREE.DoubleSide }), MAX_STARS);
        for (const m of [this.chipMesh, this.starMesh]) {
            m.frustumCulled = false;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.renderOrder = 30;
            this.group.add(m);
        }
        for (let i = 0; i < MAX_CHIPS; i++) this.chipMesh.setColorAt(i, _c.set(0xffffff));
        this.chips = pool(MAX_CHIPS);
        this.stars = pool(MAX_STARS);
        this.nextChip = 0;
        this.nextStar = 0;
        // Floating text.
        this.texts = Array.from({ length: 6 }, () => {
            const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
            sprite.renderOrder = 40;
            sprite.visible = false;
            this.group.add(sprite);
            return { canvas, tex, sprite, life: 0, v: 0 };
        });
        this.nextText = 0;
        // Blast flashes.
        const glow = glowTexture('rgba(255,255,230,1)', 'rgba(255,120,20,0.9)');
        this.blasts = Array.from({ length: 3 }, () => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
            sprite.renderOrder = 35;
            sprite.visible = false;
            this.group.add(sprite);
            return { sprite, life: 0 };
        });
        this.nextBlast = 0;
    }

    burst(pos, color, n, speed = 0.45, size = 0.006, life = 0.7) {
        for (let i = 0; i < n; i++) {
            const k = this.nextChip;
            this.nextChip = (k + 1) % MAX_CHIPS;
            const c = this.chips[k];
            c.p.copy(pos);
            c.v.set(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
            c.size = size * (0.6 + Math.random() * 0.8);
            c.life = c.max = life * (0.7 + Math.random() * 0.6);
            c.rot = Math.random() * 6;
            c.spin = (Math.random() - 0.5) * 20;
            this.chipMesh.setColorAt(k, _c.set(color));
        }
        this.chipMesh.instanceColor.needsUpdate = true;
    }

    starBurst(pos, n = 6) {
        for (let i = 0; i < n; i++) {
            const k = this.nextStar;
            this.nextStar = (k + 1) % MAX_STARS;
            const s = this.stars[k];
            const a = i / n * Math.PI * 2;
            s.p.copy(pos);
            s.v.set(Math.cos(a) * 0.25, 0.25 + Math.sin(a) * 0.2, (Math.random() - 0.5) * 0.1);
            s.size = 0.011;
            s.life = s.max = 0.6;
            s.rot = a;
            s.spin = 8;
        }
    }

    text(pos, str, color = '#ffffff', size = 0.05) {
        const t = this.texts[this.nextText];
        this.nextText = (this.nextText + 1) % this.texts.length;
        const c = t.canvas.getContext('2d');
        c.clearRect(0, 0, 256, 128);
        c.font = 'bold 84px Fredoka, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = 12;
        c.strokeStyle = '#2a1500';
        c.strokeText(str, 128, 66);
        c.fillStyle = color;
        c.fillText(str, 128, 66);
        t.tex.needsUpdate = true;
        t.sprite.position.copy(pos);
        t.sprite.scale.set(size * 2, size, 1);
        t.sprite.visible = true;
        t.life = 1;
    }

    blast(pos) {
        const b = this.blasts[this.nextBlast];
        this.nextBlast = (this.nextBlast + 1) % this.blasts.length;
        b.sprite.position.copy(pos);
        b.life = 1;
        b.sprite.visible = true;
        this.burst(pos, 0xff3030, 30, 0.9, 0.008, 0.9);
        this.burst(pos, 0xffa020, 20, 0.7, 0.007, 0.7);
        this.burst(pos, 0x222222, 20, 0.6, 0.009, 1.0);
    }

    update(dt, camQuat) {
        const step = (list, mesh, facing) => {
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                if (c.life > 0) {
                    c.life -= dt;
                    c.v.y -= GRAVITY * dt;
                    c.p.addScaledVector(c.v, dt);
                    c.rot += c.spin * dt;
                }
                const s = c.life > 0 ? c.size * Math.min(1, c.life / c.max * 2.5) : 0;
                if (facing) _q.copy(camQuat).multiply(_q2.setFromAxisAngle(_s.set(0, 0, 1), c.rot));
                else _q.setFromEuler(_e.set(c.rot, c.rot * 0.7, 0));
                _m.compose(c.p, _q, _s.set(s, s, s));
                mesh.setMatrixAt(i, _m);
            }
            mesh.instanceMatrix.needsUpdate = true;
        };
        step(this.chips, this.chipMesh, false);
        step(this.stars, this.starMesh, true);
        for (const t of this.texts) {
            if (t.life <= 0) continue;
            t.life -= dt / 0.9;
            t.sprite.position.y += dt * 0.07;
            t.sprite.material.opacity = Math.min(1, t.life * 2);
            if (t.life <= 0) t.sprite.visible = false;
        }
        for (const b of this.blasts) {
            if (b.life <= 0) continue;
            b.life -= dt / 0.4;
            b.sprite.scale.setScalar(0.05 + (1 - b.life) * 0.25);
            b.sprite.material.opacity = Math.max(0, b.life);
            if (b.life <= 0) b.sprite.visible = false;
        }
    }
}
