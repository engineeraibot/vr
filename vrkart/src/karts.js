// Kart physics (arcade) for the player and simple racing-line AI for the CPU drivers.
import * as THREE from 'three';
import { buildKart } from './models.js';
import { HALF_WIDTH, KERB, RAMP_H, GAP } from './track.js';

export const KART = {
    MAX: 22,          // m/s on the road (~80 km/h)
    OFFROAD: 11,      // grass
    BOOST: 32,        // dash panel
    BOOST_TIME: 1.4,
    ACCEL: 9,
    DRAG: 7,
    BRAKE: 13,
    TURN: 1.7,        // rad/s at full lock
    GRAVITY: 14,      // floaty, like the N64
    RADIUS: 0.85,
};

const clamp = THREE.MathUtils.clamp;

export function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

class Kart {
    constructor(game, ch, opts) {
        this.game = game;
        this.track = game.track;
        this.ch = ch;
        this.name = ch.name;
        this.model = buildKart(ch, opts);
        game.scene.add(this.model.root);
        this.q = {};
        this.place(0, 0);
    }

    place(s, lat) {
        const T = this.track;
        const p = T.sampleAt(s, this.q);
        this.x = p.x + p.rx * lat;
        this.z = p.z + p.rz * lat;
        this.s = T.wrap(s);
        this.lat = lat;
        this.y = T.heightAt(s);
        this.vy = 0;
        this.onGround = true;
        this.heading = Math.atan2(-p.tx, -p.tz);
        this.speed = 0;
        this.boostT = 0;
        this.hint = -1;
        this.prevS = this.s;
        this.pitch = 0;
        this.steerVis = 0;
    }

    resetRace(s, lat) {
        this.place(s, lat);
        this.lap = 0;
        this.finished = false;
        this.finishTime = 0;
        this.lapTimes = [];
    }

    get progress() { return this.lap * this.track.L + this.s; }

    slopeAhead() {
        const T = this.track;
        return (T.heightAt(this.s + 1) - T.heightAt(this.s - 1)) / 2;
    }

    sync(dt, t) {
        const target = this.onGround ? Math.atan(this.slopeAhead()) : clamp(this.vy / Math.max(this.speed, 5), -0.5, 0.5);
        this.pitch += (target - this.pitch) * (1 - Math.exp(-dt * 8));
        const r = this.model.root;
        r.position.set(this.x, this.y, this.z);
        r.rotation.set(this.pitch, this.heading, 0, 'YXZ');
        this.model.body.position.y = this.onGround ? Math.sin(t * 30 + this.x) * 0.01 * Math.min(1, this.speed / 10) : 0;
        this.model.body.rotation.z = -this.steerVis * 0.05;
        const fl = this.model.flames;
        fl.visible = this.boostT > 0;
        if (fl.visible) fl.scale.setScalar(0.8 + Math.random() * 0.5);
    }
}

export class PlayerKart extends Kart {
    // ctl = { throttle 0..1, steer -1..1 (+ = right), brake }
    step(dt, ctl, ev) {
        const T = this.track, K = KART, q = this.q;
        const offroad = this.onGround && !this.raised && Math.abs(this.lat) > HALF_WIDTH + KERB;
        const maxSp = this.boostT > 0 ? K.BOOST : offroad ? K.OFFROAD : K.MAX;
        if (this.onGround) {
            const target = maxSp * ctl.throttle;
            if (ctl.throttle > 0.05 && this.speed < target) {
                this.speed = Math.min(target, this.speed + K.ACCEL * (this.boostT > 0 ? 4 : 1) * dt);
            } else if (ctl.throttle > 0.05) {
                this.speed = Math.max(target, this.speed - (offroad ? 20 : K.DRAG) * dt);
            } else {
                this.speed = Math.max(0, this.speed - (offroad ? 20 : K.BRAKE) * dt);
            }
            if (ctl.brake) this.speed = Math.max(0, this.speed - 18 * dt);
        }
        const grip = this.onGround ? 1 : 0.35;
        const turn = K.TURN * Math.min(1, this.speed / 5) * (1 - 0.3 * Math.min(1, this.speed / K.BOOST));
        this.heading -= ctl.steer * turn * grip * dt;
        this.steerVis = ctl.steer;
        this.x += -Math.sin(this.heading) * this.speed * dt;
        this.z += -Math.cos(this.heading) * this.speed * dt;

        T.query(this.x, this.z, this.hint, q);
        this.hint = q.i;
        const high = !q.gap && q.y > 0.3;
        const setLat = lat => {
            this.x += q.rx * (lat - q.lat);
            this.z += q.rz * (lat - q.lat);
            q.lat = lat;
        };
        if (high) {
            if (this.y > q.y - 0.8) {
                // On a ramp: the parapet walls keep you on it.
                const lim = HALF_WIDTH - 0.9;
                if (Math.abs(q.lat) > lim) {
                    setLat(Math.sign(q.lat) * lim);
                    this.speed *= 1 - 1.2 * dt;
                    ev.scrape = true;
                }
            } else if (Math.abs(q.lat) < HALF_WIDTH + 1.2) {
                // Below a ramp's edge: its side is a solid wall.
                setLat(Math.sign(q.lat || 1) * (HALF_WIDTH + 1.2));
                this.speed *= 0.5;
                ev.bump = true;
            }
        }
        if (Math.abs(q.lat) > 60) setLat(Math.sign(q.lat) * 60);
        this.lat = q.lat;
        this.raised = high && this.y > q.y - 0.8;

        const inLake = T.inLake(this.x, this.z);
        let groundY = 0;
        if (!q.gap && Math.abs(q.lat) <= HALF_WIDTH + 0.5 && (q.y <= 0.3 || this.raised)) groundY = q.y;
        else if (inLake) groundY = -2.5;

        if (this.onGround) {
            if (groundY >= this.y - 0.6) {
                this.vy = clamp((groundY - this.y) / dt, -15, 15);
                this.y = groundY;
            } else {
                this.onGround = false; // launched off the lip (keeps the ramp's vertical speed)
            }
        } else {
            this.vy -= K.GRAVITY * dt;
            this.y += this.vy * dt;
            if (this.y <= groundY) {
                if (this.vy < -7) ev.land = true;
                this.y = groundY;
                this.vy = 0;
                this.onGround = true;
            }
        }
        if (inLake && this.y < -0.4) ev.splash = true;

        if (this.onGround && T.padAt(q.s, q.lat)) {
            if (this.boostT < K.BOOST_TIME - 0.3) ev.boost = true;
            this.boostT = K.BOOST_TIME;
            this.speed = Math.max(this.speed, 29);
        }
        this.boostT = Math.max(0, this.boostT - dt);

        const s = q.s;
        if (this.prevS > T.L * 0.75 && s < T.L * 0.25) { this.lap++; ev.lap = true; }
        else if (this.prevS < T.L * 0.25 && s > T.L * 0.75) this.lap--;
        this.prevS = s;
        this.s = s;
        this.wrongWay = this.speed > 3 && (-Math.sin(this.heading) * q.tx - Math.cos(this.heading) * q.tz) < -0.3;
    }

