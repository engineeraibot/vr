// Camera passthrough: the back camera's picture fills your view, so the moles pop out in your
// own room. One camera means both eyes get the same picture; it's placed at arm's length,
// where your hands and the holes are.
//
// The picture is drawn on a plane sized to the camera's field of view and turned the way your
// head pointed when the frame was taken (a little in the past: the camera lags). That keeps the
// room still while the virtual holes, which live in the world, stay put too.
//
// Your hands are drawn a second time, on top of the moles, through a mask made from the tracked
// hand shapes, so a real hand in front of a mole covers it.
import * as THREE from 'three';
import { BONES } from './hands.js';

const WIDTH = 800;            // passthrough picture width (px)
const MASK_W = 160;           // hand mask width (px)
const EDGE = 0.07;            // the picture fades out over this fraction near its edges

const VERT = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;

const BG_FRAG = `
    uniform sampler2D map;
    uniform float edge;
    uniform float aspect;
    varying vec2 vUv;
    void main() {
        vec2 e = min(vUv, 1.0 - vUv);
        float v = smoothstep(0.0, edge, e.x) * smoothstep(0.0, edge * aspect, e.y);
        gl_FragColor = vec4(texture2D(map, vUv).rgb * v, 1.0);
        #include <colorspace_fragment>
    }`;

const FG_FRAG = `
    uniform sampler2D map;
    uniform sampler2D mask;
    varying vec2 vUv;
    void main() {
        float a = texture2D(mask, vUv).a;
        if (a < 0.02) discard;
        gl_FragColor = vec4(texture2D(map, vUv).rgb, a);
        #include <colorspace_fragment>
    }`;

// Where your head pointed recently, to look up the orientation for a camera frame's time.
export class HeadHistory {
    constructor(size = 90) {
        this.items = Array.from({ length: size }, () => ({ t: -1, q: new THREE.Quaternion() }));
        this.n = 0;
        this.head = 0;
    }

    clear() { this.n = 0; }

    push(t, q) {
        this.head = (this.head + 1) % this.items.length;
        const it = this.items[this.head];
        it.t = t;
        it.q.copy(q);
        this.n = Math.min(this.n + 1, this.items.length);
    }

    at(t, out) {
        if (!this.n) return out.identity();
        const len = this.items.length;
        let newer = this.items[this.head];
        if (t >= newer.t) return out.copy(newer.q);
        for (let i = 1; i < this.n; i++) {
            const older = this.items[(this.head - i + len) % len];
            if (older.t <= t) {
                const k = (t - older.t) / Math.max(1e-6, newer.t - older.t);
                return out.slerpQuaternions(older.q, newer.q, k);
            }
            newer = older;
        }
        return out.copy(newer.q);
    }
}

export class Passthrough {
    constructor() {
        this.canvas = Object.assign(document.createElement('canvas'), { width: WIDTH, height: WIDTH * 3 / 4 });
        this.tex = new THREE.CanvasTexture(this.canvas);
        this.tex.colorSpace = THREE.SRGBColorSpace;
        this.tex.minFilter = THREE.LinearFilter;
        this.tex.generateMipmaps = false;
        this.mask = Object.assign(document.createElement('canvas'), { width: MASK_W, height: MASK_W * 3 / 4 });
        this.sharp = Object.assign(document.createElement('canvas'), { width: MASK_W, height: MASK_W * 3 / 4 });
        this.maskTex = new THREE.CanvasTexture(this.mask);
        this.maskTex.minFilter = THREE.LinearFilter;
        this.maskTex.generateMipmaps = false;

        const uniforms = {
            map: { value: this.tex },
            mask: { value: this.maskTex },
            edge: { value: EDGE },
            aspect: { value: 4 / 3 },
        };
        const plane = new THREE.PlaneGeometry(1, 1);
        this.bg = new THREE.Mesh(plane, new THREE.ShaderMaterial({
            uniforms, vertexShader: VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false,
        }));
        this.bg.renderOrder = -100;           // first: everything else is drawn over the room
        this.fg = new THREE.Mesh(plane, new THREE.ShaderMaterial({
            uniforms, vertexShader: VERT, fragmentShader: FG_FRAG, transparent: true, depthTest: false, depthWrite: false,
        }));
        this.fg.renderOrder = 50;             // after the moles
        this.fg.visible = false;
        for (const m of [this.bg, this.fg]) m.frustumCulled = false;
        this.group = new THREE.Group();
        this.group.add(this.bg, this.fg);
        this.group.visible = false;
        this.uniforms = uniforms;
        this.lastVideoTime = -1;
        this.frameT = 0;
        this.hasFrame = false;
        this.maskEmpty = true;
    }

    // Copy a new camera frame into the picture. now = seconds.
    grab(tracker, now) {
        const v = tracker.video;
        if (tracker.status !== 'running' || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastVideoTime) return;
        this.lastVideoTime = v.currentTime;
        if (tracker.drawVideo(this.canvas)) {
            // A texture can't change size once uploaded: start it again.
            this.tex.dispose();
            this.mask.height = this.sharp.height = Math.round(MASK_W * this.canvas.height / this.canvas.width);
            this.maskTex.dispose();
            this.uniforms.aspect.value = this.canvas.width / this.canvas.height;
        }
        this.tex.needsUpdate = true;
        this.frameT = now;
        this.hasFrame = true;
    }

    // quat: head orientation when the frame was taken; tanH / tanV: the camera's half field of view (tangents).
    place(quat, tanH, tanV, dist) {
        this.group.quaternion.copy(quat);
        for (const m of [this.bg, this.fg]) {
            m.position.set(0, 0, -dist);
            m.scale.set(2 * dist * tanH, 2 * dist * tanV, 1);
        }
    }

    // Hand shapes (landmarks in the upright picture, 0..1) -> soft mask.
    drawMask(hands) {
        const w = this.sharp.width, h = this.sharp.height;
        const c = this.sharp.getContext('2d');
        c.clearRect(0, 0, w, h);
        c.fillStyle = c.strokeStyle = '#fff';
        c.lineCap = c.lineJoin = 'round';
        for (const lm of hands) {
            const P = i => [lm[i].x * w, lm[i].y * h];
            const size = Math.hypot((lm[9].x - lm[0].x) * w, (lm[9].y - lm[0].y) * h);
            // Generous outlines: the mask is a little behind the picture (detection takes time).
            c.lineWidth = size * 0.42;
            for (const bone of BONES) {
                c.beginPath();
                bone.forEach((i, n) => (n ? c.lineTo(...P(i)) : c.moveTo(...P(i))));
                c.stroke();
            }
            c.beginPath();
            [0, 1, 5, 9, 13, 17].forEach((i, n) => (n ? c.lineTo(...P(i)) : c.moveTo(...P(i))));
            c.closePath();
            c.fill();
            c.stroke();
            // The wrist and a bit of forearm.
            const [x0, y0] = P(0), [x9, y9] = P(9);
            c.lineWidth = size * 0.7;
            c.beginPath();
            c.moveTo(x0, y0);
            c.lineTo(x0 - (x9 - x0) * 0.8, y0 - (y9 - y0) * 0.8);
            c.stroke();
        }
        const m = this.mask.getContext('2d');
        m.clearRect(0, 0, w, h);
        m.filter = 'blur(1.5px)';
        m.drawImage(this.sharp, 0, 0);
        m.filter = 'none';
        this.maskTex.needsUpdate = true;
        this.maskEmpty = hands.length === 0;
    }
}
