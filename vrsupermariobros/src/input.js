// Merges every input source into one per-frame state:
// body motion (phone accelerometer / headset pose), the Cardboard button or screen
// (XR "select"), touch, VR controllers, gamepads, keyboard and mouse.

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
const TAP_TIME = 0.25;   // shorter presses are taps (jump)
const HOLD_TIME = 0.3;   // longer, still presses walk forward
const MOUSE_SENS = 0.0025;

const dz = v => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
const pressed = (gp, i) => !!(gp.buttons[i] && gp.buttons[i].pressed);

export class Input {
    constructor(canvas, motion) {
        this.canvas = canvas;
        this.motion = motion;
        this.keys = new Set();
        this.prev = {};
        this.lookDX = 0;
        this.lookDY = 0;
        this.mouseDown = false;
        this.mouseClick = false;
        this.locked = false;
        this.touches = new Map();
        this.tapQueued = false;
        this.select = { down: false, t0: 0 };
        this.jumpHoldUntil = 0;
        this.snapHeld = false;
        this.lastTouchTime = 0;

        window.addEventListener('keydown', e => {
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (GAME_KEYS.has(e.code)) e.preventDefault();
            this.keys.add(e.code);
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === canvas;
        });
        canvas.addEventListener('mousedown', e => {
            if (this.locked) { this.mouseClick = true; return; }
            if (e.button === 0 || e.button === 2) this.mouseDown = true;
        });
        window.addEventListener('mouseup', () => { this.mouseDown = false; });
        window.addEventListener('mousemove', e => {
            if (this.locked || this.mouseDown) {
                this.lookDX += e.movementX * MOUSE_SENS;
                this.lookDY += e.movementY * MOUSE_SENS;
            }
        });
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Touch without a headset: drag to look, tap to jump, hold still to walk.
        const opts = { passive: false };
        canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            const now = performance.now() / 1000;
            this.lastTouchTime = now;
            for (const t of e.changedTouches) this.touches.set(t.identifier, { x: t.clientX, y: t.clientY, t0: now, moved: false });
        }, opts);
        canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            for (const t of e.changedTouches) {
                const s = this.touches.get(t.identifier);
                if (!s) continue;
                const dx = t.clientX - s.x, dy = t.clientY - s.y;
                if (Math.hypot(dx, dy) > 3) s.moved = true;
                if (s.moved) {
                    this.lookDX -= dx * 0.006;
                    this.lookDY -= dy * 0.006;
                }
                s.x = t.clientX;
                s.y = t.clientY;
            }
        }, opts);
        const end = e => {
            const now = performance.now() / 1000;
            for (const t of e.changedTouches) {
                const s = this.touches.get(t.identifier);
                if (s && !s.moved && now - s.t0 < TAP_TIME) this.tapQueued = true;
                this.touches.delete(t.identifier);
            }
        };
        canvas.addEventListener('touchend', end);
        canvas.addEventListener('touchcancel', end);
    }

    // XR "select": the Cardboard button / screen tap, a controller trigger or a hand pinch.
    selectStart() {
        this.select.down = true;
        this.select.t0 = performance.now() / 1000;
    }

    selectEnd() {
        const now = performance.now() / 1000;
        if (this.select.down && now - this.select.t0 < TAP_TIME) this.tapQueued = true;
        this.select.down = false;
    }

    poll(dt, session, now) {
        const k = c => this.keys.has(c);
        let moveF = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
        let moveS = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
        let turn = (k('ArrowRight') || k('KeyE') ? 1 : 0) - (k('ArrowLeft') || k('KeyQ') ? 1 : 0);
        let runAmt = k('ShiftLeft') || k('ShiftRight') ? 1 : 0;
        let jump = k('Space') || k('KeyK');
        let fire = k('KeyF') || this.mouseClick;
        let crouch = k('KeyC') || k('ControlLeft') || k('ControlRight');
        let start = k('Enter');
        let pause = k('KeyP') || k('Escape');
        const mute = k('KeyM');
        let recenter = k('KeyR');
        let lookX = this.lookDX, lookY = this.lookDY;
        this.lookDX = this.lookDY = 0;
        this.mouseClick = false;
        let tap = false;
        let snapRaw = 0;

        for (const s of this.touches.values()) if (!s.moved && now - s.t0 > HOLD_TIME) moveF = Math.max(moveF, 1);
        if (this.select.down && now - this.select.t0 > HOLD_TIME) moveF = Math.max(moveF, 1);
        if (this.tapQueued) { tap = true; this.tapQueued = false; }

        // Regular gamepads (desktop)
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of pads) {
            if (!gp || !gp.connected || gp.mapping !== 'standard') continue;
            moveS += dz(gp.axes[0] || 0);
            moveF -= dz(gp.axes[1] || 0);
            lookX += dz(gp.axes[2] || 0) * 2.6 * dt;
            lookY += dz(gp.axes[3] || 0) * 2.0 * dt;
            if (pressed(gp, 0)) jump = true;
            if (pressed(gp, 1) || pressed(gp, 2) || pressed(gp, 7)) { runAmt = 1; fire = fire || pressed(gp, 2) || pressed(gp, 7); }
            if (pressed(gp, 3) || pressed(gp, 6)) crouch = true;
            if (pressed(gp, 9)) { start = true; pause = true; }
            if (pressed(gp, 12)) moveF = Math.max(moveF, 1);
            if (pressed(gp, 13)) moveF = Math.min(moveF, -1);
            if (pressed(gp, 14)) turn -= 1;
            if (pressed(gp, 15)) turn += 1;
        }

        // VR controllers (Quest etc.). The trigger also sends "select" events.
        if (session) {
            for (const src of session.inputSources) {
                const gp = src.gamepad;
                if (!gp || gp.axes.length < 2) continue;
                const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0];
                const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
                if (src.handedness === 'right') {
                    snapRaw = ax;
                } else {
                    moveS += dz(ax);
                    moveF -= dz(ay);
                }
                if (pressed(gp, 4)) jump = true;
                if (pressed(gp, 5) || pressed(gp, 1)) { runAmt = 1; fire = true; }
                if (pressed(gp, 3)) crouch = true;
            }
        }

        // Body motion
        const amt = this.motion.amount;
        if (amt > 0) {
            moveF = Math.max(moveF, Math.min(1, amt));
            runAmt = Math.max(runAmt, Math.min(1, Math.max(0, (amt - 1) / 0.6)));
        }
        if (this.motion.takeJump()) tap = true;

        // Taps and hops always give a full-height jump.
        if (tap) this.jumpHoldUntil = now + 0.6;
        if (now < this.jumpHoldUntil) jump = true;

        let snap = 0;
        if (Math.abs(snapRaw) > 0.7 && !this.snapHeld) { snap = Math.sign(snapRaw); this.snapHeld = true; }
        if (Math.abs(snapRaw) < 0.3) this.snapHeld = false;

        const p = this.prev;
        const state = {
            moveF: Math.max(-1, Math.min(1, moveF)),
            moveS: Math.max(-1, Math.min(1, moveS)),
            runAmt,
            turn,
            lookX,
            lookY,
            snap,
            jump,
            jumpP: (jump && !p.jump) || tap,
            fire,
            fireP: fire && !p.fire,
            crouch,
            startP: (start && !p.start) || tap,
            pauseP: pause && !p.pause,
            muteP: mute && !p.mute,
            recenterP: recenter && !p.recenter,
            fwdX: 1,
            fwdZ: 0,
        };
        this.prev = { jump, fire, start, pause, mute, recenter };
        return state;
    }
}
