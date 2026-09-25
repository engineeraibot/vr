// World 1-1, rebuilt in 3D. The level runs along +x; 1 tile = 1 metre.
// The playable strip is Z_HALF*2 wide (invisible walls keep you from falling off the sides).
import * as THREE from 'three';
import { CollisionWorld } from './physics.js';
import { MAT, GEO, Baker, tiledBox, mergeList, pipeGeometry, addHill, addBush, addCloud } from './models.js';

export const Z_HALF = 4;
export const FLAG_X = 198;              // column of the flagpole's base block
export const POLE_X = FLAG_X + 0.5;
export const POLE_TOP = 10.5;
export const CASTLE_X = 202;            // castle's west (door) face
export const ROOM_X = 400;              // hidden coin room, far away from the main level
export const START = { x: 3, z: 0 };
export const CHECKPOINT = { x: 92, z: 0 };
export const DEATH_Y = -6;

const TMP = {
    m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), one: new THREE.Vector3(1, 1, 1), zero: new THREE.Vector3(0, 0, 0),
};

const GROUND = [[-6, 69], [71, 86], [89, 153], [155, 216]];

const PIPES = [
    { x: 28, h: 2 }, { x: 38, h: 3 }, { x: 46, h: 4 },
    { x: 57, h: 4, warp: true },
    { x: 163, h: 2, exit: true }, { x: 179, h: 2 },
];

const STAIRS = [];
const stair = (x0, hs) => hs.forEach((h, i) => STAIRS.push([x0 + i, h]));
stair(134, [1, 2, 3, 4]);
stair(140, [4, 3, 2, 1]);
stair(148, [1, 2, 3, 4, 4]);
stair(155, [4, 3, 2, 1]);
stair(181, [1, 2, 3, 4, 5, 6, 7, 8, 8]);

// [x, y, type, content]  type: b = brick, q = question block, h = hidden block
const BLOCKS = [
    [16, 3, 'q', 'coin'],
    [20, 3, 'b'], [21, 3, 'q', 'mushroom'], [22, 3, 'b'], [23, 3, 'q', 'coin'], [24, 3, 'b'],
    [22, 7, 'q', 'coin'],
    [64, 4, 'h', '1up'],
    [77, 3, 'b'], [78, 3, 'q', 'mushroom'], [79, 3, 'b'],
    ...[80, 81, 82, 83, 84, 85, 86, 87].map(x => [x, 7, 'b']),
    [91, 7, 'b'], [92, 7, 'b'], [93, 7, 'b'], [94, 7, 'q', 'coin'],
    [94, 3, 'b', 'multicoin'],
    [100, 3, 'b'], [101, 3, 'b', 'star'],
    [106, 3, 'q', 'coin'], [109, 3, 'q', 'coin'], [109, 7, 'q', 'mushroom'], [112, 3, 'q', 'coin'],
    [118, 3, 'b'],
    [121, 7, 'b'], [122, 7, 'b'], [123, 7, 'b'],
    [128, 7, 'b'], [129, 7, 'q', 'coin'], [130, 7, 'q', 'coin'], [131, 7, 'b'],
    [129, 3, 'b'], [130, 3, 'b'],
    [168, 3, 'b'], [169, 3, 'b'], [170, 3, 'q', 'coin'], [171, 3, 'b'],
];

// [type, x, z, y]  g = goomba, k = koopa troopa
export const ENEMIES = [
    ['g', 22, 0], ['g', 40, 0.5], ['g', 51, -1], ['g', 52.5, 1],
    ['g', 80.5, 0, 8], ['g', 82.5, 0, 8],
    ['g', 97, -1], ['g', 98.5, 1], ['k', 107, 0],
    ['g', 114, 0.5], ['g', 115.5, -0.5], ['g', 124, -1], ['g', 125.5, 1],
    ['g', 128, 0], ['g', 129.5, 0.8], ['g', 174, -1], ['g', 175.5, 1],
];

