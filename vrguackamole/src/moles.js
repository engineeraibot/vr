// The field: nine little floating grass islands with a real hole in each, and the moles and
// bombs that pop out of them. Everything is built from primitives; sizes are in metres.
import * as THREE from 'three';

// Hole positions as fractions of the view: the original game's staggered 3 x 3 grid.
export const LAYOUT = [
    { x: 0.18, y: 0.32 }, { x: 0.50, y: 0.27 }, { x: 0.82, y: 0.34 },
    { x: 0.15, y: 0.55 }, { x: 0.50, y: 0.50 }, { x: 0.85, y: 0.57 },
    { x: 0.25, y: 0.80 }, { x: 0.55, y: 0.76 }, { x: 0.78, y: 0.83 },
];
export const CENTER = 4;

const HOLE_R = 0.05;          // the hole the moles come out of
const TOP_R = 0.088;          // the island's grass top
const DEPTH = 0.15;           // how deep the hole goes
const DOWN = -0.15;           // mole position (its feet) when hidden...
const UP = -0.02;             // ...and when out
const TILT = THREE.MathUtils.degToRad(58);   // most an island's top turns away from your eyes
const HIT_R = { mole: 0.05, bomb: 0.045, start: 0.075 };
const HEAD_Y = { mole: 0.065, bomb: 0.045, start: 0.09 };
const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4();

let grad = null;
function toon(color, extra = {}) {
    if (!grad) {
        grad = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
        grad.minFilter = grad.magFilter = THREE.NearestFilter;
        grad.needsUpdate = true;
    }
    return new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
}

function buildIsland() {
    const g = new THREE.Group();
    const grass = toon(0x62b63c), grassDark = toon(0x3f8f28), dirt = toon(0x7a4f2c), rim = toon(0x4a2d16);
    const top = mesh(new THREE.RingGeometry(HOLE_R, TOP_R, 36, 1), grass);
    top.rotation.x = -Math.PI / 2;
    const lip = mesh(new THREE.CylinderGeometry(TOP_R * 1.03, TOP_R * 0.96, 0.02, 36, 1, true), grass, 0, -0.01, 0);
    const side = mesh(new THREE.CylinderGeometry(TOP_R * 0.97, 0.052, DEPTH, 36, 1, true), dirt, 0, -DEPTH / 2, 0);
    const bottom = mesh(new THREE.CircleGeometry(0.052, 24), dirt, 0, -DEPTH, 0);
    bottom.rotation.x = Math.PI / 2;
    const root = mesh(new THREE.ConeGeometry(0.045, 0.06, 7), dirt, 0, -DEPTH - 0.03, 0);
    root.rotation.x = Math.PI;
    // Inside of the hole: dark walls and floor.
    const tube = mesh(new THREE.CylinderGeometry(HOLE_R, HOLE_R, DEPTH, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x24140a, side: THREE.BackSide }), 0, -DEPTH / 2, 0);
    const floor = mesh(new THREE.CircleGeometry(HOLE_R, 24), new THREE.MeshBasicMaterial({ color: 0x100804 }), 0, -DEPTH + 0.003, 0);
    floor.rotation.x = -Math.PI / 2;
    const ring = mesh(new THREE.TorusGeometry(HOLE_R + 0.004, 0.006, 8, 36), rim, 0, 0.001, 0);
    ring.rotation.x = Math.PI / 2;
    g.add(top, lip, side, bottom, root, tube, floor, ring);
    // Grass tufts, pebbles and a couple of flowers.
    const tuft = new THREE.ConeGeometry(0.006, 0.022, 5);
    for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + 0.3, r = (HOLE_R + TOP_R) / 2 + Math.sin(i * 7.3) * 0.012;
        const t = mesh(tuft, grassDark, Math.cos(a) * r, 0.01, Math.sin(a) * r);
        t.rotation.set(Math.sin(i * 3.1) * 0.3, 0, Math.cos(i * 2.3) * 0.3);
        g.add(t);
    }
    const pebble = new THREE.DodecahedronGeometry(0.008, 0), stone = toon(0x9a9486);
    for (let i = 0; i < 4; i++) {
        const a = i * 1.9 + 1, h = -0.03 - i * 0.025;
        const r = TOP_R * 0.97 + (0.052 - TOP_R * 0.97) * (-h / DEPTH);
        g.add(mesh(pebble, stone, Math.cos(a) * r, h, Math.sin(a) * r));
    }
    const petal = new THREE.SphereGeometry(0.005, 8, 6), stem = toon(0x2f7a1e);
    [[0xffe14a, 2.2], [0xff7ab8, 4.4]].forEach(([col, a]) => {
        const r = TOP_R * 0.82;
        const f = mesh(petal, toon(col), Math.cos(a) * r, 0.02, Math.sin(a) * r);
        const s = mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.02, 4), stem, Math.cos(a) * r, 0.01, Math.sin(a) * r);
        g.add(f, s);
    });
    return g;
}

