// The train: your front car (it carries the camera) and the cars behind you full of riders
// who throw their arms up on the big moments.
import * as THREE from 'three';

export const CAR_GAP = 2.7;
const CARS = 5;
const SKIN = [0xffd2b0, 0xe8b08a, 0xc68a5e, 0x8d5a3a, 0xf5c9a0];
const HAIR = [0x2a1a10, 0x6a3a18, 0xe8c050, 0x101010, 0xc04020, 0x8030ff, 0x20c0ff];
const SHIRT = [0xff3b3b, 0x3bb4ff, 0x3bff6a, 0xffd23b, 0xc23bff, 0xff7ad9, 0xffffff];
const pick = a => a[(Math.random() * a.length) | 0];
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();

function carBody(color, front) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe0e4ea, roughness: 0.15, metalness: 0.9 });
    // Tub: floor, sides, back; you sit in it with the head sticking out.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 2.2), trim);
    floor.position.set(0, -1.02, 0);
    g.add(floor);
    for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 2.2), paint);
        side.position.set(sx * 0.72, -0.72, 0);
        g.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.44, 1.05, 0.14), paint);
    back.position.set(0, -0.52, 1.06);
    g.add(back);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.2), trim);
    seat.position.set(0, -0.55, 0.9);
    g.add(seat);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.55, 0.14), paint);
    dash.position.set(0, -0.72, -1.06);
    g.add(dash);
    if (front) {
        // A big nose with googly eyes, because why not.
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), paint);
        nose.rotation.x = -Math.PI / 2;
        nose.scale.set(1, 1.3, 0.7);
        nose.position.set(0, -0.75, -1.12);
        g.add(nose);
        for (const sx of [-0.35, 0.35]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }));
            eye.position.set(sx, -0.78, -1.5);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
            pupil.position.set(0, 0, -0.16);
            eye.add(pupil);
            g.add(eye);
        }
    }
    // Wheels on the rails.
    const wheel = new THREE.CylinderGeometry(0.16, 0.16, 0.14, 10).rotateZ(Math.PI / 2);
    for (const sx of [-0.55, 0.55]) for (const sz of [-0.75, 0.75]) {
        const w = new THREE.Mesh(wheel, chrome);
        w.position.set(sx, -1.08 + 0.12, sz);
        g.add(w);
    }
    // Lap bar.
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xffd23b, roughness: 0.4 }));
    bar.position.set(0, -0.62, -0.32);
    bar.rotation.set(-0.9, 0, 0);
    g.add(bar);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

// A little rider; arms go from holding the bar (0) to straight up (1).
function makeRider(x) {
    const g = new THREE.Group();
    g.position.set(x, 0, 0.25);
    const shirt = new THREE.MeshLambertMaterial({ color: pick(SHIRT) });
    const skin = new THREE.MeshLambertMaterial({ color: pick(SKIN) });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 8), shirt);
    torso.position.y = -0.55;
    g.add(torso);
    const head = new THREE.Group();
    head.position.y = -0.05;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin));
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: pick(HAIR) }));
    hair.rotation.x = 0.35;
    head.add(hair);
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x401010 }));
    mouth.position.set(0, -0.07, -0.155);
    head.add(mouth);
    for (const ex of [-0.06, 0.06]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        e.position.set(ex, 0.03, -0.16);
        head.add(e);
    }
    g.add(head);
    const arms = [];
    for (const sx of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * 0.25, -0.32, 0);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.6, 6).translate(0, 0.3, 0), shirt);
        pivot.add(arm);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
        hand.position.y = 0.62;
        pivot.add(hand);
        g.add(pivot);
        arms.push({ pivot, sx });
    }
    return { g, head, arms, mouth, up: 0, phase: Math.random() * 6, wild: Math.random() };
}

function setArms(r, up, t) {
    for (const a of r.arms) {
        const wave = Math.sin(t * 9 + r.phase + a.sx) * 0.25 * up;
        // down: pointing forward to the lap bar; up: to the sky, a bit apart
        a.pivot.rotation.x = THREE.MathUtils.lerp(-1.9, -0.1, up) + wave;
        a.pivot.rotation.z = a.sx * -THREE.MathUtils.lerp(0.1, 0.45, up);
    }
    r.mouth.scale.setScalar(1 + up * 1.6);
}

export class Train {
    constructor(track, scene, rig) {
        this.track = track;
        this.cars = [];
        const colors = [0xff2d8a, 0x22b8ff, 0xffd23b, 0x3bff6a, 0xc23bff];
        for (let i = 0; i < CARS; i++) {
            const g = carBody(colors[i % colors.length], i === 0);
            const riders = [];
            if (i > 0) {
                for (const x of [-0.34, 0.34]) {
                    const r = makeRider(x);
                    g.add(r.g);
                    riders.push(r);
                }
            }
            if (i === 0) rig.add(g); else scene.add(g);
            this.cars.push({ g, riders });
        }
        // Your own arms, visible when you throw them up (or look down at the bar).
        this.me = makeRider(0);
        this.me.g.position.set(0, 0, 0.12);
        this.me.head.visible = false;
        this.me.g.children[0].visible = false;
        rig.add(this.me.g);
        this.me.arms.forEach(a => a.pivot.position.set(a.sx * 0.22, -0.3, 0));
    }

    // s = front car position; excite 0..1 raises arms; meUp = your own arms.
    update(s, t, excite, meUp) {
        for (let i = 1; i < this.cars.length; i++) {
            const c = this.cars[i];
            this.track.frameAt(Math.max(0, s - i * CAR_GAP), _p, _q);
            c.g.position.copy(_p);
            c.g.quaternion.copy(_q);
            for (const r of c.riders) {
                const want = Math.min(1, excite * (0.6 + r.wild));
                r.up += (want - r.up) * 0.12;
                setArms(r, r.up, t);
                r.head.rotation.y = Math.sin(t * 0.7 + r.phase) * 0.6 * (1 - r.up);
                r.head.rotation.x = -r.up * 0.3;
            }
        }
        this.me.up += ((meUp ? 1 : 0) - this.me.up) * 0.2;
        setArms(this.me, this.me.up, t);
    }
}
