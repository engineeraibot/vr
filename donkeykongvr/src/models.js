import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

export const MAT = {};
export const GEO = {};

const S = new THREE.SphereGeometry(1, 14, 10);
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

function donkeyKongGeo() {
    const b = new Baker();
    // Brown ape body
    b.add(S, 0x6a3005, [0, 0.7, 0], [0.65, 0.65, 0.55]); // chest
    b.add(S, 0x6a3005, [0, 1.25, 0], [0.45, 0.42, 0.4]); // head
    b.add(S, 0xf0b080, [0, 1.2, 0.25], [0.28, 0.22, 0.2]); // face/muzzle
    // Red tie with DK
    b.add(CONE, 0xe02010, [0, 0.7, 0.48], [0.12, 0.35, 0.05], [Math.PI, 0, 0]);
    // Eyes
    for (const s of [-1, 1]) {
        b.add(S, 0xffffff, [s * 0.12, 1.35, 0.32], [0.08, 0.1, 0.05]);
        b.add(S, 0x000000, [s * 0.12, 0.35, 0.36], [0.04, 0.05, 0.03]);
        // Arms
        b.add(CYL, 0x6a3005, [s * 0.65, 0.85, 0.1], [0.18, 0.5, 0.18], [0, 0, s * 0.5]);
    }
    return b.build();
}

function paulineGeo() {
    const b = new Baker();
    // Pink dress and brown hair
    b.add(CONE, 0xff4080, [0, 0.5, 0], [0.35, 0.8, 0.35]); // dress
    b.add(S, 0xffd0a0, [0, 0.95, 0], [0.2, 0.2, 0.18]); // head
    b.add(S, 0x5a2005, [0, 1.05, -0.05], [0.24, 0.24, 0.22]); // hair
    return b.build();
}

function barrelCannonGeo() {
    const b = new Baker();
    b.add(CYL, 0xd03010, [0, 0, 0], [0.6, 1.2, 0.6]); // red barrel body
    b.add(CYL, 0xffd700, [0, 0, 0], [0.63, 0.2, 0.63]); // gold rim
    // Yellow star on front
    b.add(S, 0xffd700, [0, 0, 0.62], [0.25, 0.25, 0.05]);
    return b.build();
}

function hammerGeo() {
    const b = new Baker();
    b.add(CYL, 0x8a5020, [0, 0.3, 0], [0.06, 0.6, 0.06]); // handle
    b.add(BOX, 0x303035, [0, 0.6, 0], [0.4, 0.25, 0.25]); // hammer head
    return b.build();
}

export function initModels() {
    MAT.vcol = new THREE.MeshLambertMaterial({ vertexColors: true });
    MAT.girder = new THREE.MeshLambertMaterial({ map: TEX.girder, color: 0xe62210 });
    MAT.ladder = new THREE.MeshLambertMaterial({ map: TEX.ladder, transparent: true, side: THREE.DoubleSide });
    MAT.barrel = new THREE.MeshLambertMaterial({ map: TEX.barrel });
    MAT.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });

    GEO.block = new THREE.BoxGeometry(1, 1, 1);
    GEO.sphere = S;
    GEO.cyl = CYL;
    GEO.dk = donkeyKongGeo();
    GEO.pauline = paulineGeo();
    GEO.cannon = barrelCannonGeo();
    GEO.hammer = hammerGeo();
    GEO.blob = new THREE.CircleGeometry(0.4, 20).rotateX(-Math.PI / 2);
}
