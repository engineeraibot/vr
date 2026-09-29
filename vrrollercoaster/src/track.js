// The coaster: a layout built like a turtle drawing (pitch / yaw / roll per metre along the
// rider's heartline), sampled every DS metres, plus the rails, ties, supports and tunnels.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const DS = 0.5;
const d2r = THREE.MathUtils.degToRad;
const smooth = u => u * u * (3 - 2 * u);
// arc: nearly constant curvature (ramps in over the first and last 20%), for big smooth curves.
const arc = (u, e = 0.2) => (u < e ? u * u / (2 * e) : u < 1 - e ? e / 2 + u - e : 1 - e - (1 - u) * (1 - u) / (2 * e)) / (1 - e);
const EASE = { smooth, lin: u => u, arc };
// 0 -> 1 -> 0 with a flat middle (banking into and out of a turn).
const bump = (u, e = 0.3) => (u < e ? smooth(u / e) : u > 1 - e ? smooth((1 - u) / e) : 1);

const S = (len, o = {}) => ({ len, ...o });
// Straights that set the heights of the big elements (tuned so the track ends up ~3 m above the ground).
const PH_DROP = 16, PH_UP = 21;
// A camelback hill: up, a long even crest (floaty airtime), down.
const hill = (a, up, top, o = {}) => [S(up, { pitch: a, ...o }), S(top, { pitch: -2 * a, ease: 'lin' }), S(up, { pitch: a })];

// kind: station (stopped / waiting), drive (tyres push to speed), chain (lift hill), launch
// (stop in the dark, countdown, then linear motors), boost, brake, stop (end station).
// Segment tags trigger effects in main.js when the train reaches them.
export const LAYOUT = [
    S(34, { kind: 'station', tag: 'station' }),
    S(30, { yaw: 90, bank: 14, kind: 'drive', speed: 7 }),
    S(16, { pitch: 44, kind: 'chain', speed: 7.5, tag: 'lift' }),
    S(104, { kind: 'chain', speed: 7.5 }),
    S(24, { pitch: -44, kind: 'chain', speed: 7.5, tag: 'crest' }),
    S(8, {}),
    S(32, { pitch: -97, tag: 'drop' }),
    S(PH_DROP, {}),
    S(80, { pitch: 97, ease: 'arc', tag: 'bottom' }),
    S(10, {}),
    ...hill(38, 45, 95, { tag: 'hill' }),
    S(10, {}),
    S(96, { yaw: -180, bank: -112, pitch: 0, tag: 'overbank' }),
    S(12, {}),
    S(76, { pitch: 360, shift: -7, tag: 'loop' }),
    S(14, {}),
    S(44, { roll: -360, yaw: -30, tag: 'corkscrew' }),
    S(8, {}),
    S(44, { roll: 360, yaw: 30 }),
    S(14, {}),
    S(48, { yaw: 100, bank: 55 }),
    S(10, {}),
    S(80, { tag: 'axes' }),
    S(10, { tag: 'monster' }),
    S(150, { kind: 'launch', speed: 49, tag: 'launch', tunnel: true }),
    S(12, {}),
    S(70, { pitch: 90, ease: 'arc', tag: 'tophat' }),
    S(PH_UP, {}),
    S(70, { pitch: -180, ease: 'lin', tag: 'space' }),
    S(14, { roll: 90, tag: 'twist' }),
    S(4, {}),
    S(75, { pitch: 90, ease: 'arc' }),
    S(20, {}),
    S(30, { pitch: 22, tag: 'ramp' }),
    S(12, {}),
    S(72, { pitch: -44, ease: 'lin', gap: true, tag: 'jump' }),
    S(10, { tag: 'land' }),
    S(30, { pitch: 22 }),
    S(16, {}),
    S(120, { yaw: -180, bank: -75, tag: 'turn' }),
    S(12, {}),
    S(40, { roll: -360, tag: 'roll' }),
    S(10, {}),
    S(40, { roll: 360 }),
    S(12, {}),
    S(24, { pitch: -10 }),
    S(24, { pitch: 20, ease: 'lin', tag: 'splash' }),
    S(24, { pitch: -10 }),
    S(40, { kind: 'boost', speed: 30, tag: 'boost' }),
    S(14, { pitch: 8.5 }),
    S(160, { yaw: -360, bank: -62, tag: 'helix' }),
    S(14, { pitch: -8.5 }),
    S(10, {}),
    S(24, { pitch: -45, tag: 'finaldrop' }),
    S(12, {}),
    S(24, { pitch: 45 }),
    S(20, {}),
    S(40, { yaw: 60, bank: 25 }),
    S(50, { kind: 'brake', speed: 5, tag: 'brakes' }),
    S(34, { kind: 'stop', tag: 'end' }),
];
const START_HEIGHT = 3.2;

const _x = new THREE.Vector3(1, 0, 0), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();

export class Track {
    constructor() {
        this.build();
        this.group = new THREE.Group();
        this.buildMeshes();
    }

