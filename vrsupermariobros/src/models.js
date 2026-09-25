// Low-poly models built from primitives. Each character is baked into one
// vertex-coloured geometry to keep draw calls low (important for phone VR).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

export const MAT = {};
export const GEO = {};

const S = new THREE.SphereGeometry(1, 14, 10);
const HEMI = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const CONE = new THREE.ConeGeometry(1, 1, 8);

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

// Box whose UVs repeat the texture once per world unit on every face.
export function tiledBox(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i));
        const ny = Math.abs(nrm.getY(i));
        let u = uv.getX(i);
        let v = uv.getY(i);
        if (nx > 0.5) { u *= d; v *= h; } else if (ny > 0.5) { u *= w; v *= d; } else { u *= w; v *= h; }
        uv.setXY(i, u, v);
    }
    return g;
}

// Merge a list of already-positioned geometries (all sharing one material).
export function mergeList(list) {
    const parts = list.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
        n.clearGroups();
        return n;
    });
    const g = mergeGeometries(parts, false);
    g.computeBoundingSphere();
    return g;
}

const v2 = pts => pts.map(([x, y]) => new THREE.Vector2(x, y));

function goombaGeos() {
    const b = new Baker();
    const head = new THREE.LatheGeometry(v2([[0.02, 0], [0.38, 0.02], [0.47, 0.1], [0.49, 0.2], [0.44, 0.34], [0.32, 0.46], [0.16, 0.53], [0, 0.55]]), 18);
    b.add(head, 0xa0501e, [0, 0.3, 0]);
    b.add(S, 0xf0c890, [0, 0.28, 0], [0.24, 0.2, 0.22]);
    for (const s of [-1, 1]) {
        b.add(S, 0xffffff, [s * 0.11, 0.56, 0.43], [0.085, 0.12, 0.06]);
        b.add(S, 0x111111, [s * 0.1, 0.54, 0.48], [0.045, 0.07, 0.03]);
        b.add(BOX, 0x1a0a00, [s * 0.13, 0.69, 0.38], [0.17, 0.045, 0.06], [0, 0, s * 0.45]);
        b.add(CONE, 0xffffff, [s * 0.08, 0.44, 0.46], [0.035, 0.07, 0.035]);
    }
    b.add(BOX, 0x2a0a00, [0, 0.41, 0.465], [0.26, 0.035, 0.03]);
    const body = b.build();
    const foot = new Baker().add(S, 0x3a2010, [0, 0.09, 0.03], [0.16, 0.09, 0.21]).build();
    return { body, foot };
}

function koopaGeos() {
    const YEL = 0xf8d048, GREEN = 0x28b028, LIGHT = 0x7ee07e, RIM = 0xfff8e0, BELLY = 0xfff0b0;
    const b = new Baker();
    for (const s of [-1, 1]) b.add(CYL, YEL, [s * 0.16, 0.22, 0], [0.08, 0.26, 0.08]);
    // Shell: a green ellipsoid on the back, with the cream belly plate in front of it.
    b.add(S, GREEN, [0, 0.64, -0.12], [0.43, 0.5, 0.36]);
    b.add(S, LIGHT, [0, 0.7, -0.46], [0.2, 0.24, 0.04]);
    b.add(S, BELLY, [0, 0.62, 0.1], [0.29, 0.39, 0.18]);
    b.add(new THREE.TorusGeometry(1, 0.08, 6, 24), RIM, [0, 0.62, 0.13], [0.31, 0.41, 0.31]);
    b.add(CYL, YEL, [0, 0.95, 0.06], [0.1, 0.25, 0.1]);
    b.add(S, YEL, [0, 1.12, 0.1], [0.22, 0.22, 0.22]);
    b.add(S, YEL, [0, 1.06, 0.28], [0.14, 0.11, 0.15]);
    for (const s of [-1, 1]) {
        b.add(S, 0xffffff, [s * 0.08, 1.2, 0.25], [0.065, 0.1, 0.05]);
        b.add(S, 0x111111, [s * 0.075, 1.19, 0.29], [0.03, 0.05, 0.02]);
        b.add(S, YEL, [s * 0.3, 0.74, 0.1], [0.07, 0.14, 0.07], [0, 0, s * 0.3]);
    }
    b.add(CONE, YEL, [0, 0.3, -0.34], [0.07, 0.18, 0.07], [-2.2, 0, 0]);
    const body = b.build();
    const foot = new Baker().add(S, 0xf0b030, [0, 0.07, 0.05], [0.1, 0.07, 0.16]).build();
    const sb = new Baker();
    sb.add(CYL, BELLY, [0, 0.08, 0], [0.4, 0.12, 0.44]);
    sb.add(HEMI, GREEN, [0, 0.12, 0], [0.42, 0.38, 0.46]);
    sb.add(new THREE.TorusGeometry(1, 0.12, 6, 24), RIM, [0, 0.12, 0], [0.43, 0.47, 0.43], [Math.PI / 2, 0, 0]);
    sb.add(S, LIGHT, [0, 0.49, 0], [0.2, 0.04, 0.22]);
    return { body, foot, shell: sb.build() };
}