    // Simple autopilot (after the finish line and in the attract mode).
    autopilot() {
        const T = this.track, p = T.sampleAt(this.s + 14, {});
        const dx = p.x - this.x, dz = p.z - this.z;
        const desired = Math.atan2(-dx, -dz);
        return { throttle: 0.85, steer: clamp(wrapAngle(this.heading - desired) * 2.5, -1, 1), brake: false };
    }
}

export class CpuKart extends Kart {
    constructor(game, ch, skill) {
        super(game, ch);
        this.skill = skill;
        this.laneT = 0;
        this.laneTarget = 0;
        this.likesPads = Math.random() < 0.7;
    }

    step(dt, leaderProgress) {
        const T = this.track, K = KART;
        let target = K.MAX * this.skill;
        // Rubber band: catch up when far behind the player, ease off when far ahead.
        target *= clamp(1 + (leaderProgress - this.progress) * 0.0012, 0.86, 1.14);
        if (this.boostT > 0) target = K.BOOST * 0.97;
        this.speed += clamp(target - this.speed, -10 * dt, 8 * dt);
        this.s += this.speed * dt;
        if (this.s >= T.L) { this.s -= T.L; this.lap++; }

        this.laneT -= dt;
        let aimPad = null;
        if (this.likesPads) {
            for (const p of T.pads) {
                const d = T.delta(this.s, p.s);
                if (d > 0 && d < 60) aimPad = p;
            }
        }
        if (aimPad) this.laneTarget = aimPad.lat;
        else if (this.laneT <= 0) {
            this.laneTarget = (Math.random() * 2 - 1) * 5;
            this.laneT = 3 + Math.random() * 4;
        }
        const prevLat = this.lat;
        this.lat += clamp(this.laneTarget - this.lat, -2.5 * dt, 2.5 * dt);
        if (T.heightAt(this.s) > 0.3) this.lat = clamp(this.lat, -5.5, 5.5);

        // Fly over the lake on an arc instead of simulating the jump.
        const past = T.delta(T.lip, this.s), landAt = GAP + 10;
        if (past > 0 && past < landAt) {
            const k = past / landAt;
            this.y = (1 - k) * RAMP_H + k * T.heightAt(T.lip + landAt) + 9 * k * (1 - k);
            this.onGround = false;
            this.vy = (1 - 2 * k) * 6;
        } else {
            this.y = T.heightAt(this.s);
            this.onGround = true;
        }
        if (T.padAt(this.s, this.lat)) this.boostT = K.BOOST_TIME;
        this.boostT = Math.max(0, this.boostT - dt);

        const p = T.sampleAt(this.s, this.q);
        this.x = p.x + p.rx * this.lat;
        this.z = p.z + p.rz * this.lat;
        const latRate = (this.lat - prevLat) / Math.max(dt, 1e-4);
        this.steerVis = clamp(latRate / 3, -1, 1);
        this.heading = Math.atan2(-p.tx, -p.tz) - Math.atan2(latRate, Math.max(this.speed, 1));
    }
}