    build() {
        const pos = new THREE.Vector3(0, START_HEIGHT, 0);
        const q = new THREE.Quaternion();
        const P = [pos.x, pos.y, pos.z], Q = [0, 0, 0, 1], seg = [0];
        this.segments = [];
        let s = 0;
        LAYOUT.forEach((L, si) => {
            const n = Math.max(1, Math.round(L.len / DS));
            const E = EASE[L.ease || 'smooth'];
            const sg = { ...L, i: si, s0: s, s1: s + n * DS };
            this.segments.push(sg);
            for (let i = 1; i <= n; i++) {
                const u0 = (i - 1) / n, u1 = i / n, de = E(u1) - E(u0);
                if (L.yaw) q.premultiply(_q.setFromAxisAngle(_y, d2r(L.yaw * de)));
                if (L.pitch) q.multiply(_q.setFromAxisAngle(_x, d2r(L.pitch * de)));
                const roll = (L.roll || 0) * de + (L.bank || 0) * (bump(u1) - bump(u0));
                if (roll) q.multiply(_q.setFromAxisAngle(_z, d2r(roll)));
                q.normalize();
                pos.addScaledVector(_v.set(0, 0, -1).applyQuaternion(q), DS);
                if (L.shift) pos.addScaledVector(_v.set(1, 0, 0).applyQuaternion(q), L.shift * (smooth(u1) - smooth(u0)));
                P.push(pos.x, pos.y, pos.z);
                Q.push(q.x, q.y, q.z, q.w);
                seg.push(si);
                s += DS;
            }
        });
        this.n = P.length / 3;
        this.length = (this.n - 1) * DS;
        this.P = new Float32Array(P);
        this.Q = new Float32Array(Q);
        this.seg = new Uint8Array(seg);
        // Curvature vector dT/ds at each sample (for g-forces).
        this.K = new Float32Array(this.n * 3);
        const T = i => _v3.set(0, 0, -1).applyQuaternion(this.quatAt(i, _q2));
        for (let i = 1; i < this.n - 1; i++) {
            const a = T(i + 1).clone(), b = T(i - 1);
            a.sub(b).divideScalar(2 * DS);
            this.K[i * 3] = a.x; this.K[i * 3 + 1] = a.y; this.K[i * 3 + 2] = a.z;
        }
        const tagged = {};
        for (const sg of this.segments) if (sg.tag) tagged[sg.tag] = sg;
        this.tags = tagged;
    }

