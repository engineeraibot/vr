// Low-poly models built from primitives. Each kart / driver / scenery piece is baked into
// one vertex-coloured geometry so a whole kart is a single draw call (phones need that).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

export const MAT = {};

const S = new THREE.SphereGeometry(1, 12, 9);
const HEMI = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const CONE = new THREE.ConeGeometry(1, 1, 12);
const PYRAMID = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4);
const TORUS = new THREE.TorusGeometry(1, 0.16, 8, 20);
const PI = Math.PI;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Baker {
    constructor() { this.parts = []; }

    add(geo, color, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        for (const k of Object.keys(g.attributes)) {
            if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        }
        g.clearGroups();
        _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scale));
        g.applyMatrix4(_m);
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        _c.set(color);
        for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this.parts.push(g);
        return this;
    }

    build() {
        const g = mergeGeometries(this.parts, false);
        this.parts.forEach(p => p.dispose());
        this.parts = [];
        g.computeBoundingSphere();
        return g;
    }
}

// ---------------------------------------------------------------- racers

export const CHARACTERS = [
    { name: 'MARIO', kart: 0xe01c1c, type: 'plumber', cap: 0xe01c1c, shirt: 0xe01c1c, pants: 0x2b4fd8, stache: 0x3a1c06 },
    { name: 'LUIGI', kart: 0x22aa33, type: 'plumber', cap: 0x22aa33, shirt: 0x22aa33, pants: 0x2b4fd8, stache: 0x3a1c06 },
    { name: 'PEACH', kart: 0xff8ccc, type: 'princess' },
    { name: 'TOAD', kart: 0x2f6be0, type: 'toad' },
    { name: 'YOSHI', kart: 0x44cc44, type: 'dino' },
    { name: 'D.K.', kart: 0x9b5a2c, type: 'ape' },
    { name: 'WARIO', kart: 0xf2c418, type: 'plumber', cap: 0xf2c418, shirt: 0xf2c418, pants: 0x7a2aa6, stache: 0x1a1a1a },
    { name: 'BOWSER', kart: 0x2f7a2f, type: 'koopa' },
];

const SKIN = 0xffcca0, WHITE = 0xffffff, BLACK = 0x151515, DARK = 0x2a2a30, GREY = 0x9aa0a8;

// Kart chassis, facing -z, origin on the ground between the wheels.
function kartGeometry(color, withWheel) {
    const b = new Baker();
    const trim = new THREE.Color(color).multiplyScalar(0.7).getHex();
    b.add(BOX, color, [0, 0.32, 0.05], [1.2, 0.2, 1.8]);
    b.add(BOX, color, [0, 0.42, -0.72], [0.95, 0.24, 0.6]);
    b.add(S, color, [0, 0.42, -1.0], [0.48, 0.15, 0.22]);
    b.add(BOX, DARK, [0, 0.26, -1.18], [1.25, 0.12, 0.14]);
    b.add(CYL, WHITE, [0, 0.55, -0.78], [0.15, 0.02, 0.15], [-0.25, 0, 0]);
    for (const s of [-1, 1]) b.add(BOX, trim, [s * 0.6, 0.44, 0.12], [0.22, 0.28, 1.0]);
    b.add(BOX, DARK, [0, 0.72, 0.5], [0.64, 0.62, 0.14], [0.2, 0, 0]);
    b.add(BOX, GREY, [0, 0.52, 0.86], [0.7, 0.3, 0.36]);
    for (const s of [-1, 1]) b.add(CYL, 0xdcdcdc, [s * 0.2, 0.56, 1.1], [0.07, 0.32, 0.07], [PI / 2, 0, 0]);
    for (const [x, z] of [[-0.72, -0.68], [0.72, -0.68], [-0.72, 0.72], [0.72, 0.72]]) {
        b.add(CYL, BLACK, [x, 0.3, z], [0.3, 0.3, 0.3], [0, 0, PI / 2]);
        b.add(CYL, GREY, [x + Math.sign(x) * 0.155, 0.3, z], [0.14, 0.02, 0.14], [0, 0, PI / 2]);
    }
    b.add(CYL, DARK, [0, 0.62, -0.32], [0.03, 0.45, 0.03], [0.9, 0, 0]);
    if (withWheel) b.add(TORUS, DARK, [0, 0.8, -0.2], [0.17, 0.17, 0.17], [-0.5, 0, 0]);
    return b.build();
}

