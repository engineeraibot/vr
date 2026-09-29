// Super Kart 64 VR — a Mario Kart 64 style race in the phone headset, steered with your hands.
import * as THREE from 'three';
import { initTextures } from './textures.js';
import { initModels, MAT, CHARACTERS, buildCockpitWheel, buildLakitu } from './models.js';
import { Track } from './track.js';
import { PlayerKart, CpuKart } from './karts.js';
import { HandWheel } from './hands.js';
import { Sound } from './audio.js';
import { Hud, ordinal, fmtTime } from './hud.js';
import { PhoneHead, StereoView } from './cardboard.js';

const SKY = 0x86c8ff;
const LAPS = 3;
const EYE = new THREE.Vector3(0, 1.18, 0.2);    // driver's eyes in kart space (kart faces -z)
const HEAD = new THREE.Vector3(0, 1.6, 0);      // phone headset: fixed head position, rotation only
const CPU_SKILL = [0.97, 0.95, 0.96, 0.93, 0.98, 0.94, 0.99];
const PLAYER_SLOT = 4;                          // start 5th on the grid
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const clamp = THREE.MathUtils.clamp;

class Game {
    constructor() {
        initTextures();
        initModels();
        this.isTouch = matchMedia('(pointer: coarse)').matches;
        this.isPhone = this.isTouch && !/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        r.setSize(window.innerWidth, window.innerHeight);
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFShadowMap;
        document.body.appendChild(r.domElement);
        this.clock = new THREE.Clock();

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(SKY);
        this.scene.fog = new THREE.Fog(SKY, 140, 460);
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 700);
        this.rig = new THREE.Group();
        this.rig.add(this.camera);
        this.scene.add(this.rig);
        this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6a8a4a, 1.6));
        const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
        sun.castShadow = true;
        const sm = this.isTouch ? 1024 : 2048;
        sun.shadow.mapSize.set(sm, sm);
        Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.03;
        this.scene.add(sun, sun.target);

        this.sound = new Sound();
        this.hands = new HandWheel();
        // In the headset the camera tilts with your head: remove that tilt from the steering.
        this.headRoll = 0;
        this.hands.rollFn = () => (this.inVR && this.hands.facing === 'environment' ? this.headRoll : 0);
        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(r);
        this.track = new Track();
        this.scene.add(this.track.group);

        this.player = new PlayerKart(this, CHARACTERS[0], { withWheel: false });
        this.cockpit = buildCockpitWheel();
        this.cockpit.group.position.set(0, 0.8, -0.42);
        this.cockpit.group.scale.setScalar(0.85);
        this.player.model.body.add(this.cockpit.group);
        // Dashboard screen with the live camera view, so you can see where your hands are in VR.
        const dash = this.dash = { canvas: Object.assign(document.createElement('canvas'), { width: 320, height: 240 }), t: 0 };
        dash.tex = new THREE.CanvasTexture(dash.canvas);
        dash.tex.colorSpace = THREE.SRGBColorSpace;
        dash.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.27), new THREE.MeshBasicMaterial({ map: dash.tex }));
        dash.mesh.position.set(-0.46, 0.84, -0.6);
        dash.mesh.rotation.set(-0.38, 0.5, 0, 'YXZ');
        this.player.model.body.add(dash.mesh);
        // Big screen in front of you for the hand check before the start lights.
        const big = this.big = {
            canvas: Object.assign(document.createElement('canvas'), { width: 480, height: 430 }),
            sub: Object.assign(document.createElement('canvas'), { width: 480, height: 360 }),
            t: 0,
        };
        big.ctx = big.canvas.getContext('2d');
        big.tex = new THREE.CanvasTexture(big.canvas);
        big.tex.colorSpace = THREE.SRGBColorSpace;
        big.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95 * 430 / 480), new THREE.MeshBasicMaterial({ map: big.tex }));
        big.mesh.position.set(0, 1.05, -1.1);
        big.mesh.visible = false;
        this.player.model.body.add(big.mesh);
        // Debug passthrough: the camera picture (and what the tracker sees) fills your view.
        const pass = this.pass = { canvas: Object.assign(document.createElement('canvas'), { width: 640, height: 480 }), t: 0 };
        pass.tex = new THREE.CanvasTexture(pass.canvas);
        pass.tex.colorSpace = THREE.SRGBColorSpace;
        pass.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ map: pass.tex, depthTest: false, depthWrite: false }));
        pass.mesh.renderOrder = 999;
        pass.mesh.position.z = -1;
        pass.mesh.visible = false;
        this.camera.add(pass.mesh);
        this.passthrough = new URLSearchParams(location.search).has('passthrough');
        this.cpus = CHARACTERS.slice(1).map((ch, i) => new CpuKart(this, ch, CPU_SKILL[i]));
        this.karts = [this.player, ...this.cpus];
        this.lakitu = buildLakitu();
        this.scene.add(this.lakitu.group);
        this.hud = new Hud(this);

        this.laps = LAPS;
        this.state = 'title';
        this.stateT = 0;
        this.raceTime = 0;
        this.position = PLAYER_SLOT + 1;
        this.fade = 0;
        this.fadeTarget = 0;
        this.view = 'first';
        this.keys = new Set();
        this.touches = new Map();
        this.tapQueued = false;
        this.headQuat = new THREE.Quaternion();
        this.yawOffset = 0;
        this.needRecenter = true;
        this.chasePos = new THREE.Vector3();
        this.handStatus = { text: '', color: '#fff' };
        this.ctl = { throttle: 0, steer: 0, brake: false, source: 'none', hands: 0 };
        this.respawnT = 0;
        this.wrongT = 0;
        this.bumpCd = 0;

        this.resetGrid();
        for (const c of this.cpus) c.speed = 15;
        this.setupUI();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop(() => this.frame());
        window.game = this; // handy for debugging from the console
    }

    get inVR() { return this.stereo.active; }

    // ------------------------------------------------------------------ UI

    setupUI() {
        const $ = id => document.getElementById(id);
        this.ui = {
            title: $('title'), camStatus: $('camStatus'), preview: $('handPreview'), vrStatus: $('vrStatus'),
        };
        $('enterVR').onclick = () => this.enterPhoneVR();
        $('play').onclick = () => this.playFlat();
        if (!this.isPhone) $('vrStatus').textContent = 'VR mode is made for a phone in a headset: open this page on your phone (https via ngrok).';
        const facing = $('camFacing');
        facing.value = this.isPhone ? 'environment' : 'user';
        $('camStart').onclick = () => {
            this.sound.unlock();
            this.hands.start(facing.value);
        };
        facing.onchange = () => { if (this.hands.status !== 'off') this.hands.start(facing.value); };
        const passBox = $('passthrough');
        passBox.checked = this.passthrough;
        passBox.onchange = () => { this.passthrough = passBox.checked; };
        const tracker = $('tracker');
        tracker.value = this.hands.delegate;
        tracker.onchange = () => this.hands.setDelegate(tracker.value);
        const swap = $('swap');
        swap.checked = this.hands.swap;
        swap.onchange = () => this.hands.setSwap(swap.checked);
        this.useHands = $('useHands');
        this.useHands.checked = true;
        const laps = $('laps');
        try { laps.value = localStorage.getItem('kart64.laps') || '3'; } catch { /* ignore */ }
        this.laps = parseInt(laps.value, 10) || 3;
        laps.onchange = () => {
            this.laps = parseInt(laps.value, 10) || 3;
            try { localStorage.setItem('kart64.laps', laps.value); } catch { /* ignore */ }
        };
        const viewer = $('viewer');
        viewer.value = this.stereo.viewerId;
        viewer.onchange = () => this.stereo.setViewer(viewer.value);
        $('title').addEventListener('pointerdown', () => { if (!this.phoneHead.listening) this.phoneHead.enable(); });
        this.phoneHead.enable();

        window.addEventListener('keydown', e => {
            if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
            this.keys.add(e.code);
            if (e.code === 'KeyC') this.view = this.view === 'first' ? 'chase' : 'first';
            if (e.code === 'KeyV') this.togglePassthrough();
            if (e.code === 'KeyM') this.sound.toggleMute();
            if (e.code === 'Enter' || e.code === 'Space') this.tapQueued = true;
            if (e.code === 'Enter' && this.state === 'title') this.playFlat();
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());
        const canvas = this.renderer.domElement;
        const touch = e => {
            e.preventDefault();
            this.touches.clear();
            for (const t of e.touches) this.touches.set(t.identifier, t.clientX / window.innerWidth);
        };
        canvas.addEventListener('touchstart', e => {
            touch(e);
            this.tapQueued = true;
            this.phoneHead.enable();
            // Double tap (the headset button twice) toggles the camera passthrough.
            const now = performance.now();
            if (now - (this.lastTap || 0) < 350) { this.togglePassthrough(); this.lastTap = 0; } else this.lastTap = now;
        }, { passive: false });
        canvas.addEventListener('touchmove', touch, { passive: false });
        canvas.addEventListener('touchend', touch, { passive: false });
        canvas.addEventListener('touchcancel', touch, { passive: false });
        canvas.addEventListener('mousedown', () => { this.tapQueued = true; });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });
    }

    togglePassthrough() {
        this.passthrough = !this.passthrough;
        const box = document.getElementById('passthrough');
        if (box) box.checked = this.passthrough;
        this.hud.message(this.passthrough ? 'PASSTHROUGH ON' : 'PASSTHROUGH OFF', 'Double tap to toggle', 1);
    }

    enterPhoneVR() {
        // Permission prompts first: requestFullscreen uses up the click.
        this.sound.unlock();
        this.phoneHead.enable();
        this.hands.start('environment');
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { this.wakeLock = l; }).catch(() => {});
        this.stereo.active = true;
        this.startRace();
    }

    exitPhoneVR() {
        this.stereo.active = false;
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.identity();
        this.onResize();
        this.toTitle();
    }

    playFlat() {
        this.sound.unlock();
        if (this.useHands.checked) this.hands.start(document.getElementById('camFacing').value);
        this.startRace();
    }

    toTitle() {
        this.setState('title');
        this.ui.title.classList.remove('hidden');
        this.sound.stopMusic();
        this.sound.stopEngine();
        this.hud.clearMessage();
        this.fade = this.fadeTarget = 0;
        this.resetGrid();
        for (const c of this.cpus) c.speed = 15;
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ------------------------------------------------------------------ race flow

    setState(s) {
        this.state = s;
        this.stateT = 0;
    }

    resetGrid() {
        const T = this.track;
        const order = [...this.cpus];
        order.splice(PLAYER_SLOT, 0, this.player);
        order.forEach((k, slot) => {
            const row = slot >> 1, col = slot & 1;
            k.resetRace(T.L - 6 - row * 8, col ? 3.6 : -3.6);
        });
        this.finishOrder = [];
        this.raceTime = 0;
        this.respawnT = 0;
        this.lakitu.group.visible = true;
    }

    startRace() {
        this.ui.title.classList.add('hidden');
        this.resetGrid();
        this.setState('countdown');
        this.needRecenter = true;
        this.fade = 1;
        this.fadeTarget = 0;
        this.sound.stopMusic();
        this.sound.startEngine();
        this.lastLap = 0;
        this.waitT = 0;
        this.handsOk = false;
        this.handsCheckT = 0;
        this.resultsShown = false;
        this.lakitu.lights.forEach(l => l.material.color.set(0x331111));
    }

    updateCountdown(dt) {
        // Wait for the hand tracker (model download) before the lights start.
        this.waitT = (this.waitT || 0) + dt;
        if (this.hands.status === 'loading' && this.waitT < 25) {
            this.stateT = 0;
            this.hud.message('GET READY', 'Starting the camera and hand tracking...', 0.2);
            return;
        }
        // Hand check: both hands must be seen for a second before the lights start.
        if (this.hands.status === 'running' && !this.handsOk) {
            this.stateT = 0;
            const both = this.ctl.hands === 2;
            this.handsCheckT = both ? this.handsCheckT + dt : Math.max(0, this.handsCheckT - dt * 0.5);
            this.hud.clearMessage();
            this.holdT = this.touches.size ? (this.holdT || 0) + dt : 0;
            if (this.handsCheckT > 1 || this.holdT > 1.2 || this.keys.has('Enter') || this.waitT > 45) {
                this.handsOk = true;
                this.sound.play('lap');
            }
            return;
        }
        const t = this.stateT;
        const lights = this.lakitu.lights;
        for (let i = 0; i < 3; i++) {
            const on = t > 0.8 + i;
            if (on && !lights[i].on) { lights[i].on = true; lights[i].material.color.set(0xff2a2a); this.sound.play('beep'); }
            if (!on) lights[i].on = false;
        }
        if (t < 0.8) {
            this.hud.message('GET READY', this.handsHint(), 0.2);
        } else if (t < 3.8) {
            this.hud.message(String(3 - Math.floor(t - 0.8)), this.handsHint(), 0.2);
        } else {
            lights.forEach(l => l.material.color.set(0x2aff4a));
            this.sound.play('go');
            this.sound.music(true);
            this.hud.message('GO!', '', 1);
            this.needRecenter = true; // you are looking at Lakitu, straight ahead
            this.setState('race');
        }
    }

    handsHint() {
        if (this.hands.status === 'running') {
            return this.inVR
                ? 'Both hands up in front of you, open, palms facing you.\nThe screen on the dashboard shows what the camera sees.'
                : 'Raise both hands like holding a wheel';
        }
        if (this.inVR) return 'No camera: tilt your head to steer, hold the screen to drive';
        if (this.isTouch) return 'Hold the left / right side of the screen to drive';
        return 'Arrow keys: drive and steer';
    }

    updateRace(dt, ctl) {
        const P = this.player;
        this.raceTime += dt;
        if (this.respawnT > 0) {
            this.respawnT -= dt;
            if (!this.respawned && this.respawnT < 0.9) {
                this.respawned = true;
                P.place(this.track.respawnS, 0);
                this.fadeTarget = 0;
                this.sound.play('lakitu');
            }
        } else {
            const ev = {};
            const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
            for (let i = 0; i < n; i++) P.step(h, P.finished ? P.autopilot() : ctl, ev);
            this.handleEvents(ev);
        }
        const lead = Math.max(...this.karts.map(k => k.progress));
        for (const c of this.cpus) {
            c.step(dt, Math.max(P.progress, lead - 150));
            if (!c.finished && c.lap > this.laps) { c.finished = true; c.finishTime = this.raceTime; this.finishOrder.push(c); }
        }
        this.collide(dt);
        this.updatePosition();

        this.wrongT = P.wrongWay && !P.finished ? this.wrongT + dt : 0;
        if (this.wrongT > 1) {
            this.hud.message('WRONG WAY!', '', 0.3);
            if (this.wrongT < 1 + dt * 1.5) this.sound.play('wrong');
        }
        if (!P.finished && this.hands.status === 'running' && ctl.hands === 0 && this.state === 'race' && this.respawnT <= 0) {
            this.hud.message('STOPPED', 'Raise both hands to drive', 0.3);
        }
    }

    handleEvents(ev) {
        const P = this.player;
        if (ev.boost) this.sound.play('boost');
        if (ev.land) this.sound.play('land');
        if (ev.bump) this.sound.play('bump');
        if (ev.scrape && Math.random() < 0.1) this.sound.play('scrape');
        if (ev.splash && this.respawnT <= 0) {
            this.respawnT = 1.8;
            this.respawned = false;
            this.fadeTarget = 1;
            this.sound.play('splash');
            this.hud.message('SPLASH!', 'Lakitu will fish you out', 1.5);
        }
        if (ev.lap && P.lap > this.lastLap) {
            this.lastLap = P.lap;
            if (P.lap > 1) P.lapTimes.push(this.raceTime - (P.lapStart || 0));
            P.lapStart = this.raceTime;
            if (P.lap === this.laps && this.laps > 1) {
                this.sound.play('finalLap');
                this.sound.tempo = 1.12;
                this.hud.message('FINAL LAP!', '', 1.6);
            } else if (P.lap > this.laps && !P.finished) {
                P.finished = true;
                P.finishTime = this.raceTime;
                this.finishOrder.push(P);
                this.updatePosition();
                this.sound.stopMusic();
                this.sound.play('finish');
                this.hud.message('FINISH!', ordinal(this.position) + ' PLACE', 2.5);
                this.setState('finished');
            } else if (P.lap > 1) {
                this.sound.play('lap');
                this.hud.message(`LAP ${P.lap}`, '', 1.2);
            }
        }
    }

    updatePosition() {
        const sorted = [...this.karts].sort((a, b) => {
            const ia = this.finishOrder.indexOf(a), ib = this.finishOrder.indexOf(b);
            if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            return b.progress - a.progress;
        });
        this.standings = sorted;
        this.position = sorted.indexOf(this.player) + 1;
    }

    collide(dt) {
        const P = this.player, T = this.track, q = {};
        this.bumpCd -= dt;
        for (const c of this.cpus) {
            const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz);
            if (d > 1.7 || d < 1e-3 || Math.abs(c.y - P.y) > 1.2) continue;
            const nx = dx / d, nz = dz / d, push = 1.7 - d;
            P.x -= nx * push * 0.6;
            P.z -= nz * push * 0.6;
            T.sampleAt(c.s, q);
            const side = nx * q.rx + nz * q.rz;
            c.lat += side * push * 0.5;
            c.laneTarget = c.lat + Math.sign(side || 1) * 1.5;
            const ahead = -Math.sin(P.heading) * nx - Math.cos(P.heading) * nz;
            if (ahead > 0.5) P.speed *= 0.85; else c.speed *= 0.93;
            if (this.bumpCd <= 0) { this.sound.play('bump'); this.bumpCd = 0.4; }
        }
        for (let i = 0; i < this.cpus.length; i++) {
            for (let j = i + 1; j < this.cpus.length; j++) {
                const a = this.cpus[i], b = this.cpus[j];
                if (Math.abs(T.delta(a.s, b.s)) < 2.4 && Math.abs(a.lat - b.lat) < 1.8) {
                    const behind = T.delta(a.s, b.s) > 0 ? a : b;
                    const other = behind === a ? b : a;
                    behind.laneTarget = clamp(other.lat + (behind.lat <= other.lat ? -2.2 : 2.2), -6, 6);
                    behind.speed = Math.min(behind.speed, other.speed);
                }
            }
        }
    }

    updateFinished(dt, ctl) {
        this.updateRace(dt, ctl);
        if (this.stateT > 3 && !this.resultsShown) {
            this.resultsShown = true;
            this.handsDown = false;
            this.bothT = 0;
            const P = this.player;
            const best = P.lapTimes.length ? Math.min(...P.lapTimes) : 0;
            const names = this.standings.map((k, i) => `${i + 1} ${k === P ? 'YOU' : k.name}`);
            this.hud.message(`${ordinal(this.position)} PLACE!`,
                `TIME ${fmtTime(P.finishTime)}   BEST LAP ${fmtTime(best)}\n\n${names.slice(0, 4).join('  ')}\n${names.slice(4).join('  ')}\n\n` +
                (this.hands.status === 'running' ? 'Lower your hands, then raise both to race again' : this.isTouch ? 'Tap to race again' : 'Press ENTER to race again'));
        }
        if (this.resultsShown) {
            if (ctl.hands === 0) this.handsDown = true;
            this.bothT = this.handsDown && ctl.hands === 2 ? this.bothT + dt : 0;
            if (this.bothT > 1.2 || (this.tapQueued && this.stateT > 4)) this.startRace();
        }
    }

    // ------------------------------------------------------------------ controls

    getControls(now) {
        const k = this.keys;
        let throttle = 0, steer = 0, source = 'none', hands = -1;
        const h = this.hands.controls(now);
        if (h) {
            throttle = h.throttle;
            steer = h.steer;
            hands = h.hands;
            source = 'hands';
        } else if (this.inVR) {
            // No camera: tilt your head to steer, hold the screen / headset button to drive.
            const roll = this.headRoll;
            steer = Math.abs(roll) < 0.06 ? 0 : clamp((roll - Math.sign(roll) * 0.06) / 0.35, -1, 1);
            throttle = this.touches.size ? 1 : 0;
            source = 'tilt';
        } else if (this.touches.size) {
            let l = false, r = false;
            for (const x of this.touches.values()) { if (x < 0.5) l = true; else r = true; }
            throttle = 1;
            steer = l && r ? 0 : l ? -1 : 1;
            source = 'touch';
        }
        const kbSteer = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
        const kbGas = k.has('ArrowUp') || k.has('KeyW') || k.has('Space');
        if (kbSteer || kbGas) { steer = kbSteer || steer; throttle = kbGas ? 1 : throttle; source = 'keys'; }
        for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
            if (!gp || !gp.connected) continue;
            const ax = gp.axes[0] || 0;
            const gas = (gp.buttons[0] && gp.buttons[0].pressed) || (gp.buttons[7] && gp.buttons[7].value > 0.2);
            if (Math.abs(ax) > 0.15 || gas) { steer = Math.abs(ax) > 0.15 ? ax : steer; throttle = gas ? 1 : throttle; source = 'pad'; }
        }
        const brake = k.has('ArrowDown') || k.has('KeyS');
        return { throttle, steer, brake, source, hands };
    }

    updateHandStatus(ctl) {
        const hs = this.handStatus;
        const st = this.hands.status;
        if (ctl.source === 'hands') {
            if (ctl.hands === 2) { hs.text = 'HANDS OK'; hs.color = '#7dff6a'; }
            else if (ctl.hands === 1) { hs.text = 'ONE HAND'; hs.color = '#ffd83a'; }
            else { hs.text = 'RAISE HANDS'; hs.color = '#ff6a6a'; }
        } else if (st === 'loading') { hs.text = 'CAMERA...'; hs.color = '#ffffff'; }
        else if (st === 'error') { hs.text = 'NO CAMERA'; hs.color = '#ff6a6a'; }
        else if (ctl.source === 'tilt') { hs.text = 'TILT + HOLD'; hs.color = '#ffffff'; }
        else { hs.text = ctl.source === 'none' ? '' : ctl.source.toUpperCase(); hs.color = '#ffffff'; }
    }

    // ------------------------------------------------------------------ main loop

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const now = performance.now();
        this.stateT += dt;
        if (this.inVR && this.phoneHead.update()) {
            this.headQuat.copy(this.phoneHead.quat);
            _v.set(1, 0, 0).applyQuaternion(this.headQuat);
            this.headRoll = -Math.asin(clamp(_v.y, -1, 1)); // clockwise = right ear down
        }
        this.hands.update(now, dt);
        this.sound.update();
        const ctl = this.ctl = this.getControls(now / 1000);
        this.updateHandStatus(ctl);

        switch (this.state) {
            case 'title':
                for (const c of this.cpus) c.step(dt, c.progress);
                this.updateTitle();
                break;
            case 'countdown':
                this.updateCountdown(dt);
                break;
            case 'race':
                this.updateRace(dt, ctl);
                break;
            case 'finished':
                this.updateFinished(dt, ctl);
                break;
        }
        this.tapQueued = false;
        if (this.state !== 'title') {
            const P = this.player;
            const throttle = P.finished ? 0.8 : ctl.throttle;
            this.sound.setEngine(P.speed, this.state === 'countdown' ? ctl.throttle : throttle, P.boostT > 0);
        }

        this.animate(dt);
        this.placeCamera(dt);
        this.hud.update();
        if (this.inVR) this.stereo.render(this.scene, this.camera);
        else this.renderer.render(this.scene, this.camera);
    }

    updateTitle() {
        if (this.hands.status !== 'off') this.hands.drawPreview(this.ui.preview);
        const h = this.hands;
        this.ui.camStatus.textContent = h.status === 'running'
            ? `Camera OK (${h.facing === 'environment' ? 'back' : 'front'}). Tracker ${h.activeDelegate}: ${Math.round(h.rate)} checks/s`
            : h.status === 'loading' ? 'Starting camera and downloading the hand model (~10 MB)...'
                : h.status === 'error' ? 'Camera problem: ' + h.error : '';
    }

    animate(dt) {
        const t = this.clock.elapsedTime;
        this.track.animate(t);
        for (const k of this.karts) k.sync(dt, t);
        this.fade += clamp(this.fadeTarget - this.fade, -3 * dt, 3 * dt);

        // Cockpit: the wheel turns with your steering and the gloves show your hands.
        const P = this.player, ctl = this.ctl;
        const fp = this.inVR || (this.view === 'first' && this.state !== 'title');
        P.model.driver.visible = !fp;
        this.cockpit.group.visible = true;
        this.cockpit.wheel.rotation.z = -(P.finished ? P.autopilot().steer : ctl.steer) * 1.4;
        const seen = ctl.source !== 'hands' ? 2 : ctl.hands;
        this.cockpit.gloves[0].visible = seen >= 1;
        this.cockpit.gloves[1].visible = seen >= 2;
        const big = this.big;
        big.mesh.visible = this.state === 'countdown' && !this.handsOk && this.hands.status === 'running';
        big.t -= dt;
        if (big.mesh.visible && big.t <= 0) {
            big.t = 1 / 15;
            this.drawHandCheck();
        }
        this.stereo.lite = this.hands.status === 'running' || this.hands.status === 'loading';
        const pass = this.pass;
        pass.mesh.visible = this.passthrough && this.state !== 'title' && this.hands.status !== 'off';
        pass.t -= dt;
        if (pass.mesh.visible && pass.t <= 0) {
            pass.t = 1 / 30;
            this.hands.drawPreview(pass.canvas, { fit: true, dim: false, label: 'PASSTHROUGH - double tap to close' });
            pass.tex.needsUpdate = true;
            // Size the picture to the camera's field of view (~66 degrees wide, wider when zoomed out).
            const w = 2 * Math.tan(THREE.MathUtils.degToRad(33)) / Math.min(1, this.hands.zoom || 1);
            pass.mesh.scale.set(w, w * pass.canvas.height / pass.canvas.width, 1);
        }
        const dash = this.dash;
        dash.mesh.visible = fp && this.hands.status !== 'off' && !big.mesh.visible;
        dash.t -= dt;
        if (dash.mesh.visible && dash.t <= 0) {
            dash.t = 1 / 15;
            this.hands.drawPreview(dash.canvas);
            dash.tex.needsUpdate = true;
        }

        // Lakitu hangs over the start line, then flies away.
        const L = this.lakitu.group;
        const q = this.track.sampleAt(4, {});
        let y = 4.6 + Math.sin(t * 2) * 0.15;
        if (this.state === 'race' || this.state === 'finished') {
            const k = Math.min(1, this.stateT / 2.5);
            y += (this.state === 'race' ? k * k * 40 : 40);
            L.visible = y < 40;
        } else L.visible = true;
        L.position.set(q.x - q.rx * 2.5, y, q.z - q.rz * 2.5);
        L.rotation.y = Math.atan2(-q.tx, -q.tz) + Math.PI;

        const sx = P.x, sz = P.z;
        this.sun.position.set(sx + 30, 60, sz + 20);
        this.sun.target.position.set(sx, 0, sz);
    }

    drawHandCheck() {
        const b = this.big, c = b.ctx;
        this.hands.drawPreview(b.sub);
        c.fillStyle = '#10204a';
        c.fillRect(0, 0, 480, 430);
        c.drawImage(b.sub, 0, 0);
        const both = this.ctl.hands === 2;
        c.textAlign = 'center';
        c.fillStyle = both ? '#7dff6a' : '#ffd83a';
        c.font = '17px "Press Start 2P", monospace';
        c.fillText(both ? 'GREAT, HOLD THEM THERE' : 'SHOW BOTH HANDS', 240, 386);
        c.fillStyle = '#fff';
        c.font = '9px "Press Start 2P", monospace';
        c.fillText('Chin height, 30-50 cm away, palms facing you. Hold screen: skip', 240, 408);
        c.fillStyle = 'rgba(255,255,255,0.2)';
        c.fillRect(40, 418, 400, 6);
        c.fillStyle = '#7dff6a';
        c.fillRect(40, 418, 400 * Math.min(1, this.handsCheckT), 6);
        b.tex.needsUpdate = true;
    }

    placeCamera(dt) {
        const P = this.player;
        if (this.inVR) {
            if (this.needRecenter) {
                this.needRecenter = false;
                _v.set(0, 0, -1).applyQuaternion(this.headQuat);
                this.yawOffset = -Math.atan2(-_v.x, -_v.z);
            }
            const yaw = P.heading + this.yawOffset;
            _v.copy(EYE).applyAxisAngle(UP, P.heading).add(_v2.set(P.x, P.y, P.z));
            this.rig.position.set(_v.x, _v.y - HEAD.y, _v.z);
            this.rig.rotation.set(0, yaw, 0);
            this.camera.position.copy(HEAD);
            this.camera.quaternion.copy(this.headQuat);
            return;
        }
        this.rig.position.set(0, 0, 0);
        this.rig.rotation.set(0, 0, 0);
        if (this.view === 'first' && this.state !== 'title') {
            _v.copy(EYE).applyAxisAngle(UP, P.heading).add(_v2.set(P.x, P.y, P.z));
            this.camera.position.copy(_v);
            _e.set(-0.1 + P.pitch * 0.5, P.heading, 0);
            this.camera.quaternion.setFromEuler(_e);
            return;
        }
        const K = this.state === 'title' ? this.cpus[0] : P;
        _v.set(0, 2.8, 7).applyAxisAngle(UP, K.heading).add(_v2.set(K.x, K.y, K.z));
        if (this.chasePos.distanceTo(_v) > 30) this.chasePos.copy(_v);
        this.chasePos.lerp(_v, 1 - Math.exp(-dt * 6));
        this.camera.position.copy(this.chasePos);
        _v.set(0, 1, -5).applyAxisAngle(UP, K.heading).add(_v2.set(K.x, K.y, K.z));
        this.camera.lookAt(_v);
    }
}

new Game();