function mushroomGeo(capColor) {
    const b = new Baker();
    const cap = new THREE.LatheGeometry(v2([[0.02, 0], [0.44, 0], [0.48, 0.08], [0.45, 0.2], [0.35, 0.32], [0.19, 0.41], [0, 0.43]]), 18);
    b.add(cap, capColor, [0, 0.3, 0]);
    b.add(S, 0xffffff, [0, 0.72, 0], [0.16, 0.03, 0.16]);
    for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        b.add(S, 0xffffff, [Math.sin(a) * 0.46, 0.49, Math.cos(a) * 0.46], [0.13, 0.12, 0.04], [0, a, 0]);
    }
    b.add(CYL, 0xfff0d0, [0, 0.17, 0], [0.27, 0.34, 0.27]);
    for (const s of [-1, 1]) b.add(S, 0x111111, [s * 0.08, 0.2, 0.26], [0.03, 0.07, 0.02]);
    return b.build();
}

function flowerGeo() {
    const b = new Baker();
    b.add(CYL, 0x20a020, [0, 0.2, 0], [0.04, 0.4, 0.04]);
    for (const s of [-1, 1]) b.add(S, 0x30c030, [s * 0.14, 0.14, 0], [0.16, 0.04, 0.08], [0, 0, s * 0.4]);
    const up = [Math.PI / 2, 0, 0];
    b.add(CYL, 0xf85800, [0, 0.58, 0], [0.3, 0.08, 0.3], up);
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        b.add(S, 0xf83800, [Math.cos(a) * 0.3, 0.58 + Math.sin(a) * 0.3, 0], [0.1, 0.1, 0.06]);
    }
    b.add(CYL, 0xffd020, [0, 0.58, 0.02], [0.21, 0.08, 0.21], up);
    b.add(CYL, 0xffffff, [0, 0.58, 0.04], [0.12, 0.08, 0.12], up);
    for (const s of [-1, 1]) b.add(S, 0x111111, [s * 0.045, 0.59, 0.09], [0.022, 0.05, 0.02]);
    return b.build();
}

function starGeo() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.2 : 0.46;
        const a = Math.PI / 2 + i * Math.PI / 5;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    const ex = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 1 });
    ex.translate(0, 0, -0.08);
    const b = new Baker();
    b.add(ex, 0xffd41a, [0, 0.45, 0]);
    for (const s of [-1, 1]) b.add(S, 0x111111, [s * 0.07, 0.5, 0.14], [0.025, 0.07, 0.02]);
    return b.build();
}

function coinGeo() {
    const b = new Baker();
    const up = [Math.PI / 2, 0, 0];
    b.add(CYL, 0xffc81e, [0, 0, 0], [0.33, 0.08, 0.33], up);
    b.add(CYL, 0xe0a010, [0, 0, 0], [0.22, 0.1, 0.22], up);
    b.add(BOX, 0xfff3a8, [0, 0, 0], [0.06, 0.3, 0.12]);
    return b.build();
}

export function pipeGeometry(h) {
    const body = new THREE.CylinderGeometry(0.88, 0.88, h - 0.5, 24, 1, true);
    body.translate(0, (h - 0.5) / 2, 0);
    const lip = new THREE.CylinderGeometry(1.0, 1.0, 0.5, 24, 1, false);
    lip.translate(0, h - 0.25, 0);
    return mergeList([body, lip]);
}