function driverGeometry(ch) {
    const b = new Baker();
    const arms = (col, hand) => {
        for (const s of [-1, 1]) {
            b.add(S, col, [s * 0.25, 0.8, 0.0], [0.09, 0.09, 0.22], [0.5, 0, 0]);
            b.add(S, hand, [s * 0.16, 0.8, -0.22], [0.08, 0.08, 0.08]);
        }
    };
    const eyes = (y, z, iris = 0x1848d0, tall = 1) => {
        for (const s of [-1, 1]) {
            b.add(S, WHITE, [s * 0.08, y, z], [0.045, 0.06 * tall, 0.03]);
            b.add(S, iris, [s * 0.08, y - 0.005, z - 0.022], [0.022, 0.035 * tall, 0.015]);
        }
    };
    switch (ch.type) {
        case 'plumber':
            b.add(S, ch.shirt, [0, 0.84, 0.22], [0.3, 0.3, 0.26]);
            b.add(S, ch.pants, [0, 0.62, 0.15], [0.32, 0.18, 0.3]);
            b.add(BOX, ch.pants, [0, 0.8, -0.03], [0.3, 0.2, 0.06]);
            arms(ch.shirt, WHITE);
            b.add(S, SKIN, [0, 1.2, 0.18], [0.24, 0.24, 0.24]);
            b.add(S, 0x4a2408, [0, 1.2, 0.26], [0.23, 0.22, 0.2]);
            b.add(S, SKIN, [0, 1.17, -0.07], [0.075, 0.07, 0.08]);
            b.add(BOX, ch.stache, [0, 1.1, -0.04], [0.2, 0.05, 0.06]);
            eyes(1.26, -0.03);
            b.add(HEMI, ch.cap, [0, 1.25, 0.18], [0.26, 0.22, 0.26]);
            b.add(S, ch.cap, [0, 1.27, -0.07], [0.22, 0.03, 0.14]);
            b.add(S, WHITE, [0, 1.37, -0.03], [0.07, 0.07, 0.02], [-0.6, 0, 0]);
            break;
        case 'princess':
            b.add(CONE, 0xff8ccc, [0, 0.72, 0.2], [0.38, 0.55, 0.36]);
            b.add(S, 0xff8ccc, [0, 0.92, 0.2], [0.2, 0.2, 0.17]);
            b.add(S, 0x2a6ae0, [0, 0.98, 0.03], [0.04, 0.04, 0.02]);
            arms(0xffffff, WHITE);
            b.add(S, 0xffd84a, [0, 1.22, 0.26], [0.27, 0.29, 0.24]);
            for (const s of [-1, 1]) b.add(S, 0xffd84a, [s * 0.19, 1.04, 0.25], [0.1, 0.22, 0.1]);
            b.add(S, SKIN, [0, 1.2, 0.16], [0.22, 0.22, 0.22]);
            eyes(1.24, -0.04);
            b.add(CYL, 0xffd000, [0, 1.46, 0.16], [0.1, 0.1, 0.1]);
            b.add(S, 0xe0202a, [0, 1.46, 0.06], [0.03, 0.03, 0.02]);
            break;
        case 'toad':
            b.add(S, 0x2a5ad0, [0, 0.8, 0.2], [0.26, 0.27, 0.22]);
            b.add(S, WHITE, [0, 0.66, 0.17], [0.22, 0.14, 0.2]);
            arms(0x2a5ad0, WHITE);
            b.add(S, SKIN, [0, 1.08, 0.18], [0.2, 0.18, 0.19]);
            eyes(1.1, -0.0, 0x111111, 1.5);
            b.add(S, WHITE, [0, 1.3, 0.18], [0.4, 0.27, 0.38]);
            for (const [x, y, z] of [[0, 1.55, 0.12], [-0.33, 1.34, 0.12], [0.33, 1.34, 0.12], [0, 1.36, -0.18], [0, 1.4, 0.5]]) {
                b.add(S, 0xe0202a, [x, y, z], [0.12, 0.08, 0.12]);
            }
            break;
        case 'dino':
            b.add(S, 0x44cc44, [0, 0.82, 0.22], [0.28, 0.3, 0.25]);
            b.add(S, WHITE, [0, 0.8, 0.0], [0.2, 0.24, 0.08]);
            b.add(S, 0xe0202a, [0, 0.98, 0.42], [0.22, 0.1, 0.15]);
            arms(0x44cc44, 0x44cc44);
            b.add(S, 0x44cc44, [0, 1.2, 0.12], [0.24, 0.24, 0.24]);
            b.add(S, 0x44cc44, [0, 1.12, -0.18], [0.21, 0.16, 0.21]);
            for (const s of [-1, 1]) {
                b.add(S, WHITE, [s * 0.09, 1.38, 0.04], [0.08, 0.12, 0.08]);
                b.add(S, BLACK, [s * 0.09, 1.38, -0.03], [0.035, 0.06, 0.03]);
                b.add(S, 0x1c7a1c, [s * 0.06, 1.18, -0.38], [0.025, 0.025, 0.02]);
            }
            b.add(S, 0xe0602a, [0, 1.25, 0.35], [0.1, 0.1, 0.06]);
            break;
        case 'ape':
            b.add(S, 0x7a4420, [0, 0.86, 0.25], [0.42, 0.4, 0.33]);
            b.add(S, 0xe0b080, [0, 0.86, -0.02], [0.26, 0.26, 0.08]);
            b.add(BOX, 0xe0202a, [0, 0.95, -0.09], [0.14, 0.22, 0.04]);
            for (const s of [-1, 1]) {
                b.add(S, 0x7a4420, [s * 0.36, 0.82, 0.0], [0.14, 0.14, 0.3], [0.5, 0, 0]);
                b.add(S, 0xe0b080, [s * 0.2, 0.8, -0.26], [0.1, 0.1, 0.1]);
            }
            b.add(S, 0x7a4420, [0, 1.28, 0.2], [0.27, 0.25, 0.25]);
            b.add(S, 0xe0b080, [0, 1.22, 0.0], [0.2, 0.16, 0.12]);
            b.add(BOX, 0x5a3010, [0, 1.36, -0.02], [0.3, 0.06, 0.08]);
            eyes(1.3, -0.04, 0x111111);
            break;
        case 'koopa':
            b.add(S, 0xf0c070, [0, 0.9, 0.18], [0.42, 0.44, 0.36]);
            b.add(S, 0x2a8a2a, [0, 0.95, 0.46], [0.46, 0.46, 0.3]);
            for (const [x, y] of [[0, 1.3], [-0.25, 1.1], [0.25, 1.1], [0, 0.85]]) {
                b.add(CONE, WHITE, [x, y, 0.78], [0.07, 0.18, 0.07], [PI / 2, 0, 0]);
            }
            arms(0xf0a030, 0xf0a030);
            b.add(S, 0xf0a030, [0, 1.38, 0.14], [0.29, 0.26, 0.29]);
            b.add(S, 0xf0c070, [0, 1.3, -0.12], [0.22, 0.15, 0.15]);
            b.add(S, 0xe0302a, [0, 1.55, 0.3], [0.22, 0.12, 0.22]);
            for (const s of [-1, 1]) b.add(CONE, WHITE, [s * 0.16, 1.62, 0.12], [0.05, 0.16, 0.05], [0, 0, -s * 0.4]);
            eyes(1.45, -0.08, 0xe02020);
            break;
    }
    return b.build();
}