    posAt(i, out) { return out.set(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]); }
    quatAt(i, out) { return out.set(this.Q[i * 4], this.Q[i * 4 + 1], this.Q[i * 4 + 2], this.Q[i * 4 + 3]); }

    // Interpolated frame at distance s along the heartline.
    frameAt(s, pos, quat) {
        const f = THREE.MathUtils.clamp(s / DS, 0, this.n - 1.001);
        const i = Math.floor(f), t = f - i;
        pos.set(
            this.P[i * 3] + (this.P[i * 3 + 3] - this.P[i * 3]) * t,
            this.P[i * 3 + 1] + (this.P[i * 3 + 4] - this.P[i * 3 + 1]) * t,
            this.P[i * 3 + 2] + (this.P[i * 3 + 5] - this.P[i * 3 + 2]) * t);
        if (quat) quat.slerpQuaternions(this.quatAt(i, _q), this.quatAt(i + 1, _q2), t);
        return pos;
    }

    index(s) { return THREE.MathUtils.clamp(Math.round(s / DS), 0, this.n - 1); }
    segmentAt(s) { return this.segments[this.seg[this.index(s)]]; }

    // A point in the track frame at s: x right, y up, z backwards (like three.js cameras).
    pointAt(s, x, y, z, out, quatOut) {
        const q = quatOut || _q2;
        this.frameAt(s, out, q);
        return out.add(_v.set(x, y, z).applyQuaternion(q));
    }

    // ------------------------------------------------------------------ meshes

    buildMeshes() {
        const col = new THREE.Color();
        const hueAt = s => (s / 520) % 1;
        const rails = [], ties = [], supports = [];
        // Continuous rail runs, broken where the track has a gap (the jump).
        let run = [];
        const flush = () => { if (run.length > 1) rails.push(run); run = []; };
        for (let i = 0; i < this.n; i += 2) {
            const sg = this.segments[this.seg[i]];
            if (sg.gap) { flush(); continue; }
            run.push(i);
        }
        flush();

        const tubeGeo = (idx, ox, oy, r, radial, dark) => {
            const pos = [], nor = [], colr = [], ind = [];
            const q = new THREE.Quaternion(), c = new THREE.Vector3(), rgt = new THREE.Vector3(), up = new THREE.Vector3();
            idx.forEach((i, j) => {
                this.posAt(i, c);
                this.quatAt(i, q);
                rgt.set(1, 0, 0).applyQuaternion(q);
                up.set(0, 1, 0).applyQuaternion(q);
                c.addScaledVector(rgt, ox).addScaledVector(up, oy);
                col.setHSL(hueAt(i * DS), 0.85, dark ? 0.32 : 0.55);
                for (let k = 0; k < radial; k++) {
                    const a = (k / radial) * Math.PI * 2 + Math.PI / radial;
                    _v.copy(rgt).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
                    pos.push(c.x + _v.x * r, c.y + _v.y * r, c.z + _v.z * r);
                    nor.push(_v.x, _v.y, _v.z);
                    colr.push(col.r, col.g, col.b);
                }
                if (j > 0) {
                    const a0 = (j - 1) * radial, b0 = j * radial;
                    for (let k = 0; k < radial; k++) {
                        const k1 = (k + 1) % radial;
                        ind.push(a0 + k, b0 + k, a0 + k1, a0 + k1, b0 + k, b0 + k1);
                    }
                }
            });
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
            g.setIndex(ind);
            return g;
        };
        const railGeos = [];
        for (const idx of rails) {
            railGeos.push(tubeGeo(idx, -0.55, -1.12, 0.1, 6, false), tubeGeo(idx, 0.55, -1.12, 0.1, 6, false),
                tubeGeo(idx, 0, -1.6, 0.26, 5, true));
        }
        const railMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 });
        const railMesh = new THREE.Mesh(mergeGeometries(railGeos), railMat);
        railMesh.castShadow = true;
        this.group.add(railMesh);

        // Ties (crossbar + post down to the spine), every 1.5 m.
        const tieGeo = mergeGeometries([
            new THREE.BoxGeometry(1.3, 0.1, 0.14).translate(0, -1.2, 0),
            new THREE.BoxGeometry(0.12, 0.42, 0.12).translate(0, -1.4, 0),
        ]);
        const q = new THREE.Quaternion(), p = new THREE.Vector3(), up = new THREE.Vector3();
        let lastSupport = -99;
        for (let i = 0; i < this.n; i += 3) {
            const sg = this.segments[this.seg[i]];
            if (sg.gap) continue;
            this.posAt(i, p);
            this.quatAt(i, q);
            ties.push(_m.compose(p, q, _v2.set(1, 1, 1)).clone());
            // Supports: straight down from the spine where the track is roughly upright.
            up.set(0, 1, 0).applyQuaternion(q);
            const spine = p.clone().addScaledVector(up, -1.7);
            if (i * DS - lastSupport > 8 && up.y > 0.55 && spine.y > 1.2 && !sg.tunnel && sg.kind !== 'station' && sg.kind !== 'stop') {
                lastSupport = i * DS;
                supports.push({ x: spine.x, z: spine.z, h: spine.y });
            }
        }
        const tieMesh = new THREE.InstancedMesh(tieGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6 }), ties.length);
        ties.forEach((m, i) => tieMesh.setMatrixAt(i, m));
        this.group.add(tieMesh);

        const supGeo = new THREE.CylinderGeometry(0.22, 0.3, 1, 6).translate(0, 0.5, 0);
        const supMesh = new THREE.InstancedMesh(supGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), supports.length);
        supports.forEach((sp, i) => supMesh.setMatrixAt(i, _m.makeScale(1, sp.h, 1).setPosition(sp.x, 0, sp.z)));
        supMesh.castShadow = true;
        this.group.add(supMesh);
        this.supports = supports;

        // Tunnels: a dark tube with rings of lights that chase during the launch.
        this.tunnels = [];
        for (const sg of this.segments) {
            if (!sg.tunnel) continue;
            const idx = [];
            for (let i = this.index(sg.s0); i <= this.index(sg.s1); i += 2) idx.push(i);
            const tube = tubeGeo(idx, 0, -0.4, 3.6, 14, true);
            const mat = new THREE.MeshStandardMaterial({ color: 0x2a1640, roughness: 0.9, side: THREE.BackSide, vertexColors: false });
            const mesh = new THREE.Mesh(tube, mat);
            this.group.add(mesh);
            const count = Math.floor((sg.s1 - sg.s0) / 5);
            const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(3.3, 0.12, 6, 28),
                new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
            for (let k = 0; k < count; k++) {
                const s = sg.s0 + 2.5 + k * 5;
                this.pointAt(s, 0, -0.4, 0, p, q);
                rings.setMatrixAt(k, _m.compose(p, q, _v2.set(1, 1, 1)));
                rings.setColorAt(k, col.set(0x6020a0));
            }
            this.group.add(rings);
            this.tunnels.push({ seg: sg, rings, count });
        }
    }

    // Tunnel lights: mode 'idle' (slow purple glow), 'count' (red flashing), 'launch' (rainbow chase).
    animateTunnels(t, mode) {
        const col = _col;
        for (const tn of this.tunnels) {
            for (let k = 0; k < tn.count; k++) {
                if (mode === 'launch') col.setHSL((k * 0.04 - t * 0.9) % 1 + 1, 1, (Math.sin(k * 0.9 - t * 30) > 0.2) ? 0.6 : 0.12);
                else if (mode === 'count') col.setHSL(0.0, 1, (Math.sin(t * 12) > 0) ? 0.5 : 0.15);
                else col.setHSL(0.78, 0.8, 0.18 + 0.1 * Math.sin(k - t * 3));
                tn.rings.setColorAt(k, col);
            }
            tn.rings.instanceColor.needsUpdate = true;
        }
    }
}