// A mole: feet at the origin, facing +z.
function buildMole() {
    const g = new THREE.Group();
    const fur = toon(0x8a5a32), dark = toon(0x5d3618), tan = toon(0xdcae80), pink = toon(0xff8fa8), black = toon(0x161010), white = toon(0xffffff);
    const body = mesh(new THREE.SphereGeometry(0.04, 22, 16), fur, 0, 0.048, 0);
    body.scale.set(1, 1.2, 0.95);
    const belly = mesh(new THREE.SphereGeometry(0.03, 16, 12), tan, 0, 0.036, 0.022);
    belly.scale.set(0.95, 1.05, 0.55);
    const snout = mesh(new THREE.SphereGeometry(0.017, 16, 12), tan, 0, 0.057, 0.033);
    snout.scale.set(1.15, 0.82, 1);
    const nose = mesh(new THREE.SphereGeometry(0.0085, 12, 8), pink, 0, 0.063, 0.049);
    g.add(body, belly, snout, nose);
    // Squinty eyes, swapped for X eyes when whacked.
    const eyes = new THREE.Group();
    eyes.name = 'eyes';
    for (const s of [-1, 1]) {
        const e = mesh(new THREE.SphereGeometry(0.0055, 10, 8), black, s * 0.015, 0.078, 0.032);
        e.scale.set(1.5, 0.55, 0.6);
        e.rotation.z = s * 0.25;
        eyes.add(e);
    }
    const xeyes = new THREE.Group();
    xeyes.name = 'xeyes';
    xeyes.visible = false;
    const bar = new THREE.BoxGeometry(0.013, 0.0028, 0.002);
    for (const s of [-1, 1]) {
        for (const r of [-1, 1]) {
            const b = mesh(bar, black, s * 0.015, 0.078, 0.036);
            b.rotation.set(-0.35, 0, r * Math.PI / 4);
            xeyes.add(b);
        }
    }
    g.add(eyes, xeyes);
    const tooth = new THREE.BoxGeometry(0.0065, 0.009, 0.003);
    g.add(mesh(tooth, white, -0.0037, 0.046, 0.045), mesh(tooth, white, 0.0037, 0.046, 0.045));
    for (const s of [-1, 1]) {
        const paw = mesh(new THREE.SphereGeometry(0.012, 12, 10), dark, s * 0.033, 0.024, 0.026);
        paw.scale.set(1.2, 0.8, 1);
        g.add(paw);
        for (let i = -1; i <= 1; i++) g.add(mesh(new THREE.SphereGeometry(0.0026, 6, 5), white, s * 0.033 + i * 0.005, 0.018, 0.037));
        g.add(mesh(new THREE.SphereGeometry(0.008, 10, 8), dark, s * 0.029, 0.09, 0.004));   // ear
    }
    // Whiskers.
    const pts = [];
    for (const s of [-1, 1]) {
        for (let i = -1; i <= 1; i++) pts.push(s * 0.012, 0.058 + i * 0.003, 0.046, s * 0.042, 0.06 + i * 0.008, 0.04);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x222222 })));
    // A tuft of hair on top.
    for (let i = -1; i <= 1; i++) {
        const h = mesh(new THREE.ConeGeometry(0.004, 0.014, 5), dark, i * 0.006, 0.105, 0);
        h.rotation.z = -i * 0.4;
        g.add(h);
    }
    return g;
}