// A kart with its driver. The player's kart hides the driver in first-person view.
export function buildKart(ch, { withWheel = true } = {}) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const kart = new THREE.Mesh(kartGeometry(ch.kart, withWheel), MAT.vcol);
    const driver = new THREE.Mesh(driverGeometry(ch), MAT.vcol);
    kart.castShadow = driver.castShadow = true;
    body.add(kart, driver);
    const flames = new THREE.Group();
    for (const s of [-1, 1]) {
        const f = new THREE.Mesh(CONE, MAT.flame);
        f.scale.set(0.09, 0.5, 0.09);
        f.rotation.x = PI / 2;
        f.position.set(s * 0.2, 0.56, 1.45);
        flames.add(f);
    }
    flames.visible = false;
    body.add(flames);
    return { root, body, kart, driver, flames };
}

// First-person steering wheel with the two gloves that show where your hands are.
export function buildCockpitWheel() {
    const group = new THREE.Group();
    const wheel = new THREE.Group();
    group.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 10, 32), MAT.wheel);
    wheel.add(rim);
    const hub = new THREE.Mesh(CYL, MAT.wheel);
    hub.scale.set(0.05, 0.04, 0.05);
    hub.rotation.x = PI / 2;
    wheel.add(hub);
    for (const a of [0, PI * 0.5, PI]) {
        const spoke = new THREE.Mesh(BOX, MAT.wheel);
        spoke.scale.set(0.2, 0.025, 0.02);
        spoke.position.set(Math.cos(a + PI) * 0.1, Math.sin(a + PI) * 0.1, 0);
        spoke.rotation.z = a;
        wheel.add(spoke);
    }
    const emblem = new THREE.Mesh(CYL, MAT.emblem);
    emblem.scale.set(0.035, 0.01, 0.035);
    emblem.rotation.x = PI / 2;
    emblem.position.z = 0.03;
    wheel.add(emblem);
    const gloves = [-1, 1].map(s => {
        const g = new THREE.Mesh(S, MAT.glove);
        g.scale.set(0.065, 0.075, 0.06);
        g.position.set(s * 0.2, 0, 0.01);
        wheel.add(g);
        return g;
    });
    group.rotation.x = -0.5;
    return { group, wheel, gloves };
}

