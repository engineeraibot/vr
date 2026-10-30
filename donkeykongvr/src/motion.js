const LS_KEY = 'dk3d.sensitivity';

export class BodyMotion {
    constructor() {
        this.sensitivity = parseFloat(safeGet(LS_KEY)) || 1;
        this.listening = false;
        this.hasSensor = false;
        this.lastSample = 0;
        this.av = 0;
        this.armed = false;
        this.ff = 0;
        this.gLP = null;
        this.steps = [];
        this.lastStep = -9;
        this.lastJump = -9;
        this.jumpQueued = false;
        this.amount = 0;
        this.level = 0;
        this.stepCount = 0;
        this.jumpCount = 0;
        this.onStep = null;
        this.onJump = null;
        this.isCrouching = false;
        this.head = null;
        this._onMotion = e => this.onMotion(e);
    }

    setSensitivity(v) {
        this.sensitivity = v;
        safeSet(LS_KEY, String(v));
    }

    async enable() {
        if (typeof DeviceMotionEvent === 'undefined') return false;
        if (!this.listening) {
            window.addEventListener('devicemotion', this._onMotion);
            this.listening = true;
        }
        if (this.granted || typeof DeviceMotionEvent.requestPermission !== 'function') return true;
        try {
            this.granted = await DeviceMotionEvent.requestPermission() === 'granted';
        } catch {
            this.granted = false;
        }
        return this.granted;
    }

    get needsPermission() {
        return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'
            && !this.granted && !this.hasSensor;
    }

    onMotion(e) {
        const ai = e.accelerationIncludingGravity;
        if (!ai || ai.x === null || ai.x === undefined) return;
        const now = performance.now() / 1000;
        const dt = Math.min(Math.max(this.lastSample ? now - this.lastSample : 0.016, 0.001), 0.1);
        this.lastSample = now;
        this.lastDeviceMotion = now;
        const mag = Math.hypot(ai.x, ai.y, ai.z);
        const la = e.acceleration;
        let vert;
        if (la && la.x !== null && la.x !== undefined) {
            const gx = ai.x - la.x, gy = ai.y - la.y, gz = ai.z - la.z;
            const gl = Math.hypot(gx, gy, gz) || 1;
            vert = (la.x * gx + la.y * gy + la.z * gz) / gl;
        } else {
            if (!this.gLP) this.gLP = [ai.x, ai.y, ai.z];
            const k = 1 - Math.exp(-dt / 0.5);
            this.gLP[0] += (ai.x - this.gLP[0]) * k;
            this.gLP[1] += (ai.y - this.gLP[1]) * k;
            this.gLP[2] += (ai.z - this.gLP[2]) * k;
            const gl = Math.hypot(...this.gLP) || 1;
            vert = (ai.x * this.gLP[0] + ai.y * this.gLP[1] + ai.z * this.gLP[2]) / gl - gl;
        }
        this.hasSensor = true;
        this.feed(vert, mag, now, dt);
    }

    feed(vert, mag, now, dt) {
        const s = this.sensitivity;
        this.av += (vert - this.av) * (1 - Math.exp(-dt / 0.035));
        this.level = Math.max(this.level * Math.exp(-dt * 3), Math.abs(this.av));

        // Detect crouch/squat from sudden downward acceleration drop / low Z
        if (this.av < -3.5 * s) {
            this.isCrouching = true;
        } else if (this.av > 1.0 * s) {
            this.isCrouching = false;
        }

        // Hop: free fall or strong upward acceleration
        this.ff = mag < 3 ? this.ff + dt : 0;
        if (now - this.lastJump > 0.7 && (this.ff > 0.1 || this.av > 10.0 / s)) this.fireJump(now);

        // Step: vertical bounce
        if (this.av < -0.8 / s) this.armed = true;
        if (this.armed && this.av > 1.3 / s && now - this.lastStep > 0.22 && now - this.lastJump > 0.4) {
            this.armed = false;
            this.fireStep(now);
        }
    }

    fireStep(now) {
        this.lastStep = now;
        this.steps.push(now);
        this.stepCount++;
        if (this.onStep) this.onStep();
    }

    fireJump(now) {
        this.lastJump = now;
        this.jumpQueued = true;
        this.jumpCount++;
        if (this.onJump) this.onJump();
    }

    takeJump() {
        const j = this.jumpQueued;
        this.jumpQueued = false;
        return j;
    }

    update(now, dt) {
        while (this.steps.length && now - this.steps[0] > 2) this.steps.shift();
        let n = 0, first = 0, last = 0;
        for (const t of this.steps) {
            if (now - t > 1.4) continue;
            if (!n) first = t;
            last = t;
            n++;
        }
        let target = 0;
        if (n >= 2 && now - this.lastStep < 0.8) {
            const cadence = (n - 1) / Math.max(last - first, 0.2);
            target = cadence < 1.8 ? 1 : 1 + Math.min(0.8, (cadence - 1.8) * 0.6);
        } else if (now - this.lastJump < 0.6 && this.amount > 0) {
            target = this.amount;
        }
        const rate = target > this.amount ? 8 : 6;
        this.amount += (target - this.amount) * (1 - Math.exp(-rate * dt));
        if (this.amount < 0.02) this.amount = 0;
    }
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