function skullTexture() {
    const c = Object.assign(document.createElement('canvas'), { width: 512, height: 256 });
    const x = c.getContext('2d');
    x.fillStyle = '#1a1a1a';
    x.fillRect(0, 0, 512, 256);
    // The sphere's front (+z) is at u = 0.25.
    x.translate(128, 122);
    x.fillStyle = '#f4f4f0';
    x.beginPath();
    x.arc(0, -6, 26, 0, Math.PI * 2);
    x.fill();
    x.fillRect(-15, 10, 30, 18);
    x.fillStyle = '#1a1a1a';
    x.beginPath(); x.arc(-10, -6, 7.5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(10, -6, 7.5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(0, 3); x.lineTo(-4, 11); x.lineTo(4, 11); x.closePath(); x.fill();
    for (let i = -1; i <= 1; i++) x.fillRect(i * 9 - 1.5, 18, 3, 10);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function glowTexture(inner = 'rgba(255,255,220,1)', mid = 'rgba(255,170,0,0.8)') {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner);
    gr.addColorStop(0.35, mid);
    gr.addColorStop(1, 'rgba(255,60,0,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function buildBomb() {
    const g = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.037, 24, 16),
        new THREE.MeshPhongMaterial({ map: skullTexture(), shininess: 90, specular: 0x777777 }), 0, 0.045, 0);
    const cap = mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.012, 16), toon(0x555555), 0, 0.083, 0);
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.088, 0), new THREE.Vector3(0.004, 0.1, 0.002),
        new THREE.Vector3(-0.004, 0.112, 0.004), new THREE.Vector3(0.006, 0.122, 0.002),
    ]);
    const fuse = mesh(new THREE.TubeGeometry(curve, 12, 0.0025, 6), toon(0xa87040));
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    spark.name = 'spark';
    spark.position.set(0.006, 0.124, 0.002);
    spark.scale.setScalar(0.03);
    g.add(body, cap, fuse, spark);
    return g;
}

// The wooden sign the start mole holds up.
class Sign {
    constructor() {
        this.canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 224 });
        this.tex = new THREE.CanvasTexture(this.canvas);
        this.tex.colorSpace = THREE.SRGBColorSpace;
        const wood = toon(0xa8743e);
        const board = mesh(new THREE.BoxGeometry(0.16, 0.07, 0.008),
            [wood, wood, wood, wood, new THREE.MeshBasicMaterial({ map: this.tex }), wood], 0, 0.155, 0.03);
        const stick = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6), toon(0x7a5028), 0, 0.075, 0.03);
        this.group = new THREE.Group();
        this.group.add(board, stick);
        this.group.visible = false;
        this.label = '';
    }

    setLabel(label) {
        if (label === this.label) return;
        this.label = label;
        const c = this.canvas.getContext('2d');
        c.fillStyle = '#c98c4c';
        c.fillRect(0, 0, 512, 224);
        c.strokeStyle = '#8a5a2a';
        c.lineWidth = 3;
        for (let y = 30; y < 224; y += 46) { c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(170, y + 8, 340, y - 8, 512, y + 2); c.stroke(); }
        c.lineWidth = 10;
        c.strokeRect(5, 5, 502, 214);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#4a2408';
        c.font = 'bold 44px Fredoka, sans-serif';
        c.fillText('WHACK ME TO', 256, 62);
        c.fillStyle = '#e8420f';
        c.font = 'bold 84px Fredoka, sans-serif';
        c.fillText(label, 256, 150);
        this.tex.needsUpdate = true;
    }
}

class Hole {
    constructor(index, tpl) {
        this.index = index;
        this.group = new THREE.Group();
        this.group.add(tpl.island.clone());
        this.slot = new THREE.Group();
        this.slot.position.y = DOWN;
        this.group.add(this.slot);
        this.mole = tpl.mole.clone();
        this.bomb = tpl.bomb.clone();
        this.eyes = this.mole.getObjectByName('eyes');
        this.xeyes = this.mole.getObjectByName('xeyes');
        this.spark = this.bomb.getObjectByName('spark');
        this.mole.visible = this.bomb.visible = false;
        this.slot.add(this.mole, this.bomb);
        this.head = new THREE.Object3D();
        this.slot.add(this.head);
        this.kind = null;       // null | 'mole' | 'bomb' | 'start'
        this.progress = 0;      // 0 hidden .. 1 fully out
        this.hitT = -1;
        this.leaveT = -1;
    }

    // Put the island at dir * dist, its top turned toward your eyes.
    place(dir, dist) {
        const toEye = _a.copy(dir).multiplyScalar(-1).normalize();
        const up = _b;
        const ang = Y.angleTo(toEye);
        if (ang <= TILT) up.copy(Y);
        else {
            const tangent = _c.copy(Y).addScaledVector(toEye, -Y.dot(toEye)).normalize();
            up.copy(toEye).multiplyScalar(Math.cos(TILT)).addScaledVector(tangent, Math.sin(TILT));
        }
        const fwd = _c.copy(toEye).addScaledVector(up, -toEye.dot(up)).normalize();
        const right = _a.crossVectors(up, fwd);
        _m.makeBasis(right, up, fwd);
        this.group.quaternion.setFromRotationMatrix(_m);
        this.group.position.copy(dir).normalize().multiplyScalar(dist);
    }