// Scenery helpers (write into a Baker so the whole backdrop is one draw call).
export function addHill(b, x, z, r, h, baseY) {
    b.add(S, 0x39b54a, [x, baseY, z], [r, h, r * 0.85]);
    const toLevel = z > 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) {
        const az = (i - 1.5) * 0.45;
        const el = 0.35 + (i % 2) * 0.25;
        const nx = Math.cos(el) * Math.sin(az);
        const ny = Math.sin(el);
        const nz = Math.cos(el) * Math.cos(az) * toLevel;
        const sr = r * 0.07;
        b.add(S, 0x1f7a2c, [x + nx * r * 0.99, baseY + ny * h * 0.99, z + nz * r * 0.85 * 0.99], [sr, sr * 1.3, sr]);
    }
}

export function addBush(b, x, y, z, n) {
    for (let i = 0; i < n; i++) {
        const mid = i === (n - 1) / 2 || (n % 2 === 0 && (i === n / 2 || i === n / 2 - 1));
        const r = mid ? 0.62 : 0.48;
        b.add(S, 0x5ad13a, [x + (i - (n - 1) / 2) * 0.72, y + (mid ? 0.1 : 0), z], [r, r * 0.85, r * 0.8]);
    }
}

export function addCloud(b, x, y, z, n) {
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        const r = 1.3 - Math.abs(t) * 0.9;
        b.add(S, 0xffffff, [x + t * n * 1.5, y + (1 - Math.abs(t) * 2) * 0.35, z], [r, r * 0.8, r * 0.9]);
    }
    b.add(S, 0xffffff, [x, y - 0.3, z], [n * 0.95, 0.55, 1.0]);
}

export function initModels() {
    MAT.vcol = new THREE.MeshLambertMaterial({ vertexColors: true });
    MAT.vglow = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x6a4800 });
    MAT.cloud = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xb8c4d4 });
    MAT.ground = new THREE.MeshLambertMaterial({ map: TEX.ground });
    MAT.brick = new THREE.MeshLambertMaterial({ map: TEX.brick });
    MAT.question = new THREE.MeshLambertMaterial({ map: TEX.question, emissive: 0xffaa00, emissiveMap: TEX.question, emissiveIntensity: 0.25 });
    MAT.used = new THREE.MeshLambertMaterial({ map: TEX.used });
    MAT.hard = new THREE.MeshLambertMaterial({ map: TEX.hard });
    MAT.ugGround = new THREE.MeshLambertMaterial({ map: TEX.ugGround });
    MAT.ugBrick = new THREE.MeshLambertMaterial({ map: TEX.ugBrick });
    MAT.pipe = new THREE.MeshLambertMaterial({ map: TEX.pipe, side: THREE.DoubleSide });
    MAT.black = new THREE.MeshBasicMaterial({ color: 0x050505 });
    MAT.flag = new THREE.MeshLambertMaterial({ map: TEX.flag, side: THREE.DoubleSide, alphaTest: 0.5 });
    MAT.starFlag = new THREE.MeshLambertMaterial({ map: TEX.starFlag, side: THREE.DoubleSide });
    MAT.fire = new THREE.MeshBasicMaterial({ color: 0xff7a10 });
    MAT.fireCore = new THREE.MeshBasicMaterial({ color: 0xfff080 });
    MAT.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    MAT.valley = new THREE.MeshLambertMaterial({ color: 0x3c9a3c });

    GEO.block = new THREE.BoxGeometry(1, 1, 1);
    GEO.debris = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    GEO.sphere = S;
    GEO.cyl = CYL;
    GEO.goomba = goombaGeos();
    GEO.koopa = koopaGeos();
    GEO.mushroom = mushroomGeo(0xe52521);
    GEO.oneup = mushroomGeo(0x22b030);
    GEO.flower = flowerGeo();
    GEO.star = starGeo();
    GEO.coin = coinGeo();
    GEO.blob = new THREE.CircleGeometry(0.4, 20).rotateX(-Math.PI / 2);
}
