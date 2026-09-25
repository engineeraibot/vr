// Enemies, power-ups, fireballs and visual effects.
import * as THREE from 'three';
import { MAT, GEO } from './models.js';
import { moveEntity, makeResult } from './physics.js';
import { textTexture } from './textures.js';

const GRAV = 38;
const ACTIVATE_DIST = 26;
const SHELL_SPEED = 11;
const res = makeResult();

function shadowed(mesh) {
    mesh.castShadow = true;
    return mesh;
}

class Actor {
    constructor(game, x, y, z) {
        this.game = game;
        this.x = x; this.y = y; this.z = z;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.dead = false;
        this.root = new THREE.Group();
        this.root.position.set(x, y, z);
        game.level.dyn.add(this.root);
    }

    fall(dt, g = GRAV) {
        this.vy = Math.max(this.vy - g * dt, -20);
        moveEntity(this.game.level.cw, this, this.vx * dt, this.vy * dt, this.vz * dt, res);
        if (res.ground) this.vy = 0;
        if (this.y < -14) this.remove();
        return res;
    }

    remove() {
        this.dead = true;
        this.root.removeFromParent();
    }
}

class Enemy extends Actor {
    constructor(game, x, y, z) {
        super(game, x, y, z);
        this.dir = -1;
        this.active = false;
        this.state = 'walk';
        this.t = 0;
        this.grace = 0;
        this.speed = 2;
    }

    get solidBody() { return this.state === 'walk' || this.state === 'shell' || this.state === 'shellMove'; }

    update(dt) {
        if (this.dead) return;
        if (!this.active) {
            const p = this.game.player;
            if (this.game.area !== 'over' || Math.abs(p.x - this.x) > ACTIVATE_DIST) return;
            this.active = true;
        }
        this.grace -= dt;
        this.t += dt;
        if (this.state === 'flip') {
            this.vy -= GRAV * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.y < -14) this.remove();
            return;
        }
        if (this.state === 'squash') {
            if (this.t > 0.6) this.remove();
            return;
        }
        if (this.game.player.x - this.x > 45) { this.remove(); return; }
        this.think(dt);
    }

    walk(dt) {
        this.vx = this.dir * this.speed;
        this.vz = 0;
        const r = this.fall(dt);
        if (r.hitX) this.dir = -this.dir;
    }

    flipDie(dirX) {
        this.state = 'flip';
        this.vy = 9;
        this.vx = dirX * 2.5;
        this.vz = 0;
        this.t = 0;
    }

    face() {
        const vx = this.state === 'walk' ? this.dir : this.vx;
        this.root.rotation.set(0, vx >= 0 ? Math.PI / 2 : -Math.PI / 2, 0);
    }
}

export class Goomba extends Enemy {
    constructor(game, x, y, z) {
        super(game, x, y, z);
        this.kind = 'goomba';
        this.hx = this.hz = 0.4;
        this.h = 0.85;
        this.body = shadowed(new THREE.Mesh(GEO.goomba.body, MAT.vcol));
        this.feet = [-0.2, 0.2].map(fx => {
            const f = shadowed(new THREE.Mesh(GEO.goomba.foot, MAT.vcol));
            f.position.x = fx;
            return f;
        });
        this.root.add(this.body, ...this.feet);
    }

    think(dt) { this.walk(dt); }

    stomp() {
        this.state = 'squash';
        this.t = 0;
    }

    sync(time) {
        this.root.position.set(this.x, this.y, this.z);
        if (this.state === 'squash') {
            this.root.scale.set(1.25, 0.22, 1.25);
            return;
        }
        this.face();
        if (this.state === 'flip') {
            this.root.rotation.z = Math.PI;
            this.root.position.y += this.h;
            return;
        }
        if (this.active) {
            const ph = time * 11 + this.x;
            this.feet[0].position.z = Math.sin(ph) * 0.12;
            this.feet[1].position.z = -Math.sin(ph) * 0.12;
            this.body.rotation.z = Math.sin(ph) * 0.07;
        }
    }
}

export class Koopa extends Enemy {
    constructor(game, x, y, z) {
        super(game, x, y, z);
        this.kind = 'koopa';
        this.hx = this.hz = 0.4;
        this.h = 1.35;
        this.chain = 0;
        this.walker = new THREE.Group();
        this.body = shadowed(new THREE.Mesh(GEO.koopa.body, MAT.vcol));
        this.feet = [-0.16, 0.16].map(fx => {
            const f = shadowed(new THREE.Mesh(GEO.koopa.foot, MAT.vcol));
            f.position.x = fx;
            return f;
        });
        this.walker.add(this.body, ...this.feet);
        this.shell = shadowed(new THREE.Mesh(GEO.koopa.shell, MAT.vcol));
        this.shell.visible = false;
        this.root.add(this.walker, this.shell);
    }