    spawn(kind, duration, now) {
        this.kind = kind;
        this.t0 = now;
        this.duration = duration;
        this.hitT = -1;
        this.leaveT = -1;
        this.progress = 0;
        this.mole.visible = kind !== 'bomb';
        this.bomb.visible = kind === 'bomb';
        this.eyes.visible = true;
        this.xeyes.visible = false;
        this.mole.scale.set(1, 1, 1);
        this.bomb.scale.set(1, 1, 1);
        this.head.position.y = HEAD_Y[kind];
    }

    get radius() { return HIT_R[this.kind] || 0.05; }

    hittable() { return !!this.kind && this.hitT < 0 && this.leaveT < 0 && this.progress >= 0.4; }

    hit(now) {
        this.hitT = now;
        this.hitFrom = this.progress;
        if (this.kind !== 'bomb') { this.eyes.visible = false; this.xeyes.visible = true; }
    }

    // Duck back down now (game over, back to the title).
    leave(now) {
        if (!this.kind || this.hitT >= 0 || this.leaveT >= 0) return;
        this.leaveT = now;
        this.leaveFrom = this.progress;
    }

    clear() {
        this.kind = null;
        this.progress = 0;
        this.mole.visible = this.bomb.visible = false;
        this.slot.position.y = DOWN;
    }

    update(now) {
        if (!this.kind) return;
        let p;
        if (this.hitT >= 0) {
            const t = (now - this.hitT) / 0.35;
            if (t >= 1) { this.clear(); return; }
            p = this.hitFrom * (t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65);
        } else if (this.leaveT >= 0) {
            const t = (now - this.leaveT) / 0.2;
            if (t >= 1) { this.clear(); return; }
            p = this.leaveFrom * (1 - t);
        } else if (this.duration === Infinity) {
            p = Math.min(1, (now - this.t0) / 0.3);
        } else {
            // Same rhythm as the original: pop up, wait, duck. A mole that gets away costs nothing.
            const t = (now - this.t0) / this.duration;
            if (t >= 1) { this.clear(); return; }
            p = t < 0.18 ? t / 0.18 : t < 0.82 ? 1 : 1 - (t - 0.82) / 0.18;
        }
        this.progress = p;
        const e = p * p * (3 - 2 * p);
        this.slot.position.y = DOWN + (UP - DOWN) * e;
        const i = this.index;
        const model = this.kind === 'bomb' ? this.bomb : this.mole;
        if (this.hitT >= 0) {
            // Squashed flat by the whack.
            const k = Math.min(1, (now - this.hitT) / 0.07);
            model.scale.set(1 + 0.35 * k, 1 - 0.5 * k, 1 + 0.35 * k);
        } else if (this.kind === 'bomb') {
            model.rotation.z = Math.sin(now * 9 + i) * 0.06;
            this.spark.scale.setScalar(0.024 + Math.random() * 0.018);
        } else {
            // Looks around, a bit cheeky.
            model.rotation.y = Math.sin(now * 2.3 + i * 1.7) * (this.kind === 'start' ? 0.15 : 0.4);
            model.rotation.z = Math.sin(now * 7 + i) * 0.05;
        }
    }
}

export class Field {
    constructor() {
        const tpl = { island: buildIsland(), mole: buildMole(), bomb: buildBomb() };
        this.group = new THREE.Group();
        this.holes = LAYOUT.map((_, i) => new Hole(i, tpl));
        for (const h of this.holes) this.group.add(h.group);
        this.sign = new Sign();
        this.holes[CENTER].mole.add(this.sign.group);
    }

    layout(dirs, dist) {
        this.holes.forEach((h, i) => h.place(dirs[i], dist));
    }

    update(now) {
        for (const h of this.holes) h.update(now);
        this.sign.group.visible = this.holes[CENTER].kind === 'start';
    }

    free() { return this.holes.filter(h => !h.kind); }

    showStart(label, now) {
        this.sign.setLabel(label);
        const h = this.holes[CENTER];
        if (h.kind === 'start' && h.hitT < 0 && h.leaveT < 0) return;
        h.spawn('start', Infinity, now);
    }

    leaveAll(now) { for (const h of this.holes) h.leave(now); }

    clear() { for (const h of this.holes) h.clear(); }
}