const COINS = [];
const coinArc = (x0, n, y0, peak, z = 0) => {
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        COINS.push([x0 + i, y0 + Math.sin(t * Math.PI) * peak, z]);
    }
};
const coinRow = (x0, n, y, z = 0) => { for (let i = 0; i < n; i++) COINS.push([x0 + i, y, z]); };
// Extra coins that only make sense in 3D: side paths and arcs over the pits.
coinRow(31, 5, 0.6, -2.8);
coinRow(41, 4, 0.6, 2.8);
coinArc(68.5, 4, 1.2, 1.6);
coinArc(85.5, 5, 1.2, 1.8);
coinRow(138.5, 2, 5.2);
coinArc(152.5, 4, 5.2, 1.2);
coinRow(165, 3, 0.6, -2.8);
// Hidden coin room
coinRow(ROOM_X + 4.5, 7, 3.5);
coinRow(ROOM_X + 5.5, 5, 6);
coinRow(ROOM_X + 5.5, 5, 8.2);
coinRow(ROOM_X + 4.5, 7, 0.6, 2.6);
coinRow(ROOM_X + 4.5, 7, 0.6, -2.6);

// Deterministic pseudo random for scenery placement.
function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const inPit = x => (x > 67.5 && x < 72.5) || (x > 84.5 && x < 90.5) || (x > 151.5 && x < 156.5);
const busy = x => inPit(x) || (x > 132 && x < 160) || (x > 179 && x < 200)
    || PIPES.some(p => x > p.x - 1.5 && x < p.x + 3.5);

export class Level {
    constructor(game) {
        this.game = game;
        this.staticGroup = new THREE.Group();
        this.staticSolids = [];
        this.buildStatic();
    }

    solid(minX, minY, minZ, maxX, maxY, maxZ, kind, extra = {}) {
        const s = { minX, minY, minZ, maxX, maxY, maxZ, kind, ...extra };
        this.staticSolids.push(s);
        return s;
    }

