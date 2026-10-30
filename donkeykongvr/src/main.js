import * as THREE from 'three';
import { initTextures } from './textures.js';
import { initModels } from './models.js';
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

        this.initThree();
        initTextures();
        initModels();

        this.stage = new Stage(this);
        this.world.add(this.stage.meshGroup);

        this.player = new Player(this);
        this.motion = new BodyMotion();
        this.phoneHead = new PhoneHead();
        this.stereoView = new StereoView(this.renderer);
        this.input = new Input(this.renderer.domElement, this.motion);
        this.sound = new Sound();
        this.hud = new HUD();

        this.barrels = [];
        this.items = [];
        this.barrelTimer = 0;
        this.lookPitch = 0;

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

        this.setupEvents();
        this.setupUI();
        this.spawnHammer();
        this.animate(0);
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0512);
        this.scene.fog = new THREE.FogExp2(0x0a0512, 0.015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
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
        const vrBtn = document.getElementById('enterVR');
        const playBtn = document.getElementById('play');
        const enableMotionBtn = document.getElementById('enableMotion');
        const webxrBtn = document.getElementById('webxr');
        const viewerSel = document.getElementById('viewer');
        const sensSel = document.getElementById('sens');

        if (viewerSel) {
            viewerSel.value = this.stereoView.viewerId;
            viewerSel.onchange = () => this.stereoView.setViewer(viewerSel.value);
        }
        if (sensSel) {
            sensSel.value = String(this.motion.sensitivity);
            sensSel.onchange = () => this.motion.setSensitivity(parseFloat(sensSel.value));
        }

        const refreshSensors = () => {
            if (enableMotionBtn) enableMotionBtn.hidden = !this.motion.needsPermission;
        };

        if (enableMotionBtn) {
            enableMotionBtn.onclick = () => this.enableSensors().then(refreshSensors);
        }

        if (playBtn) {
            playBtn.onclick = () => {
                this.sound.unlock();
                this.enableSensors().then(refreshSensors);
                this.stereoView.active = false;
                this.startGame();
            };
        }

        if (vrBtn) {
            vrBtn.onclick = () => this.enterPhoneVR();
        }

        if (webxrBtn) {
            const xrCheck = navigator.xr && navigator.xr.isSessionSupported
                ? navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
                : Promise.resolve(false);
            xrCheck.then(ok => { webxrBtn.hidden = !ok; });
            webxrBtn.onclick = () => this.enterWebXR();
        }

        document.getElementById('title')?.addEventListener('pointerdown', () => this.enableSensors().then(refreshSensors));

        this.titleUI = {
            meter: document.getElementById('meterBar'),
            steps: document.getElementById('stepCount'),
            jumps: document.getElementById('jumpCount'),
            status: document.getElementById('motionStatus')
        };
    }

    enableSensors() {
        return Promise.all([this.motion.enable(), this.phoneHead.enable()]);
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            if (!this.renderer.xr.isPresenting) this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereoView.active) {
                this.exitPhoneVR();
            }
        });

        const canvas = this.renderer.domElement;
        canvas.addEventListener('click', () => {
            if (this.state === 'title' || this.state === 'dead') {
                if (this.state === 'title') this.startGame();
                else this.restartStage();
            } else if (this.state === 'paused') {
                this.togglePause(false);
            } else if (!this.renderer.xr.isPresenting && !matchMedia('(pointer: coarse)').matches) {
                canvas.requestPointerLock?.();
            }
        });
    }

    enterPhoneVR() {
        this.sound.unlock();
        this.enableSensors();
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        this.stereoView.active = true;
        this.needRecenter = true;
        this.startGame();
    }

    exitPhoneVR() {
        this.stereoView.active = false;
        this.hasHead = false;
        this.needRecenter = true;
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.identity();
    }

    async enterWebXR() {
        this.sound.unlock();
        this.enableSensors();
        this.motion.startSensorApi();
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
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
        });
        this.needRecenter = true;
        this.startGame();
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
        this.rigYaw = 0;
        this.needRecenter = true;
        this.hud.showMessage('');
        this.state = 'play';
        this.sound.music('theme');
    }

    killPlayer() {
        if (this.state !== 'play') return;
        this.lives--;
        this.hud.setLives(this.lives);
        if (this.lives <= 0) {
            this.hud.showMessage('GAME OVER', 'Click or tap screen / press Space to play again');
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
            this.hud.showMessage('PAUSED', 'Click screen or press P to resume');
        } else if (!on && this.state === 'paused') {
            this.state = 'play';
            this.hud.showMessage('');
        }
    }

    toggleMute() { this.sound.toggleMute(); }
    recenter() {
        this.needRecenter = false;
        _v.set(0, 0, -1).applyQuaternion(this.headQuat);
        this.rigYaw = -Math.atan2(-_v.x, -_v.z);
        this.headBase.copy(this.headPos);
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
            _e.set(this.pitch, this.yaw, 0);
            this.gaze.set(0, 0, -1).applyEuler(_e);
        }
        this.lookPitch = Math.asin(clamp(this.gaze.y, -1, 1));
        const hl = Math.hypot(this.gaze.x, this.gaze.z);
        if (hl > 0.05) this.fwd.set(this.gaze.x / hl, 0, this.gaze.z / hl);
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
            _e.set(this.pitch, this.yaw, 0);
            this.camera.quaternion.setFromEuler(_e);
        }
    }

    animate(now) {
        requestAnimationFrame(t => this.animate(t));
        const dt = Math.min(Math.max((now - (this.lastTime || now)) / 1000, 0.001), 0.1);
        this.lastTime = now;
        const nowSec = now / 1000;

        const xr = this.renderer.xr.isPresenting;
        const phoneVR = this.stereoView.active && !xr;
        const vr = xr || phoneVR;

        if (phoneVR && this.phoneHead.update()) {
            this.headQuat.copy(this.phoneHead.quat);
            this.headPos.set(0, 1.6, 0);
            this.hasHead = true;
        }

        this.motion.update(nowSec, dt);
        const inp = this.input.poll(dt, xr ? this.renderer.xr.getSession() : null, nowSec, this.lookPitch);
        this.sound.update();

        if (inp.muteP) this.sound.toggleMute();
        if (inp.pauseP && !vr) this.togglePause();
        if (inp.recenterP) this.needRecenter = true;

        this.updateLook(inp, dt, vr);
        inp.fwdX = this.fwd.x;
        inp.fwdZ = this.fwd.z;

        if (this.state === 'title') {
            if (this.titleUI) {
                const m = this.motion;
                if (this.titleUI.meter) this.titleUI.meter.style.width = Math.min(100, m.level / 12 * 100) + '%';
                if (this.titleUI.steps) this.titleUI.steps.textContent = 'Steps: ' + m.stepCount;
                if (this.titleUI.jumps) this.titleUI.jumps.textContent = 'Hops: ' + m.jumpCount;
                if (this.titleUI.status) {
                    this.titleUI.status.textContent = m.hasSensor
                        ? 'Motion sensor OK: walk in place and hop to test it.'
                        : 'Waiting for motion sensors or tap screen to play.';
                }
            }
            if (inp.jumpP) this.startGame();
        } else if (this.state === 'dead') {
            if (inp.jumpP) this.restartStage();
        } else if (this.state === 'play') {
            this.bonus = Math.max(0, this.bonus - dt * 20);
            this.hud.setBonus(Math.floor(this.bonus));

            this.player.step(dt, inp);

            // Spawn barrels periodically from DK at top
            this.barrelTimer += dt;
            if (this.barrelTimer > 3.2) {
                this.barrelTimer = 0;
                this.barrels.push(new Barrel(this, 2, 18, -12, -4.5, 0));
            }

            this.barrels.forEach(b => b.update(dt));
            this.items.forEach(i => i.update(dt));
        }

        this.player.updateVisual(dt);
        this.placeCamera(dt, vr, phoneVR);

        if (phoneVR) {
            this.stereoView.render(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
