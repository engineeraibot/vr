import * as THREE from 'three';

export class Input {
    constructor(game) {
        this.game = game;
        this.keys = {};
        this.moveF = 0;
        this.moveS = 0;
        this.fwdX = 0;
        this.fwdZ = -1;
        this.jumpP = false;
        this.jump = false;
        this.crouch = false;
        this.climbUp = false;
        this.climbDown = false;
        this.yaw = 0;
        this.pitch = 0;
        this.mouseCaptured = false;
        this.touching = false;
        this.touchFwd = false;

        window.addEventListener('keydown', e => {
            if (e.code === 'KeyP') this.game.togglePause();
            if (e.code === 'KeyM') this.game.toggleMute();
            if (e.code === 'KeyR') this.game.recenterVR();
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', e => {
            this.keys[e.code] = false;
        });

        window.addEventListener('mousedown', () => {
            if (!this.game.xrSession && !this.game.phoneHead.listening) {
                document.body.requestPointerLock?.();
            }
        });

        window.addEventListener('mousemove', e => {
            if (document.pointerLockElement === document.body) {
                this.yaw -= e.movementX * 0.0022;
                this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -Math.PI / 2.2, Math.PI / 2.2);
            }
        });

        window.addEventListener('touchstart', () => {
            this.touching = true;
            this.touchFwd = true;
        });
        window.addEventListener('touchend', () => {
            this.touching = false;
            this.touchFwd = false;
        });
    }

    update(dt) {
        // Keyboard inputs
        const k = this.keys;
        let kF = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
        let kS = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);

        if (this.touchFwd) kF = 1;

        // Motion step amount
        const motionAmt = this.game.motion.amount;

        this.moveF = Math.max(kF, motionAmt);
        this.moveS = kS;

        this.jump = k['Space'] || this.touching || this.game.motion.jumpQueued;
        this.jumpP = k['Space'] || this.game.motion.takeJump();

        this.crouch = k['KeyC'] || k['ControlLeft'] || this.game.motion.isCrouching;

        // Pitch look angle for climbing (looking up at ladders)
        this.climbUp = k['KeyW'] || k['ArrowUp'] || (this.pitch > 0.25) || (this.game.headPitch > 0.25);
        this.climbDown = k['KeyS'] || k['ArrowDown'] || (this.pitch < -0.3) || (this.game.headPitch < -0.3);

        // Update forward vector from yaw
        this.fwdX = -Math.sin(this.yaw);
        this.fwdZ = -Math.cos(this.yaw);
    }
}
