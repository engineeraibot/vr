import * as THREE from 'three';
import { GEO, MAT } from './models.js';
import { boxesTouch } from './physics.js';

export class Barrel {
    constructor(game, x, y, z, vx = 4, vz = 0) {
        this.game = game;
        this.x = x; this.y = y; this.z = z;
        this.hx = 0.4; this.hz = 0.4; this.h = 0.8;
        this.vx = vx; this.vy = 0; this.vz = vz;
        this.active = true;

        this.mesh = new THREE.Mesh(GEO.cyl, MAT.barrel);
        this.mesh.rotation.z = Math.PI / 2;
        this.mesh.scale.set(0.4, 0.8, 0.4);
        this.mesh.position.set(x, y + 0.4, z);
        game.world.add(this.mesh);
    }

    update(dt) {
        if (!this.active) return;
        this.x += this.vx * dt;
        this.z += this.vz * dt;
        this.vy -= 20 * dt; // gravity
        this.y += this.vy * dt;

        // Bounce on girders / ground
        const ground = this.game.stage.cw.groundBelow(this.x, this.z, this.y + 0.1, 0.3);
        if (this.y <= ground) {
            this.y = ground;
            this.vy = 0;
        }

        // Reverse direction at girder edges
        if (this.x > 14) { this.vx = -Math.abs(this.vx); this.z -= 0.5; }
        if (this.x < -14) { this.vx = Math.abs(this.vx); this.z -= 0.5; }

        this.mesh.position.set(this.x, this.y + 0.4, this.z);
        this.mesh.rotation.x += this.vx * dt;

        // Check collision with player
        const player = this.game.player;
        // Adjust player effective height box depending on crouching/ducking state
        const playerBox = {
            x: player.x, y: player.y, z: player.z,
            hx: player.hx, hz: player.hz,
            h: player.crouching ? 0.8 : player.h
        };
        if (boxesTouch(this, playerBox, 0.1)) {
            if (player.hammerTimer > 0) {
                // Crush barrel with hammer!
                this.active = false;
                this.game.world.remove(this.mesh);
                this.game.sound.play('stomp');
                this.game.score += 300;
                this.game.hud.setScore(this.game.score);
            } else {
                player.hurt();
            }
        }

        // Destroy if falls off bottom
        if (this.y < -5) {
            this.active = false;
            this.game.world.remove(this.mesh);
        }
    }
}

export class Hammer {
    constructor(game, x, y, z) {
        this.game = game;
        this.x = x; this.y = y; this.z = z;
        this.hx = 0.4; this.hz = 0.4; this.h = 0.8;
        this.active = true;

        this.mesh = new THREE.Mesh(GEO.hammer, MAT.vcol);
        this.mesh.position.set(x, y + 0.3, z);
        game.world.add(this.mesh);
    }

    update(dt) {
        if (!this.active) return;
        this.mesh.rotation.y += 2 * dt;
        if (boxesTouch(this, this.game.player)) {
            this.active = false;
            this.game.world.remove(this.mesh);
            this.game.sound.play('item');
            this.game.player.grantHammer();
        }
    }
}
