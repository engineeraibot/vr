// First-person Mario: you are the camera. Physics is tuned in tiles (1 tile = 1 metre).
import * as THREE from 'three';
import { moveEntity, makeResult } from './physics.js';
import { MAT, GEO } from './models.js';

export const PHYS = {
    WALK: 4.5,
    RUN: 7.5,
    ACCEL: 18,
    AIR_ACCEL: 10,
    SKID: 30,
    FRICTION: 22,
    AIR_FRICTION: 3,
    JUMP_V: 13.5,
    JUMP_BONUS: 0.12,   // running jumps go higher
    G_HOLD: 22,         // gravity while rising with jump held
    G_FALL: 45,
    MAX_FALL: 22,
    STOMP_LO: 9,
    STOMP_HI: 13,
    COYOTE: 0.12,
    JUMP_BUFFER: 0.15,
};

export class Player {
    constructor(game) {
        this.game = game;
        this.isPlayer = true;
        this.hx = 0.3;
        this.hz = 0.3;
        this.power = 0; // 0 small, 1 super, 2 fire
        this.res = makeResult();
        this.blob = new THREE.Mesh(GEO.blob, MAT.shadow);
        this.blob.renderOrder = 2;
        game.world.add(this.blob);
        this.reset(0, 0, 0);
    }

    get h() { return this.power > 0 ? (this.crouching ? 1.1 : 1.8) : 0.95; }
    get eyeTarget() { return this.power > 0 ? (this.crouching ? 0.9 : 1.6) : 0.8; }

    reset(x, y, z) {
        this.x = x; this.y = y; this.z = z;
        this.vx = this.vy = this.vz = 0;
        this.prevY = y;
        this.onGround = false;
        this.groundSolid = null;
        this.coyote = 0;
        this.jumpBuf = 0;
        this.jumping = false;
        this.inv = 0;
        this.star = 0;
        this.state = 'normal';
        this.crouching = false;
        this.stompChain = 0;
        this.wishX = this.wishZ = 0;
        this.eye = this.eyeTarget;
        this.launched = false;
    }

    step(dt, inp) {
        const P = PHYS;
        this.prevY = this.y;

        // Wish direction: forward is where you look, right is perpendicular to it.
        const fx = inp.fwdX, fz = inp.fwdZ;
        const rx = -fz, rz = fx;
        let wx = fx * inp.moveF + rx * inp.moveS;
        let wz = fz * inp.moveF + rz * inp.moveS;
        let wl = Math.hypot(wx, wz);
        if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
        this.crouching = this.power > 0 && inp.crouch && this.onGround;
        if (this.crouching) { wx = wz = 0; wl = 0; }
        this.wishX = wx;
        this.wishZ = wz;

        const maxSp = P.WALK + (P.RUN - P.WALK) * inp.runAmt;
        const sp = Math.hypot(this.vx, this.vz);
        if (wl > 0.01) {
            const dot = this.vx * wx + this.vz * wz;
            const acc = this.onGround ? (dot < 0 ? P.SKID : P.ACCEL) : P.AIR_ACCEL;
            let dvx = wx * maxSp - this.vx;
            let dvz = wz * maxSp - this.vz;
            const dl = Math.hypot(dvx, dvz);
            const md = acc * dt;
            if (dl > md) { dvx *= md / dl; dvz *= md / dl; }
            this.vx += dvx;
            this.vz += dvz;
        } else {
            const dec = (this.onGround ? P.FRICTION : P.AIR_FRICTION) * dt;
            if (sp <= dec) { this.vx = this.vz = 0; } else { this.vx -= this.vx / sp * dec; this.vz -= this.vz / sp * dec; }
        }

        if (inp.jumpP) this.jumpBuf = P.JUMP_BUFFER;
        if (this.jumpBuf > 0 && (this.onGround || this.coyote > 0)) {
            this.vy = P.JUMP_V + Math.min(sp, P.RUN) * P.JUMP_BONUS;
            this.jumping = true;
            this.onGround = false;
            this.coyote = 0;
            this.jumpBuf = 0;
            this.game.sound.play(this.power ? 'jumpBig' : 'jump');
        }
        this.jumpBuf -= dt;
        this.coyote -= dt;

        const hold = this.jumping && this.vy > 0 && inp.jump;
        this.vy = Math.max(this.vy - (hold ? P.G_HOLD : P.G_FALL) * dt, -P.MAX_FALL);

        const wasGround = this.onGround;
        const r = moveEntity(this.game.level.cw, this, this.vx * dt, this.vy * dt, this.vz * dt, this.res);
        if (r.hitX) this.vx = 0;
        if (r.hitZ) this.vz = 0;
        if (r.ground) {
            if (!wasGround && this.vy < -12) this.game.fx.puff(this.x, this.y, this.z, 4);
            this.onGround = true;
            this.groundSolid = r.groundSolid;
            this.vy = 0;
            this.jumping = false;
            this.stompChain = 0;
            this.coyote = P.COYOTE;
        } else {
            this.onGround = false;
            this.groundSolid = null;
        }
        if (r.ceil) {
            this.vy = Math.min(0, this.vy);
            this.jumping = false;
            this.game.headBump(r.ceilHits);
        }
    }

    bounce(high) {
        this.vy = high ? PHYS.STOMP_HI : PHYS.STOMP_LO;
        this.jumping = true;
        this.onGround = false;
    }

    hurt() {
        if (this.inv > 0 || this.star > 0 || this.state !== 'normal') return;
        if (this.power > 0) {
            this.power = 0;
            this.inv = 2.5;
            this.game.sound.play('hurt');
            this.game.flash(0xff2020, 0.55);
        } else {
            this.game.killPlayer(false);
        }
    }

    // Per-frame visuals: eye height easing and the blob shadow under your feet.
    updateVisual(dt) {
        this.eye += (this.eyeTarget - this.eye) * (1 - Math.exp(-8 * dt));
        const g = this.state === 'normal' || this.state === 'pole' || this.state === 'auto'
            ? this.game.level.cw.groundBelow(this.x, this.z, this.y + 0.05, 0.15) : -Infinity;
        const dist = this.y - g;
        if (Number.isFinite(g) && dist < 25) {
            this.blob.visible = true;
            this.blob.position.set(this.x, g + 0.02, this.z);
            const s = THREE.MathUtils.clamp(1 - dist / 14, 0.35, 1);
            this.blob.scale.setScalar(s);
        } else {
            this.blob.visible = false;
        }
    }
}
