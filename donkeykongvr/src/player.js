import * as THREE from 'three';
import { moveEntity, makeResult } from './physics.js';
import { GEO, MAT } from './models.js';

export class Player {
    constructor(game) {
        this.game = game;
        this.hx = 0.3;
        this.hz = 0.3;
        this.res = makeResult();
        this.blob = new THREE.Mesh(GEO.blob, MAT.shadow);
        this.blob.renderOrder = 2;
        game.world.add(this.blob);
        this.reset(0, 0, 0);
    }

    get h() { return this.crouching ? 0.9 : 1.7; }
    get eyeTarget() { return this.crouching ? 0.7 : 1.5; }

    reset(x, y, z) {
        this.x = x; this.y = y; this.z = z;
        this.vx = this.vy = this.vz = 0;
        this.onGround = false;
        this.climbing = false;
        this.inCannon = false;
        this.crouching = false;
        this.eye = this.eyeTarget;
        this.hammerTimer = 0;
    }

    grantHammer() {
        this.hammerTimer = 8; // 8 seconds of barrel crushing power!
    }

    step(dt, inp) {
        if (this.hammerTimer > 0) this.hammerTimer -= dt;

        // Check barrel cannon targeting & launching
        this.checkCannonLaunch(inp);

        if (this.inCannon) return;

        // Check ladder / vine proximity and climbing
        this.checkLadderClimbing(dt, inp);

        if (this.climbing) return;

        // Normal locomotion & hopping
        // Forward is where you look (inp.fwdX, inp.fwdZ), right is perpendicular to it (-fz, fx)
        const fx = inp.fwdX, fz = inp.fwdZ;
        const rx = -fz, rz = fx;
        let wx = fx * inp.moveF + rx * inp.moveS;
        let wz = fz * inp.moveF + rz * inp.moveS;

        this.crouching = inp.crouch;
        if (this.crouching) { wx = wz = 0; }

        const maxSp = 5.0;
        this.vx = wx * maxSp;
        this.vz = wz * maxSp;

        // Physical Hop Jumping
        if (inp.jumpP && this.onGround) {
            this.vy = 11.0;
            this.onGround = false;
            this.game.sound.play('jump');
        }

        // Gravity
        this.vy -= 28.0 * dt;

        const r = moveEntity(this.game.stage.cw, this, this.vx * dt, this.vy * dt, this.vz * dt, this.res);
        if (r.ground) {
            this.onGround = true;
            this.vy = 0;
        } else {
            this.onGround = false;
        }

        // Win condition: reaching Pauline at peak (y > 21)
        if (this.y >= 21) {
            this.game.winStage();
        }
    }

    checkLadderClimbing(dt, inp) {
        let nearLadder = null;
        for (const l of this.game.stage.ladders) {
            if (Math.hypot(this.x - l.x, this.z - l.z) < 1.2 && this.y >= l.minY - 0.5 && this.y <= l.maxY + 0.5) {
                nearLadder = l;
                break;
            }
        }

        if (nearLadder && (inp.climbUp || inp.climbDown)) {
            this.climbing = true;
            this.vy = 0;
            const climbSpeed = 3.5 * Math.max(1, Math.abs(inp.moveF));
            if (inp.climbUp) {
                this.y += climbSpeed * dt;
                this.game.sound.play('climb');
            } else if (inp.climbDown) {
                this.y -= climbSpeed * dt;
            }
            this.y = THREE.MathUtils.clamp(this.y, nearLadder.minY, nearLadder.maxY + 0.2);
        } else {
            this.climbing = false;
        }
    }

    checkCannonLaunch(inp) {
        let targetCannon = null;
        const camDir = this.game.gaze || new THREE.Vector3(0, 0, -1);
        const camPos = new THREE.Vector3(this.x, this.y + this.eye, this.z);

        for (const c of this.game.stage.cannons) {
            const toCannon = new THREE.Vector3(c.x - camPos.x, c.y - camPos.y, c.z - camPos.z);
            const dist = toCannon.length();
            if (dist < 12) {
                toCannon.normalize();
                const dot = camDir.dot(toCannon);
                if (dot > 0.95) { // Gaze target locked onto cannon!
                    targetCannon = c;
                    break;
                }
            }
        }

        if (targetCannon) {
            this.game.hud.setCrosshairTarget(true);
            if (inp.jumpP) {
                // Blast player from cannon!
                this.game.sound.play('cannon');
                this.x = targetCannon.target.x;
                this.y = targetCannon.target.y;
                this.z = targetCannon.target.z;
                this.vy = 5;
            }
        } else {
            this.game.hud.setCrosshairTarget(false);
        }
    }

    hurt() {
        this.game.sound.play('hurt');
        this.game.killPlayer();
    }

    updateVisual(dt) {
        this.eye += (this.eyeTarget - this.eye) * (1 - Math.exp(-8 * dt));
        const g = this.game.stage.cw.groundBelow(this.x, this.z, this.y + 0.05, 0.15);
        if (Number.isFinite(g) && this.y - g < 20) {
            this.blob.visible = true;
            this.blob.position.set(this.x, g + 0.02, this.z);
        } else {
            this.blob.visible = false;
        }
    }
}
