import * as THREE from 'three';
import { initTextures } from './textures.js';
import { initModels, MAT, GEO } from './models.js';
import { Stage } from './stage.js';
import { Player } from './player.js';
import { Barrel, Hammer } from './entities.js';
import { BodyMotion } from './motion.js';
import { PhoneHead, StereoView } from './cardboard.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { HUD } from './hud.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const clamp = THREE.MathUtils.clamp;

class Game {
    constructor() {
        this.score = 0;
        this.bonus = 5000;
        this.lives = 3;
        this.state = 'title'; // 'title', 'play', 'dead', 'win', 'paused'

        this.isTouch = matchMedia('(pointer: coarse)').matches;
        this.isPhone = this.isTouch && !/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

        this.initThree();
        initTextures();
        initModels();

        this.stage = new Stage(this);
        this.world.add(this.stage.meshGroup);

        this.motion = new BodyMotion();
        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(this.renderer);
        this.input = new Input(this.renderer.domElement, this.motion);
        this.sound = new Sound();
        this.hud = new HUD(this);
        this.player = new Player(this);

        this.barrels = [];
        this.items = [];
        this.barrelTimer = 0;
        this.headPitch = 0;
        this.gameTime = 0;
        this.clock = new THREE.Clock();

        this.yaw = 0;
        this.pitch = 0;
        this.rigYaw = 0;
        this.headPos = new THREE.Vector3(0, 1.6, 0);
        this.headQuat = new THREE.Quaternion();
        this.headBase = new THREE.Vector3(0, 1.6, 0);
        this.hasHead = false;
        this.needRecenter = true;
        this.gaze = new THREE.Vector3(0, 0, -1);
        this.fwd = new THREE.Vector3(0, 0, -1);
        this.lookPitch = 0;

        this.setupUI();
        this.spawnHammer();

        this.renderer.setAnimationLoop((t, frame) => this.frame(frame));
        window.game = this;
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0512);
        this.scene.fog = new THREE.FogExp2(0x0a0512, 0.015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);
        this.rig = new THREE.Group();
        this.rig.add(this.camera);
        this.scene.add(this.rig);

        this.world = new THREE.Group();
        this.scene.add(this.world);