    buildStatic() {
        const G = this.staticGroup;
        const add = (geo, mat, cast = true, receive = true) => {
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = cast;
            m.receiveShadow = receive;
            G.add(m);
            return m;
        };
        const box = (list, w, h, d, x, y, z) => { const g = tiledBox(w, h, d); g.translate(x, y, z); list.push(g); };

        // Ground strip
        const ground = [];
        for (const [a, b] of GROUND) {
            box(ground, b - a, 2, Z_HALF * 2, (a + b) / 2, -1, 0);
            this.solid(a, -2, -Z_HALF, b, 0, Z_HALF, 'ground');
        }
        add(mergeList(ground), MAT.ground, false, true);

        // Stairs (full width so they must be climbed) and the flagpole base
        const hard = [];
        for (const [x, h] of STAIRS) {
            box(hard, 1, h, Z_HALF * 2, x + 0.5, h / 2, 0);
            this.solid(x, 0, -Z_HALF, x + 1, h, Z_HALF, 'hard');
        }
        box(hard, 1, 1, 1, FLAG_X + 0.5, 0.5, 0);
        this.solid(FLAG_X, 0, -0.5, FLAG_X + 1, 1, 0.5, 'hard');
        add(mergeList(hard), MAT.hard);

        // Pipes
        const pipeGeos = [], holes = [];
        this.pipes = [];
        for (const p of PIPES) {
            const cx = p.x + 1, cz = 0;
            const g = pipeGeometry(p.h);
            g.translate(cx, 0, cz);
            pipeGeos.push(g);
            const hole = new THREE.CircleGeometry(0.8, 24).rotateX(-Math.PI / 2);
            hole.translate(cx, p.h + 0.01, cz);
            holes.push(hole);
            const pipe = { ...p, cx, cz, top: p.h };
            pipe.solid = this.solid(cx - 0.85, 0, cz - 0.85, cx + 0.85, p.h, cz + 0.85, 'pipe', { pipe });
            this.pipes.push(pipe);
            if (p.exit) this.exitPipe = pipe;
        }

        // Invisible walls: the sides of the strip, the start and the end.
        this.solid(-10, -60, -Z_HALF - 3, 216, 60, -Z_HALF, 'wall', { noShadow: true });
        this.solid(-10, -60, Z_HALF, 216, 60, Z_HALF + 3, 'wall', { noShadow: true });
        this.solid(-10, -60, -10, -6, 60, 10, 'wall', { noShadow: true });
        this.solid(209.5, -60, -10, 216, 60, 10, 'wall', { noShadow: true });

        // Flagpole
        const fb = new Baker();
        fb.add(GEO.cyl, 0xb8e8a8, [POLE_X, 1 + (POLE_TOP - 1) / 2, 0], [0.07, POLE_TOP - 1, 0.07]);
        fb.add(GEO.sphere, 0x1ca01c, [POLE_X, POLE_TOP + 0.22, 0], [0.25, 0.25, 0.25]);
        fb.add(GEO.cyl, 0x8a8a8a, [CASTLE_X + 2.5, 6.1, 0], [0.04, 1.8, 0.04]);
        add(fb.build(), MAT.vcol);
        this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), MAT.flag);
        this.flag.rotation.y = -Math.PI / 2;
        this.flag.castShadow = true;
        G.add(this.flag);
        this.castleFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), MAT.starFlag);
        this.castleFlag.rotation.y = -Math.PI / 2;
        G.add(this.castleFlag);

        // Castle (door faces the player coming from -x)
        const castle = [];
        const CX = CASTLE_X + 2.5;
        box(castle, 5, 3, 5, CX, 1.5, 0);
        for (let i = 0; i < 5; i++) for (const z of [-2.15, 2.15]) box(castle, 0.7, 0.6, 0.7, CASTLE_X + 0.35 + i * 1.075, 3.3, z);
        for (let i = 1; i < 4; i++) for (const x of [CASTLE_X + 0.35, CASTLE_X + 4.65]) box(castle, 0.7, 0.6, 0.7, x, 3.3, -2.15 + i * 1.075);
        box(castle, 3, 2.2, 3, CX, 4.1, 0);
        for (let i = 0; i < 3; i++) for (const z of [-1.2, 1.2]) box(castle, 0.6, 0.5, 0.6, CX - 1.2 + i * 1.2, 5.45, z);
        for (const x of [CX - 1.2, CX + 1.2]) box(castle, 0.6, 0.5, 0.6, x, 5.45, 0);
        add(mergeList(castle), MAT.brick);
        const dark = [];
        const db = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); dark.push(g); };
        db(0.06, 1.6, 1.1, CASTLE_X - 0.02, 0.8, 0);
        const arch = new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16, 1, false, 0, Math.PI);
        arch.rotateZ(Math.PI / 2);
        arch.translate(CASTLE_X - 0.02, 1.6, 0);
        dark.push(arch);
        for (const z of [-0.6, 0.6]) db(0.06, 0.8, 0.4, CX - 1.52, 4.2, z);
        holes.push(...dark);

        // Hidden coin room (fully enclosed brick room)
        const R = ROOM_X;
        const ugG = [], ugB = [];
        box(ugG, 16, 2, 10, R + 8, -1, 0);
        this.solid(R, -2, -5, R + 16, 0, 5, 'ground');
        box(ugB, 1, 12, 8, R + 0.5, 6, 0);
        this.solid(R - 2, 0, -6, R + 1, 13, 6, 'wall');
        box(ugB, 1, 12, 8, R + 15.5, 6, 0);
        this.solid(R + 15, 0, -6, R + 18, 13, 6, 'wall');
        box(ugB, 16, 13, 1, R + 8, 5.5, -4.5);
        this.solid(R, -2, -7, R + 16, 13, -4, 'wall');
        box(ugB, 16, 13, 1, R + 8, 5.5, 4.5);
        this.solid(R, -2, 4, R + 16, 13, 7, 'wall');
        box(ugB, 14, 1, 8, R + 8, 11.5, 0);
        this.solid(R, 11, -6, R + 16, 14, 6, 'wall', { noShadow: true });
        const platform = [];
        box(platform, 7, 3, 3, R + 7.5, 1.5, 0);
        this.solid(R + 4, 0, -1.5, R + 11, 3, 1.5, 'hard');
        add(mergeList(ugG), MAT.ugGround, false, true);
        add(mergeList(ugB), MAT.ugBrick, false, true);
        add(mergeList(platform), MAT.ugBrick, true, true);
        // Exit pipe lying on its side (mouth facing -x) plus the pipe going up into the ceiling.
        const side = pipeGeometry(3);
        side.rotateZ(Math.PI / 2);
        side.translate(R + 15, 1, 0);
        pipeGeos.push(side);
        const up = new THREE.CylinderGeometry(0.88, 0.88, 9, 24, 1, true);
        up.translate(R + 14, 6.5, 0);
        pipeGeos.push(up);
        const mouth = new THREE.CircleGeometry(0.8, 24).rotateY(-Math.PI / 2);
        mouth.translate(R + 11.99, 1, 0);
        holes.push(mouth);
        this.solid(R + 12, 0, -1, R + 15, 2, 1, 'pipe');
        // Brick walls either side of the exit pipe, so its mouth is the only way on.
        for (const s of [-1, 1]) {
            box(ugB, 3, 11, 3, R + 13.5, 5.5, s * 2.5);
            this.solid(R + 12, 0, s > 0 ? 1 : -4, R + 15, 11, s > 0 ? 4 : -1, 'hard');
        }
        this.solid(R + 13.1, 2, -0.9, R + 14.9, 11, 0.9, 'pipe');
        this.roomExit = { x: R + 12, z: 0 };
        this.roomSpawn = { x: R + 2.5, y: 8.5, z: 0 };

        add(mergeList(pipeGeos), MAT.pipe);
        add(mergeList(holes), MAT.black, false, false);

        // Scenery: hills, bushes and clouds baked into single meshes.
        const rand = rng(11);
        const hills = new Baker();
        for (let x = -30; x < 250; x += 20 + rand() * 12) {
            for (const side of [-1, 1]) {
                const r = 9 + rand() * 9;
                addHill(hills, x + side * 6 + rand() * 6, side * (20 + rand() * 16), r, 12 + rand() * 9, -14);
            }
        }
        for (let x = 12; x < 200; x += 9 + rand() * 7) {
            if (busy(x)) continue;
            const side = rand() < 0.5 ? -1 : 1;
            addBush(hills, x, 0.25, side * (Z_HALF - 0.1), 1 + Math.floor(rand() * 3));
        }
        const hillMesh = add(hills.build(), MAT.vcol, false, true);
        hillMesh.userData.scenery = true;

        const clouds = new Baker();
        for (let x = -20; x < 250; x += 7 + rand() * 8) {
            const over = rand() < 0.3;
            const z = over ? (rand() - 0.5) * 6 : (rand() < 0.5 ? -1 : 1) * (8 + rand() * 25);
            addCloud(clouds, x, over ? 14 + rand() * 3 : 9 + rand() * 7, z, 1 + Math.floor(rand() * 3));
        }
        add(clouds.build(), MAT.cloud, false, false);

        const valley = new THREE.Mesh(new THREE.PlaneGeometry(700, 500).rotateX(-Math.PI / 2), MAT.valley);
        valley.position.set(110, -20, 0);
        G.add(valley);
    }

    // Rebuild everything that can change while playing (blocks, coins, flags).
    reset() {
        this.cw = new CollisionWorld();
        for (const s of this.staticSolids) this.cw.add(s);
        if (this.dyn) this.dyn.removeFromParent();
        if (this.coinMesh) this.coinMesh.dispose();
        this.dyn = new THREE.Group();
        this.game.world.add(this.dyn);

        this.blocks = [];
        for (const [x, y, t, content] of BLOCKS) this.addBlock(x, y, 0, t, content);

        this.coins = COINS.map(([x, y, z]) => ({ x, y, z, taken: false }));
        this.coinMesh = new THREE.InstancedMesh(GEO.coin, MAT.vglow, this.coins.length);
        this.coinMesh.castShadow = true;
        this.coinMesh.frustumCulled = false;
        this.dyn.add(this.coinMesh);

        this.flag.position.set(POLE_X - 0.02, POLE_TOP - 0.75, -0.8);
        this.castleFlag.position.set(CASTLE_X + 2.5, 5.0, -0.47);
    }

    addBlock(x, y, z, type, content) {
        const hidden = type === 'h';
        const mat = type === 'q' ? MAT.question : hidden ? MAT.used : MAT.brick;
        const mesh = new THREE.Mesh(GEO.block, mat);
        mesh.position.set(x + 0.5, y + 0.5, z);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.visible = !hidden;
        this.dyn.add(mesh);
        const b = { x, y, z, type, content, used: false, broken: false, mesh, bumpT: 0 };
        b.solid = this.cw.add({ minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: z - 0.5, maxZ: z + 0.5, kind: 'block', block: b, hidden });
        this.blocks.push(b);
        return b;
    }

    updateCoins(time) {
        const { m, q, p, one, zero } = TMP;
        q.setFromAxisAngle(TMP.up, time * 3);
        this.coins.forEach((c, i) => {
            p.set(c.x, c.y + Math.sin(time * 2 + c.x) * 0.06, c.z);
            m.compose(p, q, c.taken ? zero : one);
            this.coinMesh.setMatrixAt(i, m);
        });
        this.coinMesh.instanceMatrix.needsUpdate = true;
    }
}