// ---------------------------------------------------------------- scenery

export function addHill(b, x, z, r, h, baseY, color = 0x39b54a) {
    b.add(S, color, [x, baseY, z], [r, h, r * 0.85]);
}

export function addCloud(b, x, y, z, n) {
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        const r = 6 - Math.abs(t) * 4;
        b.add(S, WHITE, [x + t * n * 7, y + (1 - Math.abs(t) * 2) * 1.5, z], [r, r * 0.8, r * 0.9]);
    }
    b.add(S, WHITE, [x, y - 1.4, z], [n * 4.5, 2.5, 4.8]);
}

// Peach's-castle style landmark, door facing -z in local space.
export function castleGeometry() {
    const b = new Baker();
    const W = 0xf3e6c8, R = 0xd8322b, D = 0x4a2e1c, PINK = 0xf07ab0, YEL = 0xffe070, GR = 0x3fa648;
    b.add(S, GR, [0, -5, 4], [50, 9, 42]);
    b.add(BOX, W, [0, 10, 0], [34, 20, 22]);
    b.add(PYRAMID, R, [0, 24, 0], [25, 8, 16]);
    b.add(CYL, W, [0, 28, 0], [8, 16, 8]);
    b.add(CONE, R, [0, 41, 0], [9.5, 10, 9.5]);
    b.add(CYL, 0xffd000, [0, 47.5, 0], [0.3, 3, 0.3]);
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            b.add(CYL, W, [sx * 17, 13, sz * 11], [4, 26, 4]);
            b.add(CONE, R, [sx * 17, 30, sz * 11], [5, 8, 5]);
        }
        b.add(CYL, W, [sx * 7, 24, -8], [2.6, 10, 2.6]);
        b.add(CONE, R, [sx * 7, 33, -8], [3.4, 6, 3.4]);
    }
    b.add(BOX, D, [0, 3.5, -11.1], [5, 7, 0.4]);
    b.add(CYL, D, [0, 7, -11.1], [2.5, 0.4, 2.5], [PI / 2, 0, 0]);
    b.add(CYL, PINK, [0, 15, -11.15], [3.4, 0.3, 3.4], [PI / 2, 0, 0]);
    b.add(CYL, YEL, [0, 15, -11.3], [2.2, 0.3, 2.2], [PI / 2, 0, 0]);
    for (const x of [-12, -6, 6, 12]) b.add(BOX, 0x33415c, [x, 12, -11.1], [1.6, 3, 0.3]);
    for (let x = -16; x <= 16; x += 2.3) b.add(BOX, W, [x, 20.8, -10.6], [1.2, 1.6, 0.8]);
    b.add(BOX, 0x9a8f82, [0, 0.4, -19], [6, 0.8, 14]);
    return b.build();
}

