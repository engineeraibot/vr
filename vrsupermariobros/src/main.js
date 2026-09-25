// Super Mario Bros 3D — first-person World 1-1 for phone VR headsets, WebXR headsets and desktop.
import * as THREE from 'three';
import { initTextures } from './textures.js';
import { initModels, MAT } from './models.js';
import { Sound } from './audio.js';
import { BodyMotion } from './motion.js';
import { Input } from './input.js';
import { Level, ENEMIES, START, CHECKPOINT, POLE_X, POLE_TOP, CASTLE_X, DEATH_Y } from './level.js';
import { Player } from './player.js';
import { Goomba, Koopa, Item, Fireball, CoinPop, Fx } from './entities.js';
import { Hud } from './hud.js';
import { PhoneHead, StereoView } from './cardboard.js';
import { boxesTouch } from './physics.js';

const SKY = 0x5c94fc;
const TIME_START = 400;
const STOMP_SCORES = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];
const SHELL_SCORES = [500, 800, 1000, 2000, 4000, 5000, 8000];

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _c = new THREE.Color();
const clamp = THREE.MathUtils.clamp;

class Game {
    constructor() {
        initTextures();
        initModels();
        this.isTouch = matchMedia('(pointer: coarse)').matches;
        // Phones use our own stereo view (see cardboard.js); headsets like Quest use WebXR.
        this.isPhone = this.isTouch && !/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        r.setSize(window.innerWidth, window.innerHeight);
        r.xr.enabled = true;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFShadowMap;
        document.body.appendChild(r.domElement);
        this.clock = new THREE.Clock();
        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(r);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(SKY);
        this.scene.fog = new THREE.Fog(SKY, 30, 90);
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
        // --- CAMERA RIG --- (moved every frame so your eyes are Mario's eyes)
        this.rig = new THREE.Group();
        this.rig.add(this.camera);
        this.scene.add(this.rig);
        this.world = new THREE.Group();
        this.scene.add(this.world);

        this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x7a6a4a, 1.5));
        const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
        sun.castShadow = true;
        const size = this.isTouch ? 1024 : 2048;
        sun.shadow.mapSize.set(size, size);
        Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.02;
        this.scene.add(sun, sun.target);

        this.sound = new Sound();
        this.motion = new BodyMotion();
        this.input = new Input(r.domElement, this.motion);
        this.level = new Level(this);
        this.world.add(this.level.staticGroup);
        this.fx = new Fx(this);
        this.player = new Player(this);
        this.hud = new Hud(this);

        this.enemies = [];
        this.items = [];
        this.fireballs = [];
        this.pops = [];
        this.score = 0;
        this.coins = 0;
        this.lives = 3;
        this.time = TIME_START;
        this.timeAcc = 0;
        this.checkpoint = false;
        this.area = 'over';
        this.state = 'title';
        this.stateT = 0;
        this.gameTime = 0;
        this.dt = 0;
        this.fade = 0;
        this.fadeTarget = 0;
        this.freezeT = 0;
        this.flashT = 0;
        this.flashDur = 1;
        this.flashColor = new THREE.Color();
        this.tint = { color: 0xffffff, css: 'transparent', alpha: 0 };
        this.fireCd = 0;
        this.lookDownT = 0;
        this.seq = null;

        // Look direction. Desktop: yaw/pitch from the mouse. VR: head pose + rig yaw.
        this.yaw = -Math.PI / 2;
        this.pitch = 0;
        this.rigYaw = -Math.PI / 2;
        this.headPos = new THREE.Vector3(0, 1.6, 0);
        this.headQuat = new THREE.Quaternion();
        this.headBase = new THREE.Vector3(0, 1.6, 0);
        this.hasHead = false;
        this.needRecenter = true;
        this.gaze = new THREE.Vector3(1, 0, 0);
        this.fwd = new THREE.Vector3(1, 0, 0);
        this.lookPitch = 0;

        this.resetLevel();
        this.setupUI();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop((t, frame) => this.frame(frame));
        window.game = this; // handy for debugging from the console
    }

    // ------------------------------------------------------------------ UI / VR

    setupUI() {
        const $ = id => document.getElementById(id);
        const vrBtn = $('enterVR');
        const xrBtn = $('webxr');
        const status = $('vrStatus');
        const setStatus = t => { status.textContent = t; };
        const startXR = () => this.enterVR().catch(err => setStatus('Could not start WebXR: ' + err.message));
        const xrCheck = navigator.xr && navigator.xr.isSessionSupported
            ? navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
            : Promise.resolve(false);
        if (this.isPhone) {
            // Phone in a headset: our own stereo view keeps the motion sensors running.
            vrBtn.onclick = () => this.enterPhoneVR();
            xrCheck.then(ok => { xrBtn.hidden = !ok; });
            xrBtn.onclick = startXR;
            if (!window.isSecureContext) setStatus('Motion sensors need https: open the page through ngrok (see readme).');
        } else {
            vrBtn.onclick = startXR;
            xrCheck.then(ok => {
                vrBtn.disabled = !ok;
                if (!ok) {
                    setStatus(window.isSecureContext
                        ? 'VR is not available in this browser. Open the page on your phone or VR headset.'
                        : 'VR needs https: serve the page through ngrok (see readme).');
                }
            });
        }
        $('play').onclick = () => this.playFlat();
        const viewer = $('viewer');
        viewer.value = this.stereo.viewerId;
        viewer.onchange = () => this.stereo.setViewer(viewer.value);
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });

        const sens = $('sens');
        sens.value = String(this.motion.sensitivity);
        if (sens.value === '') sens.value = '1';
        sens.onchange = () => this.motion.setSensitivity(parseFloat(sens.value));
        const enableBtn = $('enableMotion');
        enableBtn.hidden = !this.motion.needsPermission;
        const refresh = () => { enableBtn.hidden = !this.motion.needsPermission; };
        enableBtn.onclick = () => this.enableSensors().then(refresh);
        this.enableSensors().then(refresh);
        // Browsers that ask for sensor permission only allow it from a tap or click.
        $('title').addEventListener('pointerdown', () => this.enableSensors().then(refresh));
        setInterval(() => { if (this.state === 'title') refresh(); }, 1000);
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
            if (!locked && this.wasLocked && this.state === 'playing') this.togglePause(true);
            this.wasLocked = locked;
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing' && !this.renderer.xr.isPresenting) this.togglePause(true);
            if (!document.hidden && this.stereo.active) this.keepAwake();
        });
        window.addEventListener('keydown', e => {
            if (e.code === 'Enter' && this.state === 'title') this.playFlat();
        });
    }

    // Both permission requests start in the same tap (neither is awaited before the other).
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
        document.getElementById('title').classList.add('hidden');
        this.startGame();
        if (!this.isTouch) this.lockPointer();
    }

    get inVR() {
        return this.renderer.xr.isPresenting || this.stereo.active;
    }

    // Phone headset mode: fullscreen side-by-side stereo, gyroscope head tracking.
    enterPhoneVR() {
        // Permission prompts must come before requestFullscreen, which uses up the click.
        this.sound.unlock();
        this.enableSensors();
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        this.keepAwake();
        this.stereo.active = true;
        document.getElementById('title').classList.add('hidden');
        this.needRecenter = true;
        if (this.state === 'title' || this.state === 'gameover' || this.state === 'clear') this.startGame();
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
        // Both need the click's user activation, so start them before any await.
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
        session.addEventListener('visibilitychange', () => {
            if (session.visibilityState !== 'visible') this.togglePause(true);
            else this.togglePause(false);
        });
        session.addEventListener('end', () => {
            this.hasHead = false;
            this.needRecenter = true;
            this.camera.position.set(0, 0, 0);
            this.camera.quaternion.identity();
            this.onResize();
            this.togglePause(true);
        });
        document.getElementById('title').classList.add('hidden');
        this.needRecenter = true;
        if (this.state === 'title' || this.state === 'gameover' || this.state === 'clear') this.startGame();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        if (!this.renderer.xr.isPresenting) this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ------------------------------------------------------------------ main loop

    frame(xrFrame) {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.dt = dt;
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
                // Only real positional tracking (not a phone's emulated neck model) can see steps.
                if (!pose.emulatedPosition) this.motion.feedHead(p.y, now, dt);
            }
        } else if (phoneVR && this.phoneHead.update()) {
            this.headQuat.copy(this.phoneHead.quat);
            this.headPos.set(0, 1.6, 0);
            this.hasHead = true;
        }
        // A phone whose sensor stopped reporting (e.g. inside WebXR) can only use taps / holds.
        this.sensorStale = this.motion.hasSensor && now - this.motion.lastSample > 1.5;
        this.motion.update(now, dt);
        const inp = this.inp = this.input.poll(dt, xr ? this.renderer.xr.getSession() : null, now);
        this.sound.update();
        if (inp.muteP) this.sound.toggleMute();
        if (inp.pauseP && !vr) this.togglePause();
        if (inp.recenterP) this.needRecenter = true;
        this.updateLook(inp, dt, vr);
        inp.fwdX = this.fwd.x;
        inp.fwdZ = this.fwd.z;

        switch (this.state) {
            case 'title': this.updateTitle(); break;
            case 'intro': this.updateIntro(vr); break;
            case 'playing': this.updatePlaying(dt, inp, vr); break;
            case 'dying': this.updateDying(dt); break;
            case 'seq': this.updateSeq(); break;
            case 'paused': if (inp.startP && !this.isTouch) this.togglePause(false); break;
            case 'gameover':
            case 'clear':
                if (this.stateT > 1.5 && (inp.startP || inp.jumpP)) this.startGame();
                break;
        }
        this.stateT += dt;
        this.animate(dt);
        this.placeCamera(dt, vr, phoneVR);
        this.hud.update(dt);
        if (phoneVR) this.stereo.render(this.scene, this.camera);
        else this.renderer.render(this.scene, this.camera);
    }

    setState(s) {
        this.state = s;
        this.stateT = 0;
    }

    updateLook(inp, dt, vr) {
        if (vr) {
            if (inp.snap) this.rigYaw -= inp.snap * Math.PI / 6;
            if (this.needRecenter && this.hasHead) this.recenter();
            _q.setFromAxisAngle(UP, this.rigYaw).multiply(this.headQuat);
            this.gaze.set(0, 0, -1).applyQuaternion(_q);
        } else {
            if (this.state !== 'title' && this.state !== 'paused') {
                this.yaw -= inp.lookX + inp.turn * 2.2 * dt;
                this.pitch = clamp(this.pitch - inp.lookY, -1.45, 1.45);
            }
            _e.set(this.pitch, this.yaw, 0);
            this.gaze.set(0, 0, -1).applyEuler(_e);
        }
        this.lookPitch = Math.asin(clamp(this.gaze.y, -1, 1));
        const hl = Math.hypot(this.gaze.x, this.gaze.z);
        if (hl > 0.05) this.fwd.set(this.gaze.x / hl, 0, this.gaze.z / hl);
    }

    // Make the direction you are facing right now point down the level (+x).
    recenter() {
        this.needRecenter = false;
        _v.set(0, 0, -1).applyQuaternion(this.headQuat);
        this.rigYaw = -Math.PI / 2 - Math.atan2(-_v.x, -_v.z);
        this.headBase.copy(this.headPos);
    }

    placeCamera(dt, vr, phoneVR) {
        const P = this.player;
        const eyeY = P.y + P.eye;
        if (phoneVR) {
            // With WebXR the browser poses the camera; here we do it from the gyroscope.
            this.camera.position.copy(this.headPos);
            this.camera.quaternion.copy(this.headQuat);
        }
        if (vr) {
            // Keep the head's rest position on Mario; small real head movements still add parallax.
            this.headBase.lerp(this.headPos, 1 - Math.exp(-dt / 8));
            _v.copy(this.headBase).applyAxisAngle(UP, this.rigYaw);
            this.rig.position.set(P.x - _v.x, eyeY - _v.y, P.z - _v.z);
            this.rig.rotation.set(0, this.rigYaw, 0);
        } else {
            this.rig.position.set(0, 0, 0);
            this.rig.rotation.set(0, 0, 0);
            this.camera.position.set(P.x, eyeY, P.z);
            _e.set(this.pitch, this.yaw, 0);
            this.camera.quaternion.setFromEuler(_e);
        }
        const cx = P.x + this.fwd.x * 8, cz = P.z + this.fwd.z * 8;
        this.sun.position.set(cx - 5, P.y + 25, cz + 4);
        this.sun.target.position.set(cx, P.y, cz);
    }

    // ------------------------------------------------------------------ game flow

    updateTitle() {
        const t = this.gameTime;
        this.yaw = -Math.PI / 2 + Math.sin(t * 0.2) * 0.5;
        this.pitch = 0.2 + Math.sin(t * 0.13) * 0.08;
        const m = this.motion, ui = this.titleUI;
        ui.meter.style.width = Math.min(100, m.level / 12 * 100) + '%';
        ui.steps.textContent = 'Steps: ' + m.stepCount;
        ui.jumps.textContent = 'Hops: ' + m.jumpCount;
        ui.status.textContent = m.hasSensor
            ? 'Motion sensor OK: walk in place and hop to test it.'
            : this.isTouch
                ? 'Waiting for the motion sensor (the page must be opened over https).'
                : 'No motion sensor here: use the keyboard, a gamepad or VR controllers.';
    }

    startGame() {
        this.score = 0;
        this.coins = 0;
        this.lives = 3;
        this.checkpoint = false;
        this.player.power = 0;
        this.startIntro();
    }

    startIntro() {
        this.resetLevel();
        this.setState('intro');
        this.fade = this.fadeTarget = 1;
        this.hud.message('WORLD 1-1', `MARIO  x ${this.lives}`);
        this.time = TIME_START;
        this.timeAcc = 0;
        this.hurried = false;
        this.sound.stopMusic();
    }

    updateIntro(vr) {
        if (this.stateT < 2.4) return;
        this.setState('playing');
        this.hud.clearMessage();
        this.fadeTarget = 0;
        this.needRecenter = true; // forward = wherever you face when the level starts
        this.sound.music('overworld');
        this.hud.hint(vr
            ? 'Walk in place to move, jog to run, hop (or tap) to jump. Turn to steer.'
            : this.isTouch
                ? 'Drag to look, hold to walk, tap to jump'
                : 'WASD move, mouse look, SPACE jump, SHIFT run', 7);
    }

    resetLevel() {
        this.level.reset();
        this.enemies = ENEMIES.map(([t, x, z, y = 0]) => (t === 'k' ? new Koopa(this, x, y, z) : new Goomba(this, x, y, z)));
        this.items = [];
        this.fireballs = [];
        this.pops = [];
        this.fx.clear();
        this.setArea('over');
        const sp = this.checkpoint ? CHECKPOINT : START;
        this.player.reset(sp.x, 0, sp.z);
        this.yaw = -Math.PI / 2;
        this.pitch = 0;
        this.needRecenter = true;
        this.freezeT = 0;
    }

    setArea(a) {
        this.area = a;
        const col = a === 'room' ? 0x000000 : SKY;
        this.scene.background.setHex(col);
        this.scene.fog.color.setHex(col);
    }

    togglePause(on) {
        if (on === undefined) on = this.state !== 'paused';
        if (on && this.state === 'playing') {
            this.setState('paused');
            this.hud.message('PAUSED', this.renderer.xr.isPresenting ? '' : this.isTouch ? 'Tap to resume' : 'Click or press P to resume');
            this.sound.pauseMusic(true);
            this.sound.play('pause');
        } else if (!on && this.state === 'paused') {
            this.setState('playing');
            this.hud.clearMessage();
            this.sound.pauseMusic(false);
        }
    }

    updatePlaying(dt, inp, vr) {
        const P = this.player;
        if (this.freezeT > 0) { this.freezeT -= dt; return; }

        this.timeAcc += dt;
        while (this.timeAcc >= 0.4) {
            this.timeAcc -= 0.4;
            this.time--;
            if (this.time === 100 && !this.hurried) {
                this.hurried = true;
                this.sound.play('hurry');
                this.sound.tempo = 1.35;
            }
            if (this.time <= 0) { this.time = 0; this.killPlayer(false); return; }
        }

        const n = Math.max(1, Math.ceil(dt * 120));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
            P.step(h, inp);
            inp.jumpP = false;
            for (const e of this.enemies) e.update(h);
            for (const it of this.items) it.update(h);
            for (const f of this.fireballs) f.update(h);
            for (const c of this.pops) c.update(h);
            this.interactions(inp);
            if (this.state !== 'playing') return;
        }

        if (P.inv > 0) P.inv -= dt;
        if (P.star > 0) {
            P.star -= dt;
            if (P.star <= 0) this.resumeMusic();
        }
        for (const b of this.level.blocks) if (b.multiT > 0) b.multiT -= dt;
        this.collectCoins();

        if (P.y < DEATH_Y) { this.killPlayer(true); return; }
        if (!this.checkpoint && this.area === 'over' && P.x > CHECKPOINT.x) this.checkpoint = true;
        this.updateFire(dt, inp);

        if (this.renderer.xr.isPresenting && this.sensorStale && !this.warnedSensor) {
            this.warnedSensor = true;
            this.hud.hint(this.isPhone
                ? 'Phone motion sensors are paused in WebXR mode. Tap to jump, hold to walk, or use the Enter VR button instead.'
                : 'Motion sensor paused: tap to jump, hold to walk.', 8);
        }
        if (this.area === 'over' && P.x + P.hx >= POLE_X - 0.08) { this.runSeq(this.seqFlag(vr)); return; }

        const pipe = P.onGround && P.groundSolid && P.groundSolid.pipe;
        if (pipe && pipe.warp && Math.hypot(P.x - pipe.cx, P.z - pipe.cz) < 0.8) {
            this.hud.hint(vr ? 'Look down into the pipe to enter it' : 'Look down (or press C) to enter the pipe', 0.3);
            this.lookDownT = inp.crouch ? 1 : this.lookPitch < -0.95 ? this.lookDownT + dt : 0;
            if (this.lookDownT > 0.45) { this.lookDownT = 0; this.runSeq(this.seqPipeDown(pipe)); return; }
        } else {
            this.lookDownT = 0;
        }

        const ex = this.level.roomExit;
        if (this.area === 'room' && P.onGround && P.y < 0.5 && Math.abs(P.z - ex.z) < 1.2 && P.x + P.hx >= ex.x - 0.1 && P.wishX > 0.3) {
            this.runSeq(this.seqPipeSide());
        }
    }

    resumeMusic() {
        this.sound.music(this.area === 'room' ? 'underground' : 'overworld');
        if (this.hurried) this.sound.tempo = 1.35;
    }

    interactions(inp) {
        const P = this.player;
        const E = this.enemies;
        for (const e of E) {
            if (e.dead || !e.active) continue;
            if (e.state === 'shellMove') {
                for (const o of E) {
                    if (o === e || o.dead || !o.active || !o.solidBody || !boxesTouch(e, o)) continue;
                    o.flipDie(Math.sign(e.vx) || 1);
                    this.chainKill(e, o);
                }
            } else if (e.state === 'walk') {
                for (const o of E) {
                    if (o === e || o.dead || !o.active || (o.state !== 'walk' && o.state !== 'shell') || !boxesTouch(e, o)) continue;
                    e.dir = e.x < o.x ? -1 : 1;
                    if (o.state === 'walk') o.dir = -e.dir;
                }
            }
        }
        for (const f of this.fireballs) {
            if (f.dead) continue;
            for (const e of E) {
                if (e.dead || !e.active || !e.solidBody || !boxesTouch(f, e)) continue;
                e.flipDie(Math.sign(f.vx) || 1);
                this.addScore(e.kind === 'koopa' ? 200 : 100, e);
                this.sound.play('kick');
                f.explode();
                break;
            }
        }
        if (P.state !== 'normal') return;
        for (const e of E) {
            if (e.dead || !e.active || !e.solidBody) continue;
            // A generous box for stomps (it is hard to judge distances looking down in VR).
            if (!boxesTouch(P, e, 0.15)) continue;
            const stomping = P.vy < 0 && P.prevY >= e.y + e.h * 0.45;
            if (!stomping && !boxesTouch(P, e, 0)) continue;
            if (P.star > 0) {
                e.flipDie(Math.sign(e.x - P.x) || 1);
                this.addScore(200, e);
                this.sound.play('kick');
                continue;
            }
            if (e.state === 'shell') {
                if (e.grace > 0) continue;
                if (stomping) P.bounce(inp.jump);
                let dx = e.x - P.x, dz = e.z - P.z;
                if (Math.hypot(dx, dz) < 0.05) { dx = this.fwd.x; dz = this.fwd.z; }
                e.kick(dx, dz);
                this.addScore(400, e);
                this.sound.play('kick');
                continue;
            }
            if (stomping) {
                if (e.kind === 'goomba') e.stomp(); else e.toShell();
                P.bounce(inp.jump);
                if (P.stompChain < STOMP_SCORES.length) this.addScore(STOMP_SCORES[P.stompChain], e);
                else this.oneUp(e);
                P.stompChain++;
                this.sound.play('stomp');
                this.fx.puff(e.x, e.y + 0.2, e.z, 5);
                continue;
            }
            if (e.grace > 0) continue;
            P.hurt();
            if (P.state !== 'normal' || this.state !== 'playing') return;
        }
        for (const it of this.items) {
            if (!it.dead && it.state !== 'sprout' && boxesTouch(P, it)) this.collectItem(it);
        }
    }

    chainKill(shell, victim) {
        shell.chain++;
        if (shell.chain > SHELL_SCORES.length) this.oneUp(victim);
        else this.addScore(SHELL_SCORES[shell.chain - 1], victim);
        this.sound.play('kick');
    }

    collectItem(it) {
        const P = this.player;
        it.remove();
        switch (it.kind) {
            case 'mushroom':
                if (P.power === 0) { P.power = 1; this.freezeT = 0.45; }
                this.flash(0xffffff, 0.5);
                this.addScore(1000, it);
                this.sound.play('powerup');
                break;
            case 'flower':
                P.power = 2;
                this.freezeT = 0.45;
                this.flash(0xff9030, 0.5);
                this.addScore(1000, it);
                this.sound.play('powerup');
                this.hud.hint('Fire Mario! Look at an enemy to throw fireballs', 5);
                break;
            case 'star':
                P.star = 10;
                this.addScore(1000, it);
                this.sound.play('powerup');
                this.sound.music('star');
                break;
            case 'oneup':
                this.oneUp(it);
                break;
        }
    }

    collectCoins() {
        const P = this.player;
        for (const c of this.level.coins) {
            if (c.taken) continue;
            if (Math.abs(c.x - P.x) < 0.65 && Math.abs(c.z - P.z) < 0.65 && c.y + 0.35 > P.y && c.y - 0.35 < P.y + P.h) {
                c.taken = true;
                this.score += 200;
                this.addCoin();
                this.fx.sparkle(c.x, c.y, c.z);
            }
        }
    }

    addScore(pts, at) {
        this.score += pts;
        this.fx.popup(at.x, at.y + (at.h || 1) + 0.3, at.z, String(pts));
    }

    addCoin() {
        this.coins++;
        this.sound.play('coin');
        if (this.coins >= 100) { this.coins -= 100; this.oneUp(this.player); }
    }

    oneUp(at) {
        this.lives++;
        this.sound.play('oneup');
        this.fx.popup(at.x, at.y + (at.h || 1) + 0.3, at.z, '1UP', '#7dff6a');
    }

    updateFire(dt, inp) {
        const P = this.player;
        this.fireCd -= dt;
        if (P.power !== 2 || this.fireCd > 0) return;
        let live = 0;
        for (const f of this.fireballs) if (!f.dead) live++;
        if (live >= 2) return;
        let want = inp.fireP || inp.fire;
        if (!want) {
            // Gaze aiming: look at an enemy and Mario throws a fireball at it.
            const ey = P.y + P.eye;
            for (const e of this.enemies) {
                if (e.dead || !e.active || !e.solidBody) continue;
                _v.set(e.x - P.x, e.y + e.h / 2 - ey, e.z - P.z);
                const d = _v.length();
                if (d > 14 || d < 0.8) continue;
                if (_v.dot(this.gaze) / d > 0.985) { want = true; break; }
            }
        }
        if (!want) return;
        this.fireCd = 0.3;
        this.fireballs.push(new Fireball(this, P.x + this.fwd.x * 0.45, P.y + 0.5, P.z + this.fwd.z * 0.45, this.fwd.x, this.fwd.z));
        this.sound.play('fireball');
    }

    // ------------------------------------------------------------------ blocks

    headBump(hits) {
        const P = this.player;
        let best = null, bd = Infinity;
        for (const s of hits) {
            if (!s.block) continue;
            const d = Math.hypot((s.minX + s.maxX) / 2 - P.x, (s.minZ + s.maxZ) / 2 - P.z);
            if (d < bd) { bd = d; best = s.block; }
        }
        if (best) this.hitBlock(best);
        else this.sound.play('bump');
    }

    hitBlock(b) {
        const big = this.player.power > 0;
        this.bumpAbove(b);
        if (b.used) { this.sound.play('bump'); return; }
        if (b.solid.hidden) { b.solid.hidden = false; b.mesh.visible = true; }
        switch (b.content) {
            case 'coin':
                this.coinPop(b);
                this.useBlock(b);
                break;
            case 'multicoin':
                if (b.multiT === undefined) { b.multiT = 4.5; b.multiLeft = 10; }
                this.coinPop(b);
                b.multiLeft--;
                if (b.multiLeft <= 0 || b.multiT <= 0) this.useBlock(b);
                else b.bumpT = 0.18;
                break;
            case 'mushroom':
                this.spawnItem(big ? 'flower' : 'mushroom', b);
                this.useBlock(b);
                break;
            case '1up':
                this.spawnItem('oneup', b);
                this.useBlock(b);
                break;
            case 'star':
                this.spawnItem('star', b);
                this.useBlock(b);
                break;
            default:
                if (big) this.breakBlock(b);
                else { b.bumpT = 0.18; this.sound.play('bump'); }
        }
    }

    useBlock(b) {
        b.used = true;
        b.mesh.material = MAT.used;
        b.bumpT = 0.18;
    }

    breakBlock(b) {
        b.broken = true;
        this.level.cw.remove(b.solid);
        b.mesh.removeFromParent();
        this.fx.debris(b.x + 0.5, b.y + 0.5, b.z);
        this.sound.play('break');
        this.score += 50;
    }

    // Anything standing on a block that gets hit from below is knocked out.
    bumpAbove(b) {
        const top = b.y + 1, cx = b.x + 0.5;
        for (const e of this.enemies) {
            if (e.dead || !e.solidBody || Math.abs(e.y - top) > 0.25) continue;
            if (Math.abs(e.x - cx) < 0.5 + e.hx && Math.abs(e.z - b.z) < 0.5 + e.hz) {
                e.flipDie(Math.sign(e.x - cx) || 1);
                this.addScore(100, e);
                this.sound.play('kick');
            }
        }
        for (const it of this.items) {
            if (it.dead || it.state !== 'move' || Math.abs(it.y - top) > 0.25) continue;
            if (Math.abs(it.x - cx) < 0.9 && Math.abs(it.z - b.z) < 0.9) { it.vy = 8; it.dir = it.x < cx ? -1 : 1; }
        }
        for (const c of this.level.coins) {
            if (!c.taken && Math.abs(c.x - cx) < 0.6 && Math.abs(c.z - b.z) < 0.6 && c.y > top && c.y < top + 1.2) {
                c.taken = true;
                this.score += 200;
                this.addCoin();
                this.fx.sparkle(c.x, c.y, c.z);
            }
        }
    }

    spawnItem(kind, b) {
        this.items.push(new Item(this, kind, b));
        this.sound.play('sprout');
    }

    coinPop(b) {
        this.pops.push(new CoinPop(this, b.x + 0.5, b.y + 1, b.z));
        this.score += 200;
        this.addCoin();
    }

    // ------------------------------------------------------------------ death

    killPlayer(fell) {
        if (this.state !== 'playing' && this.state !== 'seq') return;
        const P = this.player;
        this.seq = null;
        this.setState('dying');
        P.state = 'dead';
        P.star = 0;
        P.inv = 0;
        P.launched = false;
        this.deathFell = fell;
        if (!fell) P.vx = P.vy = P.vz = 0;
        this.sound.stopMusic();
        this.sound.play('death');
        this.flash(0xff0000, 0.7);
    }

    updateDying(dt) {
        const P = this.player;
        const t = this.stateT;
        if (this.deathFell) {
            P.vy = Math.max(P.vy - 30 * dt, -15);
            P.y += P.vy * dt;
        } else if (t > 0.5) {
            if (!P.launched) { P.launched = true; P.vy = 7; }
            P.vy -= 20 * dt;
            P.y += P.vy * dt;
        }
        if (t > 1.6) this.fadeTarget = 1;
        if (t > 3.0) {
            this.lives--;
            P.power = 0;
            if (this.lives > 0) this.startIntro();
            else this.gameOver();
        }
    }

    gameOver() {
        this.setState('gameover');
        this.fadeTarget = 0.85;
        this.hud.message('GAME OVER', this.inVR || this.isTouch ? 'Hop or tap to play again' : 'Press ENTER or SPACE to play again');
        this.sound.play('gameover');
    }

    // ------------------------------------------------------------------ scripted sequences

    runSeq(gen) {
        this.seq = gen;
        this.setState('seq');
    }

    updateSeq() {
        if (!this.seq) { this.setState('playing'); return; }
        const r = this.seq.next();
        if (r.done) {
            this.seq = null;
            if (this.state === 'seq') this.setState('playing');
        }
    }

    *wait(t) {
        while (t > 0) { t -= this.dt; yield; }
    }

    *seqPipeDown(pipe) {
        const P = this.player;
        P.state = 'pipe';
        P.vx = P.vy = P.vz = 0;
        this.sound.play('pipe');
        const x0 = P.x, z0 = P.z, y0 = P.y;
        for (let t = 0; t < 1.1; t += this.dt) {
            const k = Math.min(1, t / 0.25);
            P.x = x0 + (pipe.cx - x0) * k;
            P.z = z0 + (pipe.cz - z0) * k;
            P.y = y0 - Math.max(0, t - 0.25) * 2.2;
            if (t > 0.5) this.fadeTarget = 1;
            yield;
        }
        yield* this.wait(0.3);
        this.setArea('room');
        const s = this.level.roomSpawn;
        P.x = s.x; P.y = s.y; P.z = s.z;
        P.vy = 0;
        P.state = 'normal';
        this.yaw = -Math.PI / 2;
        this.pitch = -0.2;
        this.resumeMusic();
        if (P.star > 0) this.sound.music('star');
        this.fadeTarget = 0;
        this.hud.hint('Bonus room! Grab the coins, then walk into the pipe at the far end', 6);
    }

    *seqPipeSide() {
        const P = this.player;
        P.state = 'pipe';
        P.vx = P.vy = P.vz = 0;
        this.sound.play('pipe');
        const z0 = P.z;
        for (let t = 0; t < 0.9; t += this.dt) {
            P.x += 1.8 * this.dt;
            P.z = z0 - z0 * Math.min(1, t / 0.3);
            if (t > 0.35) this.fadeTarget = 1;
            yield;
        }
        yield* this.wait(0.3);
        const ex = this.level.exitPipe;
        this.setArea('over');
        P.x = ex.cx; P.z = ex.cz; P.y = ex.top - 1.9;
        this.yaw = -Math.PI / 2;
        this.pitch = 0;
        this.resumeMusic();
        if (P.star > 0) this.sound.music('star');
        this.fadeTarget = 0;
        this.sound.play('pipe');
        for (let t = 0; t < 1; t += this.dt) {
            P.y = ex.top - 1.9 + Math.min(1, t) * 1.9;
            yield;
        }
        P.y = ex.top;
        P.state = 'normal';
    }

    *seqFlag(vr) {
        const P = this.player, L = this.level;
        P.state = 'pole';
        P.vx = P.vy = P.vz = 0;
        P.star = 0;
        P.inv = 0;
        this.sound.stopMusic();
        this.sound.play('flag');
        const h = P.y;
        const pts = h >= 8 ? 5000 : h >= 6 ? 2000 : h >= 4 ? 800 : h >= 2 ? 400 : 100;
        this.score += pts;
        this.fx.popup(POLE_X, Math.min(h, POLE_TOP) + 2.2, 0.3, String(pts));

        // Grab the pole (it ends up just to your left) and slide down with the flag.
        const x0 = P.x, z0 = P.z, gx = POLE_X - 0.35, gz = 0.45;
        P.y = Math.min(P.y, POLE_TOP - 1);
        for (let t = 0; t < 0.2; t += this.dt) {
            const k = t / 0.2;
            P.x = x0 + (gx - x0) * k;
            P.z = z0 + (gz - z0) * k;
            yield;
        }
        P.x = gx; P.z = gz;
        while (P.y > 1 || L.flag.position.y > 1.8) {
            P.y = Math.max(1, P.y - 8 * this.dt);
            L.flag.position.y = Math.max(1.8, L.flag.position.y - 8 * this.dt);
            yield;
        }
        yield* this.wait(0.3);
        this.sound.play('clear');

        // Hop off and walk into the castle.
        P.state = 'auto';
        const hx0 = P.x, hz0 = P.z, hx1 = POLE_X + 0.9;
        for (let t = 0; t < 0.45; t += this.dt) {
            const k = t / 0.45;
            P.x = hx0 + (hx1 - hx0) * k;
            P.z = hz0 * (1 - k);
            P.y = 1 - k + Math.sin(k * Math.PI) * 0.7;
            yield;
        }
        P.y = 0;
        while (P.x < CASTLE_X + 0.2) {
            P.x += 3.2 * this.dt;
            if (P.x > CASTLE_X - 1.5) this.fadeTarget = 1;
            yield;
        }
        yield* this.wait(0.35);

        // Watch the celebration from the top of the big staircase.
        P.x = 189.5; P.y = 8; P.z = 1.6;
        this.yaw = -Math.PI / 2 - 0.12;
        this.pitch = -0.12;
        this.needRecenter = true;
        this.fadeTarget = 0;
        yield* this.wait(0.7);
        let tick = 0;
        while (this.time > 0) {
            const n = Math.min(this.time, 3);
            this.time -= n;
            this.score += 50 * n;
            if (tick++ % 2 === 0) this.sound.play('tick');
            yield;
        }
        yield* this.wait(0.3);
        for (let t = 0; t < 1; t += this.dt) {
            L.castleFlag.position.y = 5.0 + Math.min(1, t) * 1.6;
            yield;
        }
        for (let i = 0; i < 3; i++) {
            this.fx.firework(CASTLE_X + 2.5 + (Math.random() - 0.5) * 5, 8.5 + Math.random() * 3, (Math.random() - 0.5) * 6);
            this.sound.play('firework');
            yield* this.wait(0.7);
        }
        yield* this.wait(0.8);
        this.setState('clear');
        this.hud.message('COURSE CLEAR!', `Thank you Mario!\nSCORE ${this.score}\n\n${vr || this.isTouch ? 'Hop or tap' : 'Press ENTER or SPACE'} to play again`);
    }

    // ------------------------------------------------------------------ per-frame visuals

    flash(color, dur) {
        this.flashColor.set(color);
        this.flashT = this.flashDur = dur;
    }

    animate(dt) {
        const t = this.gameTime;
        MAT.question.emissiveIntensity = 0.12 + (Math.sin(t * 4) * 0.5 + 0.5) * 0.35;
        for (const b of this.level.blocks) {
            if (b.bumpT <= 0) continue;
            b.bumpT = Math.max(0, b.bumpT - dt);
            b.mesh.position.y = b.y + 0.5 + Math.sin((1 - b.bumpT / 0.18) * Math.PI) * 0.35;
        }
        this.level.updateCoins(t);
        if (this.enemies.some(e => e.dead)) this.enemies = this.enemies.filter(e => !e.dead);
        if (this.items.some(e => e.dead)) this.items = this.items.filter(e => !e.dead);
        if (this.fireballs.some(e => e.dead)) this.fireballs = this.fireballs.filter(e => !e.dead);
        if (this.pops.some(e => e.dead)) this.pops = this.pops.filter(e => !e.dead);
        for (const list of [this.enemies, this.items, this.fireballs, this.pops]) for (const a of list) a.sync(t);
        if (this.state !== 'paused') this.fx.update(dt);
        this.player.updateVisual(dt);

        this.fade += clamp(this.fadeTarget - this.fade, -3.2 * dt, 3.2 * dt);
        const P = this.player;
        let a = 0, col = 0xffffff;
        if (this.flashT > 0) {
            this.flashT -= dt;
            a = 0.45 * Math.max(0, this.flashT / this.flashDur);
            col = this.flashColor.getHex();
        } else if (P.star > 0 && P.state === 'normal') {
            col = _c.setHSL((t * 1.5) % 1, 1, 0.5).getHex();
            a = 0.13 * Math.min(1, P.star / 2);
        } else if (P.inv > 0 && Math.sin(t * 25) > 0) {
            col = 0xff4040;
            a = 0.12;
        }
        this.tint.color = col;
        this.tint.alpha = a;
        this.tint.css = _c.setHex(col).getStyle();
    }
}

new Game();