        const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambLight);

        const dirLight = new THREE.DirectionalLight(0xffdfb0, 1.2);
        dirLight.position.set(10, 30, 20);
        this.scene.add(dirLight);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.xr.enabled = true;
        document.body.appendChild(this.renderer.domElement);
    }

    setupUI() {
        const $ = id => document.getElementById(id);
        const vrBtn = $('enterVR');
        const xrBtn = $('webxr');
        const status = $('vrStatus');
        const setStatus = t => { if (status) status.textContent = t; };
        const startXR = () => this.enterVR().catch(err => setStatus('Could not start WebXR: ' + err.message));
        const xrCheck = navigator.xr && navigator.xr.isSessionSupported
            ? navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
            : Promise.resolve(false);

        if (this.isPhone) {
            if (vrBtn) vrBtn.onclick = () => this.enterPhoneVR();
            xrCheck.then(ok => { if (xrBtn) xrBtn.hidden = !ok; });
            if (xrBtn) xrBtn.onclick = startXR;
            if (!window.isSecureContext) setStatus('Motion sensors need https context.');
        } else {
            if (vrBtn) vrBtn.onclick = startXR;
            xrCheck.then(ok => {
                if (vrBtn) {
                    vrBtn.disabled = !ok;
                    if (!ok) {
                        setStatus(window.isSecureContext
                            ? 'VR is not available in this browser. Open on phone or VR headset.'
                            : 'VR needs https context.');
                    }
                }
            });
        }

        if ($('play')) $('play').onclick = () => this.playFlat();

        const viewer = $('viewer');
        if (viewer) {
            viewer.value = this.stereo.viewerId;
            viewer.onchange = () => this.stereo.setViewer(viewer.value);
        }

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });

        const sens = $('sens');
        if (sens) {
            sens.value = String(this.motion.sensitivity);
            if (sens.value === '') sens.value = '1';
            sens.onchange = () => this.motion.setSensitivity(parseFloat(sens.value));
        }

        const enableBtn = $('enableMotion');
        if (enableBtn) {
            enableBtn.hidden = !this.motion.needsPermission;
            const refresh = () => { enableBtn.hidden = !this.motion.needsPermission; };
            enableBtn.onclick = () => this.enableSensors().then(refresh);
            this.enableSensors().then(refresh);
            $('title')?.addEventListener('pointerdown', () => this.enableSensors().then(refresh));
            setInterval(() => { if (this.state === 'title') refresh(); }, 1000);
        }

        this.motion.onStep = () => { this.hud.stepFlash = 0.2; };
        this.motion.onJump = () => { this.hud.jumpFlash = 0.45; };
        this.titleUI = { meter: $('meterBar'), steps: $('stepCount'), jumps: $('jumpCount'), status: $('motionStatus') };

        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', () => { if (this.isPhone) this.enableSensors(); });
        canvas.addEventListener('click', () => {
            if (this.state === 'paused') this.togglePause(false);
            if (!this.renderer.xr.isPresenting && !this.isTouch && this.state !== 'title') this.lockPointer();
        });
        canvas.addEventListener('touchend', () => { if (this.state === 'paused' && !this.renderer.xr.isPresenting) this.togglePause(false); });
        this.wasLocked = false;
        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === canvas;
            if (!locked && this.wasLocked && this.state === 'play') this.togglePause(true);
            this.wasLocked = locked;
        });

        window.addEventListener('resize', () => this.onResize());
    }

    enableSensors() {
        return Promise.all([this.motion.enable(), this.phoneHead.enable()]);
    }

    lockPointer() {
        const p = this.renderer.domElement.requestPointerLock && this.renderer.domElement.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
    }

    playFlat() {
        this.sound.unlock();
        this.enableSensors();
        this.hud.showTitle(false);
        this.startGame();
        if (!this.isTouch) this.lockPointer();
    }

    get inVR() {
        return this.renderer.xr.isPresenting || this.stereo.active;
    }

    enterPhoneVR() {
        this.sound.unlock();
        this.enableSensors();
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        this.keepAwake();
        this.stereo.active = true;
        this.hud.showTitle(false);
        this.needRecenter = true;
        if (this.state === 'title' || this.state === 'dead' || this.state === 'win') this.startGame();
        else if (this.state === 'paused') this.togglePause(false);
    }

    exitPhoneVR() {
        this.stereo.active = false;
        this.hasHead = false;
        this.needRecenter = true;
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.identity();
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.onResize();
        this.togglePause(true);
    }

    keepAwake() {
        if (!navigator.wakeLock || (this.wakeLock && !this.wakeLock.released)) return;
        navigator.wakeLock.request('screen').then(l => { this.wakeLock = l; }).catch(() => {});
    }

    async enterVR() {
        this.sound.unlock();
        this.enableSensors();
        this.motion.startSensorApi();
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
        });
        let type = 'local-floor';
        try { await session.requestReferenceSpace('local-floor'); } catch { type = 'local'; }
        this.renderer.xr.setReferenceSpaceType(type);
        await this.renderer.xr.setSession(session);
        session.addEventListener('selectstart', () => this.input.selectStart());
        session.addEventListener('selectend', () => this.input.selectEnd());
        session.addEventListener('end', () => {
            this.hasHead = false;
            this.needRecenter = true;
            this.camera.position.set(0, 0, 0);
            this.camera.quaternion.identity();
            this.onResize();
            this.togglePause(true);
        });
        this.hud.showTitle(false);
        this.needRecenter = true;
        if (this.state === 'title' || this.state === 'dead' || this.state === 'win') this.startGame();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        if (!this.renderer.xr.isPresenting) this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    spawnHammer() {
        this.items.push(new Hammer(this, 12, 6.6, -6));
    }

    startGame() {
        this.score = 0;
        this.bonus = 5000;
        this.lives = 3;
        this.hud.setScore(this.score);
        this.hud.setBonus(this.bonus);
        this.hud.setLives(this.lives);
        this.hud.showTitle(false);
        this.restartStage();
    }

    restartStage() {
        this.barrels.forEach(b => this.world.remove(b.mesh));
        this.barrels = [];
        this.player.reset(0, 0.5, 0);
        this.yaw = 0;
        this.pitch = 0;
        this.needRecenter = true;
        this.state = 'play';
        this.sound.music('theme');
    }

    killPlayer() {
        if (this.state !== 'play') return;
        this.lives--;
        this.hud.setLives(this.lives);
        if (this.lives <= 0) {
            this.hud.showMessage('GAME OVER', 'Tap screen or press Space to restart');
            this.state = 'title';
            setTimeout(() => this.hud.showTitle(true), 2500);
        } else {
            this.hud.showMessage('MISSED!', 'Get ready...');
            this.state = 'dead';
            setTimeout(() => {
                this.hud.showMessage('');
                this.restartStage();
            }, 1800);
        }
    }

    winStage() {
        if (this.state !== 'play') return;
        this.state = 'win';
        this.score += this.bonus;
        this.hud.setScore(this.score);
        this.sound.play('win');
        this.hud.showMessage('VICTORY!', 'You saved Pauline!');
        setTimeout(() => {
            this.hud.showMessage('');
            this.restartStage();
        }, 3000);
    }

    togglePause(on) {
        if (on === undefined) on = this.state !== 'paused';
        if (on && this.state === 'play') {
            this.state = 'paused';
            this.hud.showMessage('PAUSED', this.renderer.xr.isPresenting ? '' : this.isTouch ? 'Tap to resume' : 'Click or press P to resume');
        } else if (!on && this.state === 'paused') {
            this.state = 'play';
            this.hud.showMessage('');
        }
    }

    toggleMute() { this.sound.toggleMute(); }
    recenterVR() { this.needRecenter = true; }

    frame(xrFrame) {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.gameTime += dt;
        const xr = this.renderer.xr.isPresenting;
        const phoneVR = this.stereo.active && !xr;
        const vr = xr || phoneVR;
        const now = performance.now() / 1000;

        if (xr && xrFrame) {
            const ref = this.renderer.xr.getReferenceSpace();
            const pose = ref && xrFrame.getViewerPose(ref);
            if (pose) {
                const { position: p, orientation: o } = pose.transform;
                this.headPos.set(p.x, p.y, p.z);
                this.headQuat.set(o.x, o.y, o.z, o.w);
                this.hasHead = true;
                if (!pose.emulatedPosition) this.motion.feedHead(p.y, now, dt);
            }
        } else if (phoneVR && this.phoneHead.update()) {
            this.headQuat.copy(this.phoneHead.quat);
            this.headPos.set(0, 1.6, 0);
            this.hasHead = true;
        }

        this.sensorStale = this.motion.hasSensor && now - this.motion.lastSample > 1.5;
        this.motion.update(now, dt);
        const inp = this.input.poll(dt, xr ? this.renderer.xr.getSession() : null, now);

        if (inp.muteP) this.toggleMute();
        if (inp.pauseP && !vr) this.togglePause();
        if (inp.recenterP) this.needRecenter = true;

        this.updateLook(inp, dt, vr);
        inp.fwdX = this.fwd.x;
        inp.fwdZ = this.fwd.z;

        if (this.state === 'title') {
            const m = this.motion, ui = this.titleUI;
            if (ui.meter) ui.meter.style.width = Math.min(100, m.level / 12 * 100) + '%';
            if (ui.steps) ui.steps.textContent = 'Steps: ' + m.stepCount;
            if (ui.jumps) ui.jumps.textContent = 'Hops: ' + m.jumpCount;
            if (ui.status) {
                ui.status.textContent = m.hasSensor
                    ? 'Motion sensor OK: walk in place and hop to test it.'
                    : this.isTouch
                        ? 'Waiting for motion sensor.'
                        : 'No motion sensor: use keyboard, gamepad or VR controllers.';
            }
            if (inp.startP || inp.jumpP) this.playFlat();
        } else if (this.state === 'dead' || this.state === 'win') {
            if (inp.startP || inp.jumpP) this.startGame();
        } else if (this.state === 'play') {
            this.bonus = Math.max(0, this.bonus - dt * 20);
            this.hud.setBonus(Math.floor(this.bonus));

            this.player.step(dt, inp);

            // Check if player fell off stage
            if (this.player.y < -5) {
                this.player.hurt();
            }

            // Spawn barrels periodically
            this.barrelTimer += dt;
            if (this.barrelTimer > 3.2) {
                this.barrelTimer = 0;
                this.barrels.push(new Barrel(this, 2, 18, -12, -4.5, 0));
            }

            this.barrels.forEach(b => b.update(dt));
            this.items.forEach(i => i.update(dt));
        }

        this.sound.update();
        this.placeCamera(dt, vr, phoneVR);
        this.hud.update(dt);

        if (phoneVR) {
            this.stereo.render(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    updateLook(inp, dt, vr) {
        if (vr) {
            if (inp.snap) this.rigYaw -= inp.snap * Math.PI / 6;
            if (this.needRecenter && this.hasHead) this.recenter();
            _q.setFromAxisAngle(UP, this.rigYaw).multiply(this.headQuat);
            this.gaze.set(0, 0, -1).applyQuaternion(_q);
        } else {
            if (this.state === 'play') {
                this.yaw -= inp.lookX + inp.turn * 2.2 * dt;
                this.pitch = clamp(this.pitch - inp.lookY, -1.45, 1.45);
            }
            _e.set(this.pitch, this.yaw, 0, 'YXZ');
            this.gaze.set(0, 0, -1).applyEuler(_e);
        }
        this.lookPitch = Math.asin(clamp(this.gaze.y, -1, 1));
        const hl = Math.hypot(this.gaze.x, this.gaze.z);
        if (hl > 0.05) this.fwd.set(this.gaze.x / hl, 0, this.gaze.z / hl);
        this.headPitch = this.lookPitch;
    }

    recenter() {
        this.needRecenter = false;
        _v.set(0, 0, -1).applyQuaternion(this.headQuat);
        this.rigYaw = -Math.atan2(-_v.x, -_v.z);
        this.headBase.copy(this.headPos);
    }

    placeCamera(dt, vr, phoneVR) {
        const P = this.player;
        const eyeY = P.y + P.eye;
        if (phoneVR) {
            this.camera.position.copy(this.headPos);
            this.camera.quaternion.copy(this.headQuat);
        }
        if (vr) {
            this.headBase.lerp(this.headPos, 1 - Math.exp(-dt / 8));
            _v.copy(this.headBase).applyAxisAngle(UP, this.rigYaw);
            this.rig.position.set(P.x - _v.x, eyeY - _v.y, P.z - _v.z);
            this.rig.rotation.set(0, this.rigYaw, 0);
        } else {
            this.rig.position.set(0, 0, 0);
            this.rig.rotation.set(0, 0, 0);
            this.camera.position.set(P.x, eyeY, P.z);
            _e.set(this.pitch, this.yaw, 0, 'YXZ');
            this.camera.quaternion.setFromEuler(_e);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
