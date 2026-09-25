// "Castle Raceway": a circuit inspired by Royal Raceway (Mario Kart 64) — a long start
// straight, a big right-hander, S-bends, a ramp jump over a lake, a hairpin by the castle
// and a sweeping back straight. The centreline is a closed Catmull-Rom spline; everything
// else (road, kerbs, ramps, pads, scenery) is generated from it.
import * as THREE from 'three';
import { MAT, Baker, addHill, addCloud, castleGeometry, grandstandGeometry } from './models.js';

export const HALF_WIDTH = 8;     // metres from the centre line to the road edge
export const KERB = 0.9;
const SCALE = 0.8;

const CONTROL = [
    [0, 0], [0, -100], [12, -160], [55, -198], [115, -200], [162, -175], [182, -130],
    [172, -85], [148, -50], [150, -8], [182, 22], [235, 38], [300, 40], [365, 40], [430, 40],
    [478, 62], [505, 110], [495, 165], [452, 195], [385, 200], [325, 178], [262, 162],
    [195, 168], [120, 178], [50, 165], [8, 120], [0, 60],
];

// The jump: a kicker ramp, a gap over the lake, then a landing ramp.
export const RAMP_LEN = 70, RAMP_H = 6, GAP = 24, LAND_LEN = 50, LAND_H = 3.5;