    think(dt) {
        if (this.state === 'walk') {
            this.walk(dt);
        } else if (this.state === 'shell') {
            this.vx = this.vz = 0;
            this.fall(dt);
            if (this.t > 8) this.revive();
        } else if (this.state === 'shellMove') {
            const r = this.fall(dt);
            if (r.hitX) { this.vx = -this.vx; this.game.sound.play('bump'); }
            if (r.hitZ) this.vz = -this.vz;
        }
    }

    toShell() {
        this.state = 'shell';
        this.h = 0.55;
        this.vx = this.vz = 0;
        this.t = 0;
        this.grace = 0.25;
        this.chain = 0;
    }

    kick(dx, dz) {
        const l = Math.hypot(dx, dz) || 1;
        this.vx = dx / l * SHELL_SPEED;
        this.vz = dz / l * SHELL_SPEED;
        this.state = 'shellMove';
        this.grace = 0.3;
        this.t = 0;
    }

    revive() {
        this.state = 'walk';
        this.h = 1.35;
        this.dir = this.game.player.x > this.x ? 1 : -1;
        this.grace = 0.2;
    }

    sync(time) {
        this.root.position.set(this.x, this.y, this.z);
        const shell = this.state === 'shell' || this.state === 'shellMove' || (this.state === 'flip' && this.h < 1);
        this.walker.visible = !shell;
        this.shell.visible = shell;
        if (this.state === 'shellMove') {
            this.root.rotation.set(0, time * 18, 0);
        } else if (this.state === 'shell') {
            this.root.rotation.set(0, 0, this.t > 6 ? Math.sin(time * 40) * 0.08 : 0);
        } else {
            this.face();
        }
        if (this.state === 'flip') {
            this.root.rotation.z = Math.PI;
            this.root.position.y += this.h;
        } else if (this.state === 'walk' && this.active) {
            const ph = time * 9 + this.x;
            this.feet[0].position.z = Math.sin(ph) * 0.12;
            this.feet[1].position.z = -Math.sin(ph) * 0.12;
            this.body.rotation.z = Math.sin(ph) * 0.05;
        }
    }
}

// Power-ups that come out of blocks.
export class Item extends Actor {
    constructor(game, kind, block) {
        super(game, block.x + 0.5, block.y + 0.05, block.z);
        this.kind = kind;
        this.hx = this.hz = 0.35;
        this.h = 0.8;
        this.baseY = block.y + 1;
        this.state = 'sprout';
        this.t = 0;
        this.dir = 1;
        this.mesh = shadowed(new THREE.Mesh(GEO[kind], kind === 'star' ? MAT.vglow : MAT.vcol));
        this.root.add(this.mesh);
    }

    update(dt) {
        if (this.dead) return;
        this.t += dt;
        if (this.state === 'sprout') {
            this.y = this.baseY - 0.95 + Math.min(1, this.t / 0.9) * 0.95;
            if (this.t >= 0.9) {
                this.y = this.baseY;
                this.state = this.kind === 'flower' ? 'idle' : 'move';
                if (this.kind === 'star') this.vy = 9;
            }
            return;
        }
        if (this.state === 'idle') return;
        const star = this.kind === 'star';
        this.vx = this.dir * (star ? 4 : 3);
        this.vz = 0;
        const r = this.fall(dt, star ? 26 : GRAV);
        if (r.hitX) this.dir = -this.dir;
        if (r.ground && star) this.vy = 10;
    }

    sync(time) {
        this.root.position.set(this.x, this.y, this.z);
        if (this.kind === 'star') this.mesh.rotation.y = time * 5;
        else if (this.kind === 'flower') this.mesh.rotation.y = -Math.PI / 2 + Math.sin(time * 2) * 0.4;
        else this.mesh.rotation.y = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
}

export class Fireball extends Actor {
    constructor(game, x, y, z, dx, dz) {
        super(game, x, y, z);
        this.hx = this.hz = 0.15;
        this.h = 0.3;
        this.vx = dx * 12;
        this.vz = dz * 12;
        this.vy = -3;
        this.life = 2.5;
        const outer = new THREE.Mesh(GEO.sphere, MAT.fire);
        outer.scale.setScalar(0.2);
        outer.position.y = 0.15;
        const core = new THREE.Mesh(GEO.sphere, MAT.fireCore);
        core.scale.setScalar(0.11);
        core.position.set(0, 0.15, 0.08);
        this.spin = new THREE.Group();
        this.spin.add(outer, core);
        this.root.add(this.spin);
    }

    update(dt) {
        if (this.dead) return;
        this.life -= dt;
        this.vy -= 55 * dt;
        moveEntity(this.game.level.cw, this, this.vx * dt, this.vy * dt, this.vz * dt, res);
        if (res.ground) this.vy = 7.5;
        if (res.hitX || res.hitZ || this.life <= 0 || this.y < -10) this.explode();
    }

