// Body-motion controls: walk in place to walk, jog to run, hop to jump.
//
// Phones (Cardboard-style VR): the accelerometer (DeviceMotionEvent) is projected onto
// gravity to get vertical acceleration. Steps are vertical bounces; a hop is either a
// strong push-off spike or a short moment of free fall.
// Headsets with positional tracking (e.g. Quest) and no accelerometer events: the
// head height from the WebXR pose is used instead.

const LS_KEY = 'smb3d.sensitivity';

export class BodyMotion {
    constructor() {
        this.sensitivity = parseFloat(safeGet(LS_KEY)) || 1;
        this.listening = false;
        this.hasSensor = false;
        this.lastSample = 0;
        this.av = 0;            // smoothed vertical acceleration (m/s^2, + = up)
        this.armed = false;
        this.ff = 0;            // time spent in free fall
        this.gLP = null;
        this.steps = [];
        this.lastStep = -9;
        this.lastJump = -9;
        this.jumpQueued = false;
        this.amount = 0;        // 0 = standing, 1 = walking, up to 1.7 = running
        this.level = 0;         // activity meter for the UI
        this.stepCount = 0;
        this.jumpCount = 0;
        this.onStep = null;
        this.onJump = null;
        this.head = null;
        this._onMotion = e => this.onMotion(e);
    }

    setSensitivity(v) {
        this.sensitivity = v;
        safeSet(LS_KEY, String(v));
    }

    // Browsers with DeviceMotionEvent.requestPermission (iOS, newer Chrome) only grant it
    // from a tap or click, so this is called again on every tap until it succeeds.
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
        const mag = Math.hypot(ai.x, ai.y, ai.z);
        const la = e.acceleration;
        let vert;
        if (la && la.x !== null && la.x !== undefined) {
            // Gravity = (with gravity) - (linear); project the linear part onto it.
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

        // Hop: both feet leave the ground (free fall) or a strong push-off.
        this.ff = mag < 3 ? this.ff + dt : 0;
        if (now - this.lastJump > 0.8 && (this.ff > 0.1 || this.av > 10.5 / s)) this.fireJump(now);

        // Step: a vertical bounce above the threshold (with hysteresis).
        if (this.av < -0.8 / s) this.armed = true;
        if (this.armed && this.av > 1.3 / s && now - this.lastStep > 0.24 && now - this.lastJump > 0.45) {
            this.armed = false;
            this.fireStep(now);
        }
    }

    // Head height (metres) from the XR viewer pose, used while the accelerometer is silent.
    feedHead(y, now, dt) {
        if ((this.hasSensor && now - this.lastSample < 1) || dt <= 0) return;
        const h = this.head || (this.head = { s: y, base: y, prev: y, armed: false });
        h.s += (y - h.s) * (1 - Math.exp(-dt / 0.04));
        const vy = (h.s - h.prev) / dt;
        h.prev = h.s;
        h.base += (h.s - h.base) * (1 - Math.exp(-dt / 1.2));
        const d = h.s - h.base;
        const s = this.sensitivity;
        this.level = Math.max(this.level * Math.exp(-dt * 3), Math.abs(vy) * 6);
        if (now - this.lastJump > 0.8 && d > 0.07 / s && vy > 0.6 / s) this.fireJump(now);
        if (d < -0.006 / s) h.armed = true;
        if (h.armed && d > 0.01 / s && now - this.lastStep > 0.24 && now - this.lastJump > 0.5) {
            h.armed = false;
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

    // Turn the recent step cadence into a movement amount.
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
        // Two steps are needed before moving, so a single nod or bump does nothing.
        if (n >= 2 && now - this.lastStep < 0.8) {
            const cadence = (n - 1) / Math.max(last - first, 0.2);
            target = cadence < 1.8 ? 1 : 1 + Math.min(0.7, (cadence - 1.8) * 0.5);
        } else if (now - this.lastJump < 0.6 && this.amount > 0) {
            target = this.amount; // keep momentum through a hop
        }
        const rate = target > this.amount ? 8 : 6;
        this.amount += (target - this.amount) * (1 - Math.exp(-rate * dt));
        if (this.amount < 0.02) this.amount = 0;
    }
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