export function grandstandGeometry(length) {
    const b = new Baker();
    const colors = [0xe03030, 0x3060e0, 0xf0d020, 0x30c040, 0xffffff, 0xff80c0, 0xf08020];
    let seed = 5;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let row = 0; row < 5; row++) {
        b.add(BOX, 0xb8b8c0, [row * 1.4, 0.6 + row * 0.9, 0], [1.4, 1.2 + row * 1.8, length]);
        for (let z = -length / 2 + 0.6; z < length / 2; z += 0.9) {
            if (rnd() < 0.25) continue;
            b.add(BOX, colors[(rnd() * colors.length) | 0], [row * 1.4, 1.5 + row * 1.8, z], [0.5, 0.7, 0.5]);
        }
    }
    b.add(BOX, 0x3a6ad0, [3.5, 10.5, 0], [8, 0.3, length + 2]);
    for (const z of [-length / 2, length / 2]) b.add(CYL, GREY, [6.5, 5.4, z], [0.2, 10.8, 0.2]);
    return b.build();
}

// Lakitu on his cloud with the start lights.
export function buildLakitu() {
    const group = new THREE.Group();
    const b = new Baker();
    for (const [x, y, z, r] of [[0, 0, 0, 0.9], [-0.8, -0.1, 0.1, 0.65], [0.8, -0.1, 0.1, 0.65], [0, -0.2, 0.5, 0.6]]) {
        b.add(S, WHITE, [x, y, z], [r, r * 0.7, r]);
    }
    b.add(S, 0x2aa02a, [0, 0.55, 0.15], [0.45, 0.45, 0.4]);
    b.add(S, 0xffe070, [0, 0.5, -0.12], [0.3, 0.35, 0.2]);
    b.add(S, 0xf0c040, [0, 1.15, 0], [0.34, 0.34, 0.34]);
    b.add(S, 0xf0c040, [0, 1.08, -0.3], [0.16, 0.12, 0.16]);
    for (const s of [-1, 1]) {
        b.add(S, WHITE, [s * 0.12, 1.26, -0.27], [0.1, 0.1, 0.05]);
        b.add(S, BLACK, [s * 0.12, 1.26, -0.31], [0.04, 0.05, 0.02]);
    }
    b.add(CYL, 0x8a5a2a, [0.5, 1.6, -0.5], [0.03, 2.2, 0.03], [-0.5, 0, -0.4]);
    b.add(CYL, 0x222222, [0.95, 1.6, -1.1], [0.01, 1.4, 0.01]);
    b.add(BOX, 0x222222, [0.95, 0.6, -1.1], [0.35, 1.0, 0.12]);
    group.add(new THREE.Mesh(b.build(), MAT.vcol));
    const lights = [0, 1, 2].map(i => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshBasicMaterial({ color: 0x331111 }));
        m.position.set(0.95, 0.92 - i * 0.3, -1.17);
        m.rotation.y = PI;
        group.add(m);
        return m;
    });
    return { group, lights };
}

export function initModels() {
    MAT.vcol = new THREE.MeshLambertMaterial({ vertexColors: true });
    MAT.cloud = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xb8c4d4 });
    MAT.road = new THREE.MeshLambertMaterial({ map: TEX.asphalt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MAT.kerb = new THREE.MeshLambertMaterial({ map: TEX.kerb, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    MAT.checker = new THREE.MeshLambertMaterial({ map: TEX.checker, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    MAT.turbo = new THREE.MeshLambertMaterial({ map: TEX.turbo, emissive: 0xff8a00, emissiveMap: TEX.turbo, emissiveIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    MAT.grass = new THREE.MeshLambertMaterial({ map: TEX.grass });
    MAT.water = new THREE.MeshLambertMaterial({ map: TEX.water, emissive: 0x0a3a80, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    MAT.stone = new THREE.MeshLambertMaterial({ map: TEX.stone, side: THREE.DoubleSide });
    MAT.banner = new THREE.MeshLambertMaterial({ map: TEX.banner, side: THREE.DoubleSide });
    MAT.tree = new THREE.MeshLambertMaterial({ flatShading: true });
    MAT.flower = new THREE.MeshLambertMaterial({ emissive: 0x222222 });
    MAT.wheel = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    MAT.emblem = new THREE.MeshLambertMaterial({ color: 0xe01c1c });
    MAT.glove = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
    MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 });
    MAT.valley = new THREE.MeshLambertMaterial({ color: 0x3c9a3c });
}

export const GEO = { S, BOX, CYL, CONE };
