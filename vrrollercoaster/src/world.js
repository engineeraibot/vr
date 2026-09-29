// Everything around the track: park, sky (that turns into space up high), the monster whose
// belly is the launch tunnel, swinging axes, a lava canyon with rings of fire, a UFO,
// balloons to pop by looking at them, particles and fireworks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SKY_DAY = new THREE.Color(0x79c4ff), SKY_SPACE = new THREE.Color(0x03030f);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _c = new THREE.Color();
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function canvasTex(w, h, draw, repeat = 1) {
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat !== 1) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
    }
    t.anisotropy = 4;
    return t;
}

function speckle(ctx, w, h, base, cols, n, size) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(Math.random() * w, Math.random() * h, size * rand(0.5, 1.5), size * rand(0.5, 1.5));
    }
}

export function signTexture(lines, bg = '#ff2d8a', fg = '#fff') {
    return canvasTex(512, 128, (c, w, h) => {
        c.fillStyle = bg;
        c.fillRect(0, 0, w, h);
        c.strokeStyle = '#ffe14d';
        c.lineWidth = 10;
        c.strokeRect(5, 5, w - 10, h - 10);
        c.fillStyle = fg;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = '34px "Press Start 2P", monospace';
        lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 44));
    });
}

// ------------------------------------------------------------------ particles

export class Particles {
    constructor(count, size, additive = false) {
        this.count = count;
        this.pos = new Float32Array(count * 3).fill(-9999);
        this.col = new Float32Array(count * 3);
        this.vel = new Float32Array(count * 3);
        this.life = new Float32Array(count);
        this.drag = new Float32Array(count);
        this.grav = new Float32Array(count);
        this.next = 0;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
        this.points = new THREE.Points(g, new THREE.PointsMaterial({
            size, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: !additive,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive,
        }));
        this.points.frustumCulled = false;
    }

    burst(p, n, { speed = 6, colors = [0xffffff], life = 1.5, gravity = 9.8, drag = 1, up = 0, dir = null, spread = 1 } = {}) {
        for (let k = 0; k < n; k++) {
            const i = this.next;
            this.next = (this.next + 1) % this.count;
            this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
            _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
            while (_v.lengthSq() > 1 || _v.lengthSq() < 0.01) _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
            _v.multiplyScalar(speed * spread);
            if (dir) _v.addScaledVector(dir, speed);
            this.vel[i * 3] = _v.x; this.vel[i * 3 + 1] = _v.y + up; this.vel[i * 3 + 2] = _v.z;
            _c.set(colors[(Math.random() * colors.length) | 0]);
            this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
            this.life[i] = life * rand(0.6, 1.2);
            this.grav[i] = gravity;
            this.drag[i] = drag;
        }
    }

    update(dt) {
        const P = this.pos, V = this.vel;
        for (let i = 0; i < this.count; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;
            if (this.life[i] <= 0) { P[i * 3 + 1] = -9999; continue; }
            const d = Math.exp(-this.drag[i] * dt);
            V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d - this.grav[i] * dt; V[i * 3 + 2] *= d;
            P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;
    }
}

// ------------------------------------------------------------------ the world

export class World {
    constructor(scene, track) {
        this.scene = scene;
        this.track = track;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.confetti = new Particles(1400, 0.28);
        this.sparks = new Particles(1600, 1.1, true);
        this.group.add(this.confetti.points, this.sparks.points);
        this.fireworks = [];
        this.fwT = 0;

        this.occupied = new Set();
        const cell = (x, z) => `${Math.floor(x / 6)},${Math.floor(z / 6)}`;
        for (let i = 0; i < track.n; i += 4) {
            track.posAt(i, _v);
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.occupied.add(cell(_v.x + dx * 6, _v.z + dz * 6));
        }
        this.isFree = (x, z) => !this.occupied.has(cell(x, z));

        this.buildGround();
        this.buildSky();
        this.buildStations();
        this.buildLake();
        this.buildCanyon();
        this.buildMonster();
        this.buildAxes();
        this.buildUfo();
        this.buildTrees();
        this.buildFerrisWheel();
        this.buildBalloons();
    }

    at(tag) { return this.track.tags[tag]; }