const sc = ([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE);

export class Track {
    constructor() {
        this.curve = new THREE.CatmullRomCurve3(CONTROL.map(sc), true, 'centripetal');
        this.L = this.curve.getLength();
        const N = this.N = Math.round(this.L);
        this.ds = this.L / N;
        this.px = new Float32Array(N);
        this.pz = new Float32Array(N);
        this.tx = new Float32Array(N);
        this.tz = new Float32Array(N);
        const p = new THREE.Vector3(), t = new THREE.Vector3();
        for (let i = 0; i < N; i++) {
            this.curve.getPointAt(i / N, p);
            this.curve.getTangentAt(i / N, t);
            const l = Math.hypot(t.x, t.z) || 1;
            this.px[i] = p.x; this.pz[i] = p.z;
            this.tx[i] = t.x / l; this.tz[i] = t.z / l;
        }
        this.lip = this.nearestS(sc([322, 40]));
        this.gapEnd = this.lip + GAP;
        const lc = this.sampleAt(this.lip + GAP / 2);
        this.lake = { x: lc.x, z: lc.z, r: 30 };
        this.respawnS = this.lip - RAMP_LEN - 25;
        this.pads = [
            { s: 45, lat: 0 },
            { s: this.lip - RAMP_LEN - 15, lat: 0 },
            { s: this.nearestS(sc([262, 162])), lat: -3 },
            { s: this.nearestS(sc([395, 200])), lat: 3 },
        ];
        this.group = new THREE.Group();
        this.buildRoad();
        this.buildScenery();
    }

    wrap(s) { return ((s % this.L) + this.L) % this.L; }

    // Signed distance from a to b along the track, in (-L/2, L/2].
    delta(a, b) {
        let d = this.wrap(b - a);
        if (d > this.L / 2) d -= this.L;
        return d;
    }

    inGap(s) {
        const d = this.wrap(s - this.lip);
        return d > 0 && d < GAP;
    }

    // Road height at distance s (the gap returns the lip height; check inGap first).
    heightAt(s) {
        const up = this.delta(this.lip, s);
        if (up > -RAMP_LEN && up <= 0) return RAMP_H * Math.pow((up + RAMP_LEN) / RAMP_LEN, 4);
        const down = this.delta(this.gapEnd, s);
        if (down >= 0 && down < LAND_LEN) return LAND_H * (1 - down / LAND_LEN) ** 2;
        return 0;
    }

    sampleAt(s, out = {}) {
        const f = this.wrap(s) / this.ds;
        const i = Math.floor(f) % this.N, j = (i + 1) % this.N, k = f - Math.floor(f);
        out.x = this.px[i] + (this.px[j] - this.px[i]) * k;
        out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * k;
        let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * k, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * k;
        const l = Math.hypot(tx, tz) || 1;
        out.tx = tx / l; out.tz = tz / l;
        out.rx = -out.tz; out.rz = out.tx;   // right-hand side of the road
        return out;
    }

    nearestS(v) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < this.N; i++) {
            const d = (this.px[i] - v.x) ** 2 + (this.pz[i] - v.z) ** 2;
            if (d < bd) { bd = d; best = i; }
        }
        return best * this.ds;
    }

    // Where is (x, z) relative to the track? hint = sample index from the last query.
    query(x, z, hint = -1, out = {}) {
        const N = this.N;
        let best = 0, bd = Infinity;
        const from = hint < 0 ? 0 : hint - 40, to = hint < 0 ? N - 1 : hint + 40;
        for (let k = from; k <= to; k++) {
            const i = ((k % N) + N) % N;
            const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
        }
        // Refine along the local segment.
        const i = best;
        const along = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i];
        const s = this.wrap(i * this.ds + along);
        const q = this.sampleAt(s, out);
        out.i = i;
        out.s = s;
        out.lat = (x - q.x) * q.rx + (z - q.z) * q.rz;
        out.gap = this.inGap(s);
        out.y = this.heightAt(s);
        return out;
    }

    inLake(x, z) {
        return (x - this.lake.x) ** 2 + (z - this.lake.z) ** 2 < this.lake.r ** 2;
    }

    padAt(s, lat) {
        for (const p of this.pads) if (Math.abs(this.delta(p.s, s)) < 3 && Math.abs(lat - p.lat) < 2.3) return p;
        return null;
    }

    // ------------------------------------------------------------ meshes

    buildRoad() {
        const N = this.N, ds = this.ds, HW = HALF_WIDTH;
        const q = {};
        const road = { pos: [], uv: [], idx: [] };
        const kerbs = { pos: [], uv: [], idx: [] };
        const walls = { pos: [], uv: [], idx: [] };
        const quad = (m, a, b, c, d, uvs) => {
            const n = m.pos.length / 3;
            m.pos.push(...a, ...b, ...c, ...d);
            m.uv.push(...uvs);
            m.idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        };
        const P = (s, lat, dy = 0) => {
            this.sampleAt(s, q);
            return [q.x + q.rx * lat, this.heightAt(s) + 0.04 + dy, q.z + q.rz * lat];
        };
        for (let i = 0; i < N; i++) {
            const s0 = i * ds, s1 = (i + 1) * ds;
            if (this.inGap(s0 + 0.01) || this.inGap(s1 - 0.01)) continue;
            const v0 = s0 / 12, v1 = s1 / 12;
            quad(road, P(s0, -HW), P(s0, HW), P(s1, -HW), P(s1, HW), [0, v0, 1, v0, 0, v1, 1, v1]);
            const high = this.heightAt(s0) > 0.25 || this.heightAt(s1) > 0.25;
            if (!high) {
                const k0 = s0 / 4, k1 = s1 / 4;
                quad(kerbs, P(s0, -HW - KERB), P(s0, -HW), P(s1, -HW - KERB), P(s1, -HW), [0, k0, 1, k0, 0, k1, 1, k1]);
                quad(kerbs, P(s0, HW), P(s0, HW + KERB), P(s1, HW), P(s1, HW + KERB), [0, k0, 1, k0, 0, k1, 1, k1]);
            } else {
                // Raised sections: stone sides down to the ground and a low parapet wall.
                for (const side of [-1, 1]) {
                    const lat = side * (HW + 0.2);
                    const top0 = P(s0, lat, 0.7), top1 = P(s1, lat, 0.7);
                    const bot0 = [top0[0], -1, top0[2]], bot1 = [top1[0], -1, top1[2]];
                    const h0 = top0[1] + 1, h1 = top1[1] + 1;
                    if (side > 0) quad(walls, bot0, bot1, top0, top1, [s0 / 2, 0, s1 / 2, 0, s0 / 2, h0 / 2, s1 / 2, h1 / 2]);
                    else quad(walls, bot1, bot0, top1, top0, [s1 / 2, 0, s0 / 2, 0, s1 / 2, h1 / 2, s0 / 2, h0 / 2]);
                    const in0 = P(s0, side * HW, 0), in1 = P(s1, side * HW, 0);
                    const it0 = P(s0, side * HW, 0.7), it1 = P(s1, side * HW, 0.7);
                    if (side > 0) quad(walls, in1, in0, it1, it0, [s1 / 2, 0, s0 / 2, 0, s1 / 2, 0.35, s0 / 2, 0.35]);
                    else quad(walls, in0, in1, it0, it1, [s0 / 2, 0, s1 / 2, 0, s0 / 2, 0.35, s1 / 2, 0.35]);
                    const o0 = P(s0, side * (HW + 0.4), 0.7), o1 = P(s1, side * (HW + 0.4), 0.7);
                    if (side > 0) quad(walls, it0, o0, it1, o1, [0, 0, 0.2, 0, 0, 0.5, 0.2, 0.5]);
                    else quad(walls, o0, it0, o1, it1, [0, 0, 0.2, 0, 0, 0.5, 0.2, 0.5]);
                }
            }
        }
        const mesh = (m, mat, receive = true) => {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
            g.setIndex(m.idx);
            g.computeVertexNormals();
            const o = new THREE.Mesh(g, mat);
            o.receiveShadow = receive;
            this.group.add(o);
            return o;
        };
        mesh(road, MAT.road);
        mesh(kerbs, MAT.kerb);
        mesh(walls, MAT.stone).castShadow = true;

        // Start line and dash panels (flat quads just above the road).
        const flat = (s0, s1, lat0, lat1, uvs, mat) => {
            const m = { pos: [], uv: [], idx: [] };
            quad(m, P(s0, lat0, 0.01), P(s0, lat1, 0.01), P(s1, lat0, 0.01), P(s1, lat1, 0.01), uvs);
            return mesh(m, mat);
        };
        flat(-1, 1, -HW, HW, [0, 0, 2, 0, 0, 1, 2, 1], MAT.checker);
        for (const pad of this.pads) flat(pad.s - 3, pad.s + 3, pad.lat - 2, pad.lat + 2, [0, 0, 1, 0, 0, 1.5, 1, 1.5], MAT.turbo);

        // Pillars under the ramps.
        const pillars = new Baker();
        for (const [a, b] of [[this.lip - RAMP_LEN * 0.55, this.lip], [this.gapEnd, this.gapEnd + LAND_LEN * 0.6]]) {
            for (let s = a; s <= b; s += 9) {
                const h = this.heightAt(s);
                for (const side of [-1, 1]) {
                    const [x, , z] = P(s, side * (HW - 2));
                    pillars.add(new THREE.CylinderGeometry(1, 1, 1, 10), 0x9a8f82, [x, (h - 1) / 2, z], [0.8, h + 1, 0.8]);
                }
            }
        }
        const pm = new THREE.Mesh(pillars.build(), MAT.vcol);
        pm.castShadow = true;
        this.group.add(pm);
    }

    buildScenery() {
        const G = this.group;
        const q = {};
        let seed = 21;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

        // Bounds of the circuit
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < this.N; i++) {
            minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
            minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
        }
        const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
        this.bounds = { minX, maxX, minZ, maxZ, cx, cz };

        const grass = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), MAT.grass);
        grass.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 50; });
        grass.position.set(cx, 0, cz);
        grass.receiveShadow = true;
        G.add(grass);

        const lake = new THREE.Mesh(new THREE.CircleGeometry(this.lake.r, 48).rotateX(-Math.PI / 2), MAT.water);
        lake.position.set(this.lake.x, 0.05, this.lake.z);
        lake.receiveShadow = true;
        G.add(lake);
        this.water = lake;

        // Castle beyond the hairpin, facing the jump straight.
        const castle = new THREE.Mesh(castleGeometry(), MAT.vcol);
        this.castlePos = sc([600, 115]);
        castle.position.copy(this.castlePos);
        castle.rotation.y = Math.PI / 2;
        castle.scale.setScalar(1.5);
        castle.castShadow = true;
        G.add(castle);
        const moat = new THREE.Mesh(new THREE.RingGeometry(45, 54, 48).rotateX(-Math.PI / 2), MAT.water);
        moat.position.set(this.castlePos.x, 0.06, this.castlePos.z);
        G.add(moat);

        // Grandstand along the start straight and the start gantry.
        const stand = new THREE.Mesh(grandstandGeometry(60), MAT.vcol);
        stand.position.set(-HALF_WIDTH - 9, 0, -20);
        stand.rotation.y = Math.PI;
        stand.castShadow = true;
        G.add(stand);
        const gantry = new Baker();
        for (const s of [-1, 1]) gantry.add(new THREE.BoxGeometry(1, 1, 1), 0xcfcfd6, [s * (HALF_WIDTH + 1.5), 3.8, 0], [0.8, 7.6, 0.8]);
        gantry.add(new THREE.BoxGeometry(1, 1, 1), 0xcfcfd6, [0, 7.8, 0], [HALF_WIDTH * 2 + 4, 0.6, 0.8]);
        const gm = new THREE.Mesh(gantry.build(), MAT.vcol);
        gm.castShadow = true;
        G.add(gm);
        const bannerFront = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, 3), MAT.banner);
        bannerFront.position.set(0, 6.4, 0.45);
        G.add(bannerFront);

        // Trees (instanced) away from the road, the lake and the castle.
        const trees = [];
        const clearOf = (x, z, road) => {
            const t = this.query(x, z, -1, q);
            if (Math.abs(t.lat) < road && Math.hypot(t.x - x, t.z - z) < road) return false;
            if (Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r + 6) return false;
            if (Math.hypot(x - this.castlePos.x, z - this.castlePos.z) < 80) return false;
            if (x > -45 && x < -12 && z > -60 && z < 25) return false;
            return true;
        };
        for (let n = 0; n < 900 && trees.length < 170; n++) {
            const x = minX - 70 + rnd() * (maxX - minX + 140);
            const z = minZ - 70 + rnd() * (maxZ - minZ + 140);
            if (clearOf(x, z, 17)) trees.push([x, z, 0.8 + rnd() * 0.7]);
        }
        const canopy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), MAT.tree, trees.length);
        const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 1, 6), MAT.tree, trees.length);
        const m = new THREE.Matrix4(), col = new THREE.Color();
        const greens = [0x2e8b3a, 0x3a9d40, 0x25782e, 0x48a848];
        trees.forEach(([x, z, k], i) => {
            m.makeScale(3 * k, 3.4 * k, 3 * k).setPosition(x, 3 * k + 3.2 * k, z);
            canopy.setMatrixAt(i, m);
            canopy.setColorAt(i, col.set(greens[i % greens.length]));
            m.makeScale(k, 3.4 * k, k).setPosition(x, 1.7 * k, z);
            trunk.setMatrixAt(i, m);
            trunk.setColorAt(i, col.set(0x7a4a24));
        });
        canopy.castShadow = trunk.castShadow = true;
        G.add(canopy, trunk);

        // Flower beds along the road sides.
        const flowers = [];
        for (let i = 0; i < 700; i++) {
            const s = rnd() * this.L;
            if (this.heightAt(s) > 0.05 || this.inGap(s)) continue;
            const side = rnd() < 0.5 ? -1 : 1;
            const lat = side * (HALF_WIDTH + KERB + 1.2 + rnd() * 5);
            this.sampleAt(s, q);
            const x = q.x + q.rx * lat, z = q.z + q.rz * lat;
            if (this.inLake(x, z) || !clearOf(x, z, HALF_WIDTH + KERB + 1)) continue;
            flowers.push([x, z]);
        }
        const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.28, 0), MAT.flower, flowers.length);
        const fcol = [0xffffff, 0xffe040, 0xff5a7a, 0xffa0d0, 0xff8a20];
        flowers.forEach(([x, z], i) => {
            m.makeTranslation(x, 0.25, z);
            fl.setMatrixAt(i, m);
            fl.setColorAt(i, col.set(fcol[i % fcol.length]));
        });
        G.add(fl);

        // Distant hills and clouds.
        const hills = new Baker();
        for (let a = 0; a < Math.PI * 2; a += 0.2 + rnd() * 0.25) {
            const r = 430 + rnd() * 120;
            addHill(hills, cx + Math.cos(a) * r, cz + Math.sin(a) * r, 60 + rnd() * 70, 40 + rnd() * 50, -10, rnd() < 0.5 ? 0x3aa647 : 0x2f9a3c);
        }
        G.add(new THREE.Mesh(hills.build(), MAT.vcol));
        const clouds = new Baker();
        for (let i = 0; i < 26; i++) {
            const a = rnd() * Math.PI * 2, r = 120 + rnd() * 380;
            addCloud(clouds, cx + Math.cos(a) * r, 55 + rnd() * 40, cz + Math.sin(a) * r, 1 + Math.floor(rnd() * 3));
        }
        G.add(new THREE.Mesh(clouds.build(), MAT.cloud));

        // Minimap outline (normalised to 0..1).
        const span = Math.max(maxX - minX, maxZ - minZ);
        this.map = { minX, minZ, span, pts: [] };
        for (let i = 0; i < this.N; i += 6) this.map.pts.push([(this.px[i] - minX) / span, (this.pz[i] - minZ) / span]);
    }

    animate(t) {
        MAT.turbo.map.offset.y = -t * 1.6;
        MAT.water.map.offset.set(t * 0.02, t * 0.035);
        MAT.turbo.emissiveIntensity = 0.45 + Math.sin(t * 10) * 0.25;
    }
}