    explode() {
        if (this.dead) return;
        this.game.fx.puff(this.x, this.y + 0.15, this.z, 4, 0xffa040);
        this.remove();
    }

    sync(time) {
        this.root.position.set(this.x, this.y, this.z);
        this.spin.rotation.set(time * 20, time * 13, 0);
    }
}

// A coin that jumps out of a block and vanishes.
export class CoinPop extends Actor {
    constructor(game, x, y, z) {
        super(game, x, y, z);
        this.vy = 13;
        this.t = 0;
        this.mesh = new THREE.Mesh(GEO.coin, MAT.vglow);
        this.mesh.position.y = 0.4;
        this.root.add(this.mesh);
    }

    update(dt) {
        if (this.dead) return;
        this.t += dt;
        this.vy -= 42 * dt;
        this.y += this.vy * dt;
        if (this.t > 0.55) {
            this.game.fx.sparkle(this.x, this.y + 0.4, this.z);
            this.game.fx.popup(this.x, this.y + 0.6, this.z, '200');
            this.remove();
        }
    }

    sync(time) {
        this.root.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = time * 18;
    }
}

const PARTICLE_COLORS = {};
function particleMat(color) {
    return PARTICLE_COLORS[color] || (PARTICLE_COLORS[color] = new THREE.MeshBasicMaterial({ color }));
}

// Short-lived particles and floating score text.
export class Fx {
    constructor(game) {
        this.game = game;
        this.list = [];
    }

    add(mesh, o) {
        this.game.level.dyn.add(mesh);
        this.list.push({ mesh, life: o.life, max: o.life, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, g: o.g ?? 30, spin: o.spin || 0, grow: o.grow || 0, s0: mesh.scale.x });
    }

    debris(x, y, z) {
        for (let i = 0; i < 4; i++) {
            const sx = i % 2 ? 1 : -1, sz = i < 2 ? 1 : -1;
            const m = new THREE.Mesh(GEO.debris, MAT.brick);
            m.position.set(x + sx * 0.25, y + 0.25, z + sz * 0.25);
            this.add(m, { life: 1.4, vx: sx * 2.5, vy: 10 + (i % 2) * 3, vz: sz * 2, g: 40, spin: 12 });
        }
    }

    puff(x, y, z, n = 6, color = 0xffffff) {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const m = new THREE.Mesh(GEO.sphere, particleMat(color));
            m.scale.setScalar(0.14);
            m.position.set(x, y + 0.1, z);
            this.add(m, { life: 0.4, vx: Math.cos(a) * 2, vy: 1, vz: Math.sin(a) * 2, g: 0, grow: 1.5 });
        }
    }

    sparkle(x, y, z) {
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const m = new THREE.Mesh(GEO.sphere, particleMat(0xfff27a));
            m.scale.setScalar(0.07);
            m.position.set(x, y, z);
            this.add(m, { life: 0.35, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, vz: 0, g: 0 });
        }
    }

    firework(x, y, z) {
        const colors = [0xff4040, 0xffe040, 0x40ff80, 0x60a0ff, 0xff80ff, 0xffffff];
        const c = colors[Math.floor(Math.random() * colors.length)];
        for (let i = 0; i < 36; i++) {
            const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(1 - u * u);
            const sp = 5 + Math.random() * 2;
            const m = new THREE.Mesh(GEO.sphere, particleMat(i % 3 ? c : 0xffffff));
            m.scale.setScalar(0.12);
            m.position.set(x, y, z);
            this.add(m, { life: 1.3, vx: r * Math.cos(a) * sp, vy: u * sp, vz: r * Math.sin(a) * sp, g: 3 });
        }
    }

    popup(x, y, z, text, color = '#ffffff') {
        const mat = new THREE.SpriteMaterial({ map: textTexture(text, color), transparent: true, depthWrite: false });
        const s = new THREE.Sprite(mat);
        s.scale.set(1.6, 0.4, 1);
        s.position.set(x, y, z);
        s.renderOrder = 5;
        this.add(s, { life: 0.9, vy: 2.2, g: 0 });
        s.userData.sprite = true;
    }

    update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.mesh.removeFromParent();
                if (p.mesh.userData.sprite) p.mesh.material.dispose();
                this.list.splice(i, 1);
                continue;
            }
            p.vy -= p.g * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;
            if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.7 * dt; }
            const k = p.life / p.max;
            if (p.mesh.userData.sprite) {
                p.mesh.material.opacity = Math.min(1, k * 3);
            } else if (p.grow) {
                p.mesh.scale.setScalar(p.s0 * (1 + (1 - k) * p.grow) * Math.min(1, k * 2.5));
            } else if (p.max < 2) {
                p.mesh.scale.setScalar(p.s0 * Math.min(1, k * 2));
            }
        }
    }

    clear() {
        for (const p of this.list) p.mesh.removeFromParent();
        this.list.length = 0;
    }
}