    buildGround() {
        const grass = canvasTex(256, 256, (c, w, h) => speckle(c, w, h, '#5fb548', ['#56a841', '#6cc454', '#4f9c3c', '#7bd060'], 1800, 3), 240);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshLambertMaterial({ map: grass }));
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.group.add(ground);
        // Paths around the stations.
        const path = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshLambertMaterial({ color: 0xd9c7a0 }));
        path.rotation.x = -Math.PI / 2;
        path.position.set(-10, 0.02, -18);
        path.receiveShadow = true;
        this.group.add(path);
        // Mountains all around.
        const geos = [];
        for (let i = 0; i < 34; i++) {
            const a = (i / 34) * Math.PI * 2 + rand(-0.05, 0.05), r = rand(1100, 1500), h = rand(160, 380);
            const cone = new THREE.ConeGeometry(rand(160, 260), h, 7).translate(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r);
            geos.push(cone.toNonIndexed());
        }
        const mountains = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: 0x6f7fa0, flatShading: true }));
        this.group.add(mountains);
    }

    buildSky() {
        const n = 1800, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            _v.set(rand(-1, 1), rand(-0.1, 1), rand(-1, 1)).normalize().multiplyScalar(2200);
            pos.set([_v.x, _v.y, _v.z], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
        this.group.add(this.stars);
        // A ringed planet that shows up when you reach space.
        const ptex = canvasTex(256, 128, (c, w, h) => {
            const cols = ['#ff9a5c', '#ffcf7a', '#e8743b', '#ffd9a0', '#c95a2c', '#ffb36b'];
            for (let y = 0; y < h; y += 8) { c.fillStyle = cols[(y / 8 + (y > 60 ? 2 : 0)) % cols.length]; c.fillRect(0, y, w, 8 + Math.sin(y) * 3); }
        });
        const planet = this.planet = new THREE.Group();
        const pm = new THREE.MeshBasicMaterial({ map: ptex, transparent: true, opacity: 0, fog: false, depthWrite: false });
        planet.add(new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), pm));
        const ring = new THREE.Mesh(new THREE.RingGeometry(290, 420, 48), new THREE.MeshBasicMaterial({
            color: 0xffe0b0, side: THREE.DoubleSide, transparent: true, opacity: 0, fog: false, depthWrite: false }));
        ring.rotation.x = -1.2;
        planet.add(ring);
        planet.position.set(-420, 820, -1750); // ahead of you over the top of the top hat
        planet.rotation.z = 0.3;
        this.planetMats = [pm, ring.material];
        this.group.add(planet);

        const puff = new THREE.IcosahedronGeometry(1, 1);
        const clouds = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 240);
        let k = 0;
        for (let c = 0; c < 40; c++) {
            const cx = rand(-600, 600), cz = rand(-600, 600), cy = rand(58, 80);
            for (let j = 0; j < 6; j++) {
                const s = rand(8, 16);
                clouds.setMatrixAt(k++, _m.compose(_v.set(cx + rand(-18, 18), cy + rand(-3, 4), cz + rand(-14, 14)), _q.identity(), _v2.set(s * 1.4, s * 0.7, s)));
            }
        }
        this.group.add(clouds);
    }

    buildStations() {
        const T = this.track;
        const make = (sg, lines, color) => {
            const g = new THREE.Group();
            const len = sg.s1 - sg.s0;
            T.frameAt((sg.s0 + sg.s1) / 2, _v, _q);
            g.position.copy(_v);
            g.quaternion.copy(_q);
            const mat = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
            // Two platforms with a slot for the train between them.
            for (const side of [-1, 1]) {
                const p = new THREE.Mesh(new THREE.BoxGeometry(4.2, _v.y - 1.2, len), mat);
                p.position.set(side * 3.3, -(_v.y - 1.2) / 2 - 1.2 + 0.05, 0);
                p.receiveShadow = p.castShadow = true;
                g.add(p);
                for (let z = -len / 2 + 3; z <= len / 2 - 3; z += 7) {
                    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 5, 8), new THREE.MeshLambertMaterial({ color }));
                    post.position.set(side * 4.8, 1.3, z);
                    g.add(post);
                }
            }
            const roof = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.4, len), new THREE.MeshLambertMaterial({ color }));
            roof.position.set(0, 3.9, 0);
            roof.castShadow = true;
            g.add(roof);
            const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: signTexture(lines) }));
            sign.position.set(0, 5.3, -len / 2 + 1);
            g.add(sign);
            const back = sign.clone();
            back.position.z = len / 2 - 1;
            back.rotation.y = Math.PI;
            g.add(back);
            this.group.add(g);
            return g;
        };
        make(this.at('station'), ['CRAZY', 'COASTER'], 0xff2d8a);
        make(this.at('end'), ['YOU', 'SURVIVED!'], 0x22b8ff);
    }

    buildLake() {
        const sg = this.at('splash');
        this.track.frameAt((sg.s0 + sg.s1) / 2, _v);
        this.splashPos = _v.clone();
        const sand = new THREE.Mesh(new THREE.CircleGeometry(56, 40), new THREE.MeshLambertMaterial({ color: 0xe8d8a0 }));
        sand.rotation.x = -Math.PI / 2;
        sand.position.set(_v.x, 0.03, _v.z);
        const water = this.water = new THREE.Mesh(new THREE.CircleGeometry(50, 40), new THREE.MeshStandardMaterial({ color: 0x2a86e0, roughness: 0.08, metalness: 0.2 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(_v.x, 0.06, _v.z);
        water.receiveShadow = true;
        this.group.add(sand, water);
        for (let a = 0; a < Math.PI * 2; a += 0.35) this.occupied.add(`${Math.floor((_v.x + Math.cos(a) * 52) / 6)},${Math.floor((_v.z + Math.sin(a) * 52) / 6)}`);
        this.lakeCenter = new THREE.Vector2(_v.x, _v.z);
    }

    buildCanyon() {
        const T = this.track, sg = this.at('jump');
        const a = T.frameAt(sg.s0, new THREE.Vector3()), b = T.frameAt(sg.s1, new THREE.Vector3());
        const rock = new THREE.MeshLambertMaterial({ color: 0x9a5a3a, flatShading: true });
        for (const [p, s] of [[a, sg.s0 - 14], [b, sg.s1 + 14]]) {
            T.frameAt(s, _v);
            const h = _v.y - 1.9;
            const mesa = new THREE.Mesh(new THREE.CylinderGeometry(10, 16, h, 9, 2), rock);
            mesa.position.set(_v.x, h / 2, _v.z);
            mesa.castShadow = mesa.receiveShadow = true;
            this.group.add(mesa);
        }
        // Lava river under the jump.
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a).setY(0);
        const lavaTex = canvasTex(128, 128, (c, w, h) => speckle(c, w, h, '#ff5a00', ['#ffb000', '#ff2a00', '#ffe060', '#c01800'], 500, 6), 1);
        lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
        lavaTex.repeat.set(2, 6);
        this.lavaTex = lavaTex;
        const lava = new THREE.Mesh(new THREE.PlaneGeometry(34, dir.length() + 50), new THREE.MeshBasicMaterial({ map: lavaTex }));
        lava.rotation.x = -Math.PI / 2;
        lava.rotation.z = Math.atan2(dir.x, dir.z) + Math.PI / 2;
        lava.position.set(mid.x, 0.05, mid.z);
        this.group.add(lava);
        const rim = new THREE.Mesh(new THREE.PlaneGeometry(50, dir.length() + 70), new THREE.MeshLambertMaterial({ color: 0x3a2a26 }));
        rim.rotation.copy(lava.rotation);
        rim.position.set(mid.x, 0.04, mid.z);
        this.group.add(rim);
        this.lavaMid = mid;
        this.lavaDir = dir.normalize();
        this.lavaLen = a.distanceTo(b);
        // Rings of fire along the jump.
        this.fireRings = [];
        for (const f of [0.25, 0.5, 0.75]) {
            const s = sg.s0 + (sg.s1 - sg.s0) * f;
            const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.45, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
            T.pointAt(s, 0, -0.3, 0, ring.position, ring.quaternion);
            this.group.add(ring);
            this.fireRings.push({ ring, s });
        }
        for (let i = 0; i < 60; i++) {
            const x = mid.x + this.lavaDir.x * rand(-0.5, 0.5) * (this.lavaLen + 40), z = mid.z + this.lavaDir.z * rand(-0.5, 0.5) * (this.lavaLen + 40);
            this.occupied.add(`${Math.floor(x / 6)},${Math.floor(z / 6)}`);
            for (const o of [-18, 18]) this.occupied.add(`${Math.floor((x - this.lavaDir.z * o) / 6)},${Math.floor((z + this.lavaDir.x * o) / 6)}`);
        }
    }

    buildMonster() {
        const T = this.track, sg = this.at('launch');
        const g = this.monster = new THREE.Group();
        T.pointAt(sg.s0, 0, 0, 0, g.position, g.quaternion);
        const skin = new THREE.MeshStandardMaterial({ color: 0x3fae3a, roughness: 0.6, flatShading: true });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2a7a28, roughness: 0.7, flatShading: true });
        const tooth = new THREE.MeshStandardMaterial({ color: 0xfffbe8, roughness: 0.4 });
        const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 2), skin);
        skull.scale.set(1.15, 0.85, 1.3);
        skull.position.set(0, 7, -9);
        skull.castShadow = true;
        g.add(skull);
        const snout = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), skin);
        snout.scale.set(1.25, 0.5, 1);
        snout.position.set(0, 5.2, -1);
        g.add(snout);
        for (const sx of [-1, 1]) {
            const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0x102010 }));
            nostril.position.set(sx * 2, 6.6, 4.2);
            g.add(nostril);
            const horn = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 7), tooth);
            horn.position.set(sx * 6, 15, -12);
            horn.rotation.set(-0.6, 0, sx * -0.5);
            g.add(horn);
        }
        // Eyes that follow you.
        this.eyes = [];
        for (const sx of [-1, 1]) {
            const eye = new THREE.Group();
            eye.position.set(sx * 4.6, 11.5, 1.2);
            eye.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })));
            const iris = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
            iris.position.z = 1.55;
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
            pupil.position.z = 2.25;
            eye.add(iris, pupil);
            const lid = new THREE.Mesh(new THREE.SphereGeometry(2.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
            lid.rotation.x = -1.2;
            eye.add(lid);
            eye.userData.lid = lid;
            g.add(eye);
            this.eyes.push(eye);
        }
        // Lips around the mouth (the tunnel entrance) and teeth.
        const lips = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.9, 8, 24), new THREE.MeshStandardMaterial({ color: 0xc02040, roughness: 0.5 }));
        lips.position.set(0, -0.4, 0.5);
        lips.scale.set(1.25, 1, 1);
        g.add(lips);
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const t = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 6), tooth);
            t.position.set(Math.cos(a) * 4.2 * 1.2, -0.4 + Math.sin(a) * 4.2, 0.6);
            t.rotation.z = a + Math.PI / 2;
            g.add(t);
        }
        // The body is the launch tunnel: scales outside, spikes along the back.
        const idx = [];
        for (let i = T.index(sg.s0); i <= T.index(sg.s1); i += 2) idx.push(i);
        const outer = [];
        const q = new THREE.Quaternion(), c = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3();
        const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3.5, 5), tooth, Math.floor(idx.length / 4) + 1);
        let sp = 0;
        const pos = [], ind = [], radial = 16;
        idx.forEach((i, j) => {
            T.posAt(i, c);
            T.quatAt(i, q);
            r.set(1, 0, 0).applyQuaternion(q);
            u.set(0, 1, 0).applyQuaternion(q);
            const along = j / (idx.length - 1);
            const rad = 4.4 + Math.sin(along * Math.PI) * 1.2 - along * along * 0.8;
            c.addScaledVector(u, -0.4);
            for (let k = 0; k < radial; k++) {
                const a = (k / radial) * Math.PI * 2;
                _v.copy(r).multiplyScalar(Math.cos(a) * rad).addScaledVector(u, Math.sin(a) * rad);
                pos.push(c.x + _v.x, c.y + _v.y, c.z + _v.z);
            }
            if (j > 0) for (let k = 0; k < radial; k++) {
                const a0 = (j - 1) * radial, b0 = j * radial, k1 = (k + 1) % radial;
                ind.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
            }
            if (j % 4 === 0 && sp < spikes.count) {
                _v.copy(c).addScaledVector(u, rad + 1.2);
                spikes.setMatrixAt(sp++, _m.compose(_v, q, _v2.set(1, 1, 1)));
            }
        });
        const bodyGeo = new THREE.BufferGeometry();
        bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        bodyGeo.setIndex(ind);
        bodyGeo.computeVertexNormals();
        const body = new THREE.Mesh(bodyGeo, skin);
        body.castShadow = true;
        spikes.count = sp;
        this.group.add(body, spikes);
        // The tail curls out of the ground next to the exit.
        T.frameAt(sg.s1, c, q);
        for (let i = 0; i < 9; i++) {
            const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2 - i * 0.3, 1), skin);
            seg.position.copy(c).add(_v.set(9 + Math.sin(i * 0.5) * 5, -1 + i * 2.2, 6 - i * 1.5).applyQuaternion(q));
            this.group.add(seg);
        }
        this.group.add(g);
    }

    buildAxes() {
        const T = this.track, sg = this.at('axes');
        this.axes = [];
        const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.8, roughness: 0.25 });
        const wood = new THREE.MeshLambertMaterial({ color: 0x6a4028 });
        const blood = new THREE.MeshStandardMaterial({ color: 0xa01010, metalness: 0.5, roughness: 0.3 });
        for (const f of [0.18, 0.5, 0.82]) {
            const s = sg.s0 + (sg.s1 - sg.s0) * f;
            const pivot = new THREE.Group();
            T.pointAt(s, 0, 8, 0, pivot.position, pivot.quaternion);
            const arm = new THREE.Group();
            pivot.add(arm);
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7.2, 6), wood);
            rod.position.y = -3.6;
            arm.add(rod);
            const blade = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.12, 20, 1, false, Math.PI / 2, Math.PI), steel);
            blade.rotation.x = Math.PI / 2;
            blade.position.y = -7.2;
            blade.castShadow = true;
            arm.add(blade);
            const edge = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 4, 20, Math.PI), blood);
            edge.rotation.z = Math.PI;
            edge.position.y = -7.2;
            arm.add(edge);
            this.group.add(pivot);
            // Frame: two posts from the ground and a beam.
            for (const sx of [-5, 5]) {
                T.pointAt(s, sx, 8, 0, _v);
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, _v.y, 6), wood);
                post.position.set(_v.x, _v.y / 2, _v.z);
                post.castShadow = true;
                this.group.add(post);
            }
            const beam = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.6, 0.6), wood);
            beam.position.copy(pivot.position);
            beam.quaternion.copy(pivot.quaternion);
            this.group.add(beam);
            this.axes.push({ arm, s, whooshed: false });
        }
    }

    buildUfo() {
        const g = this.ufo = new THREE.Group();
        const hull = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 8), new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.9, roughness: 0.25 }));
        hull.scale.y = 0.28;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x80e0ff, transparent: true, opacity: 0.55, roughness: 0.05 }));
        dome.position.y = 0.9;
        const alien = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshLambertMaterial({ color: 0x70ff50 }));
        alien.scale.set(1, 1.3, 1);
        alien.position.y = 1.6;
        for (const sx of [-0.4, 0.4]) {
            const e = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
            e.position.set(sx, 0.25, 0.85);
            e.scale.set(1, 1.5, 0.6);
            alien.add(e);
        }
        this.lights = [];
        for (let i = 0; i < 10; i++) {
            const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
            const a = (i / 10) * Math.PI * 2;
            l.position.set(Math.cos(a) * 5.4, -0.2, Math.sin(a) * 5.4);
            g.add(l);
            this.lights.push(l);
        }
        const beam = this.beam = new THREE.Mesh(new THREE.CylinderGeometry(2, 9, 40, 20, 1, true),
            new THREE.MeshBasicMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }));
        beam.position.y = -20;
        g.add(hull, dome, alien, beam);
        this.group.add(g);
        const sg = this.at('space');
        this.ufoHome = this.track.pointAt((sg.s0 + sg.s1) / 2, 0, 25, 0, new THREE.Vector3());
    }

    buildTrees() {
        const trunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 5).translate(0, 1.5, 0);
        const leaves = mergeGeometries([
            new THREE.ConeGeometry(2.8, 5, 7).translate(0, 4.8, 0),
            new THREE.ConeGeometry(2.1, 4, 7).translate(0, 7, 0),
        ]);
        const n = 700;
        const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x7a4a2a }), n);
        const lm = new THREE.InstancedMesh(leaves, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
        let k = 0, tries = 0;
        while (k < n && tries++ < 20000) {
            const x = rand(-650, 650), z = rand(-650, 650);
            if (!this.isFree(x, z) || (x > -60 && x < 45 && z > -80 && z < 40)) continue;
            const s = rand(0.8, 1.7);
            _m.compose(_v.set(x, 0, z), _q.setFromAxisAngle(_v2.set(0, 1, 0), rand(0, 6)), _v2.set(s, s * rand(0.85, 1.25), s));
            tm.setMatrixAt(k, _m);
            lm.setMatrixAt(k, _m);
            lm.setColorAt(k, _c.setHSL(rand(0.24, 0.36), 0.55, rand(0.25, 0.4)));
            k++;
        }
        tm.count = lm.count = k;
        tm.castShadow = lm.castShadow = true;
        this.group.add(tm, lm);
    }

    buildFerrisWheel() {
        let x = 90, z = 60;
        for (let i = 0; i < 40 && !this.isFree(x, z); i++) { x += 25; z += 10; }
        const g = new THREE.Group();
        g.position.set(x, 26, z);
        g.rotation.y = 0.6;
        const wheel = this.wheel = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        wheel.add(new THREE.Mesh(new THREE.TorusGeometry(22, 0.5, 6, 40), mat));
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 22, 4), mat);
            spoke.position.set(Math.cos(a) * 11, Math.sin(a) * 11, 0);
            spoke.rotation.z = a - Math.PI / 2;
            wheel.add(spoke);
            const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(i / 16, 0.8, 0.55) }));
            cab.position.set(Math.cos(a) * 22, Math.sin(a) * 22 - 1.6, 0);
            wheel.add(cab);
        }
        g.add(wheel);
        for (const sx of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 28, 6), mat);
            leg.position.set(sx * 8, -12.5, 2);
            leg.rotation.z = sx * 0.3;
            g.add(leg);
        }
        this.group.add(g);
    }

    buildBalloons() {
        const T = this.track;
        this.balloons = [];
        const spots = [];
        const add = (s, x, y, star) => {
            const sg = T.segmentAt(s);
            if (sg.tunnel || sg.kind === 'station' || sg.kind === 'stop') return;
            const p = T.pointAt(s, x, y, 0, new THREE.Vector3());
            if (p.y < 1.8) p.y = 1.8 + Math.random() * 2;
            spots.push({ p, star });
        };
        // Balloons along both sides; gold stars in harder places (high up, far out, behind).
        let side = 1;
        for (let s = 70; s < T.length - 60; s += 21) {
            side = -side;
            add(s, side * rand(2.5, 4.5), rand(0.5, 2.8), false);
            if (Math.random() < 0.25) add(s + 7, -side * rand(3, 5), rand(1.5, 3.5), false);
        }
        const starSpots = [['lift', 0.5, 0, 14], ['loop', 0.5, 0, 6], ['hill', 0.5, -9, 6], ['space', 0.5, 12, 4],
            ['jump', 0.5, 0, 5], ['helix', 0.5, 0, -7], ['overbank', 0.5, 14, 2], ['twist', 0.5, 6, 0]];
        for (const [tag, f, x, y] of starSpots) {
            const sg = T.tags[tag];
            if (sg) add(sg.s0 + (sg.s1 - sg.s0) * f, x, y, true);
        }

        const balloonGeo = mergeGeometries([
            new THREE.SphereGeometry(0.8, 14, 10).scale(1, 1.2, 1),
            new THREE.ConeGeometry(0.16, 0.3, 6).rotateX(Math.PI).translate(0, -1.08, 0),
        ]);
        const shape = new THREE.Shape();
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.55 : 1.3;
            if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }).translate(0, 0, -0.17);
        const nb = spots.filter(o => !o.star).length, ns = spots.length - nb;
        this.balloonMesh = new THREE.InstancedMesh(balloonGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }), nb);
        this.starMesh = new THREE.InstancedMesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0x806000, metalness: 0.6, roughness: 0.3 }), ns);
        this.balloonMesh.frustumCulled = this.starMesh.frustumCulled = false;
        this.strings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.strings.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nb * 6), 3));
        this.strings.frustumCulled = false;
        this.group.add(this.balloonMesh, this.starMesh, this.strings);
        const colors = [0xff3b3b, 0xffd23b, 0x3bff6a, 0x3bb4ff, 0xc23bff, 0xff7ad9, 0xff8a1f];
        let bi = 0, si = 0;
        for (const { p, star } of spots) {
            const color = star ? 0xffd700 : colors[bi % colors.length];
            if (!star) this.balloonMesh.setColorAt(bi, _c.set(color));
            this.balloons.push({ pos: p.clone(), base: p, alive: true, star, color, idx: star ? si++ : bi++, phase: Math.random() * 6, value: star ? 5 : 1 });
        }
        this.balloonTotal = this.balloons.reduce((a, b) => a + b.value, 0);
    }

    resetBalloons() {
        for (const b of this.balloons) b.alive = true;
    }

    pop(b) {
        b.alive = false;
        const cols = b.star ? [0xffd700, 0xffffff, 0xfff080] : [b.color, 0xffffff, b.color];
        this.confetti.burst(b.pos, b.star ? 70 : 40, { speed: 7, colors: cols, life: 1.6, gravity: 4, drag: 2.5 });
    }

    animateBalloons(t) {
        const str = this.strings.geometry.attributes.position;
        for (const b of this.balloons) {
            b.pos.copy(b.base);
            b.pos.y += Math.sin(t * 1.3 + b.phase) * 0.35;
            const mesh = b.star ? this.starMesh : this.balloonMesh;
            if (b.star) _q.setFromAxisAngle(_v2.set(0, 1, 0), t * 2.5 + b.phase);
            else _q.setFromAxisAngle(_v2.set(0, 0, 1), Math.sin(t + b.phase) * 0.12);
            mesh.setMatrixAt(b.idx, _m.compose(b.pos, _q, _v2.setScalar(b.alive ? 1 : 0)));
            if (!b.star) {
                const i = b.idx * 6;
                const y0 = b.alive ? b.pos.y - 1.15 : -9999;
                str.array[i] = b.pos.x; str.array[i + 1] = y0; str.array[i + 2] = b.pos.z;
                str.array[i + 3] = b.pos.x + 0.1; str.array[i + 4] = y0 - 1.7; str.array[i + 5] = b.pos.z;
            }
        }
        this.balloonMesh.instanceMatrix.needsUpdate = true;
        this.starMesh.instanceMatrix.needsUpdate = true;
        str.needsUpdate = true;
    }

    launchFirework(center) {
        const p = center.clone().add(_v.set(rand(-40, 40), 0, rand(-40, 40)));
        p.y = 1;
        this.fireworks.push({ p, v: new THREE.Vector3(rand(-3, 3), rand(38, 50), rand(-3, 3)), t: rand(1.1, 1.6), col: [0xff3b3b, 0x3bff6a, 0x3bb4ff, 0xffd23b, 0xff7ad9, 0xffffff][(Math.random() * 6) | 0] });
    }

    // ride: { pos (train), speed, s, altitude, fireworks: bool }
    animate(t, dt, ride, sound) {
        const space = smooth(45, 82, ride.altitude);
        this.space = space;
        this.scene.background.copy(SKY_DAY).lerp(SKY_SPACE, space);
        this.scene.fog.color.copy(this.scene.background);
        this.scene.fog.near = 260 + space * 2000;
        this.scene.fog.far = 1500 + space * 4000;
        this.stars.material.opacity = space;
        this.stars.visible = space > 0.01;
        for (const m of this.planetMats) m.opacity = space;
        this.planet.visible = space > 0.01;
        this.planet.rotation.y = t * 0.02;

        this.confetti.update(dt);
        this.sparks.update(dt);
        if (this.lavaTex) { this.lavaTex.offset.y = t * 0.05; this.lavaTex.offset.x = Math.sin(t * 0.3) * 0.05; }
        this.wheel.rotation.z = t * 0.12;
        this.water.material.color.setHSL(0.58, 0.72, 0.5 + Math.sin(t * 1.3) * 0.03);

        // Monster: eyes follow the train, blink, and the head breathes.
        for (const e of this.eyes) {
            e.lookAt(ride.pos);
            const blink = (t % 4.3) < 0.16;
            e.userData.lid.rotation.x = blink ? -0.1 : -1.2;
        }
        this.monster.scale.setScalar(1 + Math.sin(t * 2) * 0.02);

        // Axes swing across the track; they cut right in front of and right behind you.
        for (const ax of this.axes) {
            const sd = ride.s - ax.s;
            const near = 1 - smooth(22, 45, Math.abs(sd));
            const driven = 1.05 * Math.sin(Math.PI * (sd + 3.5) / 7);
            const free = 1.05 * Math.sin(t * 1.6 + ax.s);
            ax.arm.rotation.z = free + (driven - free) * near;
            if (sd > -12 && !ax.whooshed) { ax.whooshed = true; sound.play('whoosh'); }
            if (sd < -40) ax.whooshed = false;
        }

        // Rings of fire flicker and throw sparks.
        for (const fr of this.fireRings) {
            fr.ring.material.color.setHSL(0.05 + Math.random() * 0.05, 1, 0.5 + Math.random() * 0.15);
            if (Math.random() < 0.6) {
                _v.set(rand(-1, 1), rand(-1, 1), 0).normalize().multiplyScalar(4.4).applyQuaternion(fr.ring.quaternion).add(fr.ring.position);
                this.sparks.burst(_v, 1, { speed: 2, colors: [0xff6a00, 0xffc000, 0xff3000], life: 0.9, gravity: -4, drag: 1 });
            }
        }
        if (Math.random() < 0.5 && this.lavaMid) {
            _v.copy(this.lavaMid).addScaledVector(this.lavaDir, rand(-0.5, 0.5) * this.lavaLen);
            _v.y = 0.5;
            this.sparks.burst(_v, 3, { speed: 3, up: 12, colors: [0xff5a00, 0xffb000], life: 1.4, gravity: 9, drag: 0.3 });
        }

        // UFO: circles the top hat, then comes to look at you when you're up there.
        const u = this.ufo;
        _v.copy(this.ufoHome).add(_v2.set(Math.cos(t * 0.4) * 60, 8 + Math.sin(t * 0.7) * 6, Math.sin(t * 0.4) * 60));
        if (ride.altitude > 45) {
            const k = smooth(45, 85, ride.altitude);
            _v2.copy(ride.pos).add(_v.clone().sub(ride.pos).normalize().multiplyScalar(22)).setY(ride.pos.y + 10);
            _v.lerp(_v2, k);
            if (!this.ufoSeen && k > 0.5) { this.ufoSeen = true; sound.play('ufo'); }
        } else this.ufoSeen = false;
        u.position.lerp(_v, 1 - Math.exp(-dt * 1.5));
        u.rotation.y = t * 2;
        this.lights.forEach((l, i) => l.material.color.setHSL(((i / 10) + t) % 1, 1, 0.6));
        this.beam.material.opacity = 0.12 + Math.sin(t * 7) * 0.06;

        this.animateBalloons(t);

        // Fireworks.
        if (ride.fireworks) {
            this.fwT -= dt;
            if (this.fwT <= 0) { this.fwT = rand(0.25, 0.7); this.launchFirework(ride.fireworks); sound.play('firework'); }
        }
        for (let i = this.fireworks.length - 1; i >= 0; i--) {
            const f = this.fireworks[i];
            f.v.y -= 9.8 * dt;
            f.p.addScaledVector(f.v, dt);
            f.t -= dt;
            this.sparks.burst(f.p, 1, { speed: 0.5, colors: [0xffc070], life: 0.5, gravity: 2 });
            if (f.t <= 0) {
                this.sparks.burst(f.p, 140, { speed: 16, colors: [f.col, f.col, 0xffffff], life: 2.2, gravity: 3, drag: 1.2 });
                this.fireworks.splice(i, 1);
            }
        }
    }
}
