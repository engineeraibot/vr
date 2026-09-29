// Crazy Coaster VR — a roller coaster for a phone in a Cardboard headset.
// Look around with your head, pop balloons by looking at them, tap to throw your hands up.
import * as THREE from 'three';
import { Track } from './track.js';
import { World } from './world.js';
import { Train } from './train.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { PhoneHead, StereoView } from './cardboard.js';

const G = 9.81;
const DRAG = 0.0016;          // air drag: a = DRAG * v^2
const ROLLING = 0.2;          // wheel friction, m/s^2
const MIN_V = 5.5;            // the train never stalls (so it can't roll back)
const LAUNCH_ACC = 17;        // ~1.7 g
const START_S = 16;           // where the train waits in the station
const GAZE_COS = Math.cos(THREE.MathUtils.degToRad(6.5));
const GAZE_DIST = 55;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const clamp = THREE.MathUtils.clamp;

const MESSAGES = {
    lift: ['HERE WE GO...', 'Look around! Pop balloons by\nlooking at them. Tap = hands up!', 3.5],
    crest: ['DON\'T LOOK DOWN', '', 1.6],
    drop: ['AAAAAAAHHH!!!', '97 degree drop', 2],
    overbank: ['OVERBANKED!', '', 1.6],
    loop: ['LOOP!', '', 1.4],
    corkscrew: ['CORKSCREW!', '', 1.4],
    axes: ['DUCK!!!', 'Giant swinging axes', 1.8],
    tophat: ['TO SPACE!', '', 1.6],
    twist: ['WHEEEEE!', '', 1.4],
    ramp: ['THE TRACK IS BROKEN!', 'Oh no', 1.8],
    jump: ['JUMP!!!', 'Zero gravity', 1.6],
    roll: ['BARREL ROLL!', '', 1.4],
    boost: ['TURBO BOOST!', '', 1.4],
    helix: ['HELIX!', '', 1.4],
    brakes: ['WHAT A RIDE!', '', 2],
};

class Game {
    constructor() {
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
        this.scene.background = new THREE.Color(0x79c4ff);
        this.scene.fog = new THREE.Fog(0x79c4ff, 260, 1500);
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 5000);
        this.rig = new THREE.Group();       // follows the front car
        this.headBase = new THREE.Group();  // recentering yaw
        this.rig.add(this.headBase);
        this.headBase.add(this.camera);
        this.scene.add(this.rig);
        this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a7a4a, 1.5));
        const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
        sun.castShadow = true;
        const sm = this.isTouch ? 1024 : 2048;
        sun.shadow.mapSize.set(sm, sm);
        Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.04;
        this.scene.add(sun, sun.target);

        this.track = new Track();
        this.scene.add(this.track.group);
        this.endPos = this.track.frameAt(this.track.tags.end.s0, new THREE.Vector3());
        this.world = new World(this.scene, this.track);
        this.train = new Train(this.track, this.scene, this.rig);
        this.sound = new Sound();
        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(r);
        this.hud = new Hud(this);

        this.state = 'title';
        this.stateT = 0;
        this.fade = 0;
        this.fadeTarget = 0;
        this.headQuat = new THREE.Quaternion();
        this.needRecenter = true;
        this.look = { yaw: 0, pitch: 0, drag: null };
        this.view = 'ride';
        this.chasePos = new THREE.Vector3();
        this.handsUp = false;
        this.keys = new Set();
        this.shake = 0;
        this.shakeOn = true;
        this.gazeHot = false;
        this.slowT = 0;
        this.ride = { s: START_S, v: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), gv: 1, launch: null, launchT: 0 };
        this.resetRide();
        this.setupUI();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop(() => this.frame());
        window.game = this; // handy for debugging from the console
    }

    get inVR() { return this.stereo.active; }

    // ------------------------------------------------------------------ UI

    setupUI() {
        const $ = id => document.getElementById(id);
        this.ui = { title: $('title'), vrStatus: $('vrStatus') };
        $('enterVR').onclick = () => this.enterPhoneVR();
        $('play').onclick = () => this.playFlat();
        if (!this.isPhone) $('vrStatus').textContent = 'VR mode is made for a phone in a Cardboard headset: open this page on your phone (https, e.g. via ngrok).';
        const viewer = $('viewer');
        viewer.value = this.stereo.viewerId;
        viewer.onchange = () => this.stereo.setViewer(viewer.value);
        const shake = $('shake');
        try { this.shakeOn = localStorage.getItem('coaster.shake') !== '0'; } catch { /* ignore */ }
        shake.checked = this.shakeOn;
        shake.onchange = () => {
            this.shakeOn = shake.checked;
            try { localStorage.setItem('coaster.shake', shake.checked ? '1' : '0'); } catch { /* ignore */ }
        };
        this.musicBox = $('music');
        $('title').addEventListener('pointerdown', () => { if (!this.phoneHead.listening) this.phoneHead.enable(); });
        this.phoneHead.enable();

        window.addEventListener('keydown', e => {
            if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
            if (e.code === 'Space') { e.preventDefault(); this.press(); }
            if (e.code === 'Enter' && this.state === 'title') this.playFlat();
            if (e.code === 'KeyC') this.view = this.view === 'ride' ? 'chase' : 'ride';
            if (e.code === 'KeyM') this.sound.toggleMute();
            if (e.code === 'KeyR') this.needRecenter = true;
            this.keys.add(e.code);
        });
        window.addEventListener('keyup', e => {
            this.keys.delete(e.code);
            if (e.code === 'Space') this.release();
        });
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', e => {
            this.phoneHead.enable();
            if (!this.inVR) this.look.drag = { x: e.clientX, y: e.clientY, yaw: this.look.yaw, pitch: this.look.pitch, moved: false };
            this.press();
            // Double tap (the headset button twice) recenters the view.
            const now = performance.now();
            if (now - (this.lastTap || 0) < 350) { this.needRecenter = true; this.lastTap = 0; } else this.lastTap = now;
        });
        window.addEventListener('pointermove', e => {
            const d = this.look.drag;
            if (!d) return;
            this.look.yaw = d.yaw + (e.clientX - d.x) * 0.006;
            this.look.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.006, -1.4, 1.4);
        });
        const up = () => { this.look.drag = null; this.release(); };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });
    }

    // Screen / headset button / space: hands up and scream; also starts the ride.
    press() {
        this.sound.unlock();
        if (this.state === 'station' && this.stateT > 0.6) { this.dispatch(); return; }
        if (this.state === 'finished' && this.stateT > 2.5) { this.rideAgain(); return; }
        if (this.state === 'ride') {
            this.handsUp = true;
            const now = this.clock.elapsedTime;
            if (now - (this.lastScream || 0) > 1.6) {
                this.lastScream = now;
                this.sound.scream(3, 1.6, Math.random() < 0.5);
            }
        }
    }

    release() { this.handsUp = false; }

    enterPhoneVR() {
        // Permission prompt first: requestFullscreen uses up the click.
        this.sound.unlock();
        this.phoneHead.enable();
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { this.wakeLock = l; }).catch(() => {});
        this.stereo.active = true;
        this.toStation();
    }

    exitPhoneVR() {
        this.stereo.active = false;
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.onResize();
        this.toTitle();
    }

    playFlat() {
        this.sound.unlock();
        this.toStation();
    }

    toTitle() {
        this.setState('title');
        this.ui.title.classList.remove('hidden');
        this.sound.stopMusic();
        this.hud.clearMessage();
        this.fade = this.fadeTarget = 0;
        this.resetRide();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ------------------------------------------------------------------ ride flow

    setState(s) {
        this.state = s;
        this.stateT = 0;
    }

    resetRide() {
        const r = this.ride;
        r.s = START_S;
        r.v = 0;
        r.gv = 1;
        r.launch = null;
        r.launchT = 0;
        r.dispatched = false;
        this.stats = { top: 0, maxG: 1, minG: 1, air: 0, time: 0 };
        this.score = 0;
        this.nextTag = 0;
        this.splashed = false;
        this.fireworks = false;
        this.world.resetBalloons();
    }

    toStation() {
        this.ui.title.classList.add('hidden');
        this.resetRide();
        this.setState('station');
        this.needRecenter = true;
        this.look.yaw = this.look.pitch = 0;
        this.fade = 1;
        this.fadeTarget = 0;
        if (this.musicBox.checked) this.sound.music(true);
    }

    dispatch() {
        if (this.state !== 'station') return;
        this.setState('ride');
        this.ride.dispatched = true;
        this.needRecenter = true;
        this.sound.play('bell');
        this.hud.message('KEEP YOUR ARMS INSIDE', '...or don\'t', 2);
    }

    rideAgain() {
        this.fadeTarget = 1;
        this.setState('reset');
    }

    finish() {
        this.setState('finished');
        this.fireworks = true;
        this.sound.play('fanfare');
        this.sound.scream(8, 1.5, true);
        const st = this.stats, w = this.world;
        this.hud.message('YOU SURVIVED!',
            `Top speed ${Math.round(st.top * 3.6)} km/h   Max ${st.maxG.toFixed(1)} G\n` +
            `Airtime ${st.air.toFixed(1)} s   Min ${st.minG.toFixed(1)} G\n` +
            `Balloons ${this.score} / ${w.balloonTotal}   ${this.rank()}\n` +
            `Tap to ride again`, 9999, '#3bff6a');
    }

    rank() {
        const k = this.score / this.world.balloonTotal;
        return k > 0.9 ? 'BALLOON LEGEND!' : k > 0.6 ? 'SHARP EYES!' : k > 0.3 ? 'NOT BAD!' : 'LOOK AROUND MORE!';
    }

    // ------------------------------------------------------------------ physics

    step(h) {
        const r = this.ride, T = this.track;
        const sg = T.segmentAt(r.s);
        T.frameAt(r.s, _v, _q);
        const fy = _v2.set(0, 0, -1).applyQuaternion(_q).y;
        let a = -G * fy - DRAG * r.v * r.v - ROLLING;
        let floor = MIN_V;
        switch (sg.kind) {
            case 'station':
                if (!r.dispatched) { r.v = 0; return; }
                a = clamp((7 - r.v) * 2, -3, 3);
                floor = 0;
                break;
            case 'drive':
                a = clamp((sg.speed - r.v) * 2, -3, 3);
                floor = 0;
                break;
            case 'chain':
                floor = sg.speed;
                break;
            case 'boost':
                if (r.v < sg.speed) a = 9;
                break;
            case 'brake':
                if (r.v > sg.speed) a = -7;
                floor = sg.speed;
                break;
            case 'stop': {
                const stopAt = sg.s0 + 14;
                a = -r.v * r.v / (2 * Math.max(0.3, stopAt - r.s));
                floor = 0;
                if (r.s >= stopAt - 0.05 || r.v < 0.2) { r.v = 0; if (this.state === 'ride') this.finish(); return; }
                break;
            }
            case 'launch': {
                // Stop in the dark, count down, then the linear motors fire.
                if (!r.launch) {
                    r.launch = 'brake';
                    if (this.state !== 'title') { this.sound.play('roar'); this.hud.message('THE MONSTER ATE YOU!', '', 1.8, '#ff3b3b'); }
                }
                const stopAt = sg.s0 + 24;
                if (r.launch === 'brake') {
                    a = -r.v * r.v / (2 * Math.max(0.3, stopAt - r.s));
                    floor = 0;
                    if (r.s >= stopAt - 0.05 || r.v < 0.3) { r.v = 0; r.launch = 'count'; r.launchT = 0; return; }
                } else if (r.launch === 'count') {
                    r.v = 0;
                    return;
                } else if (r.launch === 'go' && r.v < sg.speed) a = LAUNCH_ACC;
                break;
            }
        }
        r.v = clamp(r.v + a * h, floor, 70);
        r.s = Math.min(r.s + r.v * h, T.length - 0.01);
        r.at = a;
    }

    updateRide(dt) {
        const r = this.ride;
        const n = Math.ceil(dt / 0.01);
        for (let i = 0; i < n; i++) this.step(dt / n);
        const T = this.track;
        T.frameAt(r.s, r.pos, r.quat);

        // Vertical g-force felt by the rider: (acceleration - gravity) along the car's up axis.
        const i = T.index(r.s);
        _v.set(T.K[i * 3], T.K[i * 3 + 1], T.K[i * 3 + 2]).multiplyScalar(r.v * r.v);
        _v.addScaledVector(_v2.set(0, 0, -1).applyQuaternion(r.quat), r.at || 0);
        _v.y += G;
        const up = _v2.set(0, 1, 0).applyQuaternion(r.quat);
        const gv = _v.dot(up) / G;
        r.gv += (gv - r.gv) * (1 - Math.exp(-dt * 8));

        if (this.state === 'ride') {
            const st = this.stats;
            st.time += dt;
            st.top = Math.max(st.top, r.v);
            if (r.v > 3) {
                st.maxG = Math.max(st.maxG, r.gv);
                st.minG = Math.min(st.minG, r.gv);
                if (r.gv < 0.3) st.air += dt;
            }
        }

        // Launch countdown.
        if (r.launch === 'count') {
            const before = r.launchT;
            r.launchT += dt;
            for (const [t, txt] of [[0.8, '3'], [1.8, '2'], [2.8, '1']]) {
                if (before < t && r.launchT >= t) { this.sound.play('beep'); this.hud.message(txt, '', 0.9, '#ff3b3b'); }
            }
            if (r.launchT >= 3.8) {
                r.launch = 'go';
                this.sound.play('go');
                this.sound.scream(8, 2.6);
                this.hud.message('LAUNCH!!!', '0 to 170 km/h', 1.6, '#3bff6a');
                this.shake = 1;
            }
        }

        // Tagged moments along the track.
        const segs = T.segments;
        while (this.nextTag < segs.length && segs[this.nextTag].s0 <= r.s) {
            this.onSegment(segs[this.nextTag]);
            this.nextTag++;
        }
        const sp = T.tags.splash;
        if (!this.splashed && r.s > (sp.s0 + sp.s1) / 2) {
            this.splashed = true;
            this.sound.play('splash');
            this.shake = 0.8;
            const w = this.world;
            for (let k = 0; k < 4; k++) {
                _v.copy(r.pos).add(_v2.set(0, 0, -3 - k * 3).applyQuaternion(r.quat));
                _v.y = 0.3;
                w.confetti.burst(_v, 60, { speed: 6, up: 9, colors: [0xffffff, 0xbfe6ff, 0x7cc4ff], life: 1.8, gravity: 12, drag: 0.6 });
            }
            this.hud.message('SPLASH!', '', 1.2, '#7cc4ff');
        }
        if (this.state === 'ride' && r.gv < 0.1 && r.v > 8 && this.clock.elapsedTime - (this.lastAir || 0) > 6) {
            this.lastAir = this.clock.elapsedTime;
            if (!this.hud.msg) this.hud.message('AIRTIME!', '', 1, '#ff7ad9');
        }
    }

    onSegment(sg) {
        const m = MESSAGES[sg.tag];
        if (m) this.hud.message(m[0], m[1], m[2]);
        const s = this.sound;
        switch (sg.tag) {
            case 'drop': s.scream(9, 3.2); this.shake = 0.5; break;
            case 'tophat': s.scream(6, 2.2, true); break;
            case 'twist': s.scream(6, 2.4); break;
            case 'jump': s.scream(8, 2.8, true); break;
            case 'land': {
                s.play('land');
                this.shake = 1.4;
                this.world.sparks.burst(this.ride.pos.clone().add(_v.set(0, -1.1, 0).applyQuaternion(this.ride.quat)), 80,
                    { speed: 9, colors: [0xffe080, 0xff9020, 0xffffff], life: 0.8, gravity: 12, drag: 1 });
                this.hud.message('WE MADE IT?!', '', 1.4, '#3bff6a');
                break;
            }
            case 'loop': case 'roll': case 'corkscrew': s.scream(4, 1.8, true); break;
            case 'overbank': s.scream(4, 2); break;
            case 'brakes': this.fireworks = true; break;
        }
    }

    excitement() {
        const r = this.ride;
        if (this.state !== 'ride') return this.state === 'finished' ? 1 : 0;
        const fy = _v.set(0, 0, -1).applyQuaternion(r.quat).y;
        let e = 0;
        if (r.v > 20) e = (r.v - 20) / 15;
        if (fy < -0.5 && r.v > 12) e = 1;
        if (r.gv < 0.4 && r.v > 8) e = 1;
        if (r.launch === 'go' && this.track.segmentAt(r.s).kind === 'launch') e = 1;
        return clamp(e, 0, 1);
    }

    // ------------------------------------------------------------------ gaze popping

    updateGaze() {
        if (this.state !== 'ride' && this.state !== 'station') { this.gazeHot = false; return; }
        const cam = this.camera;
        cam.getWorldPosition(_v);
        const dir = _v2.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q));
        let hot = false;
        const d = new THREE.Vector3();
        for (const b of this.world.balloons) {
            if (!b.alive) continue;
            d.subVectors(b.pos, _v);
            const dist = d.length();
            if (dist > GAZE_DIST) continue;
            const cos = d.dot(dir) / dist;
            const near = dist < 2.6;
            if (cos > GAZE_COS * 0.985) hot = true;
            if ((cos > GAZE_COS || near) && this.state === 'ride') {
                this.world.pop(b);
                this.score += b.value;
                this.sound.play(b.star ? 'star' : 'pop', this.score);
                if (b.star) this.hud.message('GOLD STAR! +5', '', 1.1, '#ffd700');
            }
        }
        this.gazeHot = hot;
    }

    // ------------------------------------------------------------------ main loop

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.stateT += dt;
        const t = this.clock.elapsedTime;
        if (this.phoneHead.update()) this.headQuat.copy(this.phoneHead.quat);
        this.sound.update();

        switch (this.state) {
            case 'title':
                this.titleCam(t);
                break;
            case 'station': {
                const left = Math.ceil(7 - this.stateT);
                if (!this.hud.msg || this.hud.msg.title.startsWith('RIDE STARTS')) {
                    this.hud.message(`RIDE STARTS IN ${left}`, this.inVR ? 'Tap the screen to go now\nLook at balloons to pop them' : 'Click / space to go now. Drag to look around\nLook at balloons to pop them', 0.3, '#fff');
                }
                if (this.stateT >= 7) this.dispatch();
                this.updateRide(dt);
                break;
            }
            case 'ride':
                this.updateRide(dt);
                break;
            case 'finished':
                if (this.stateT > 20) this.rideAgain();
                break;
            case 'reset':
                if (this.fade > 0.99) {
                    this.hud.clearMessage();
                    this.toStation();
                }
                break;
        }
        if (this.state !== 'title') {
            const r = this.ride, sg = this.track.segmentAt(r.s);
            this.sound.setRide(r.v, dt, { chain: sg.kind === 'chain' && r.v > 0.5, tunnel: !!sg.tunnel, gap: !!sg.gap });
        } else this.sound.setRide(0, dt);

        this.fade += clamp(this.fadeTarget - this.fade, -2 * dt, 2 * dt);
        if (this.state !== 'reset' && this.fadeTarget === 1 && this.fade >= 1) this.fadeTarget = 0;
        this.animate(t, dt);
        this.placeCamera(dt, t);
        this.updateGaze();
        this.hud.update(dt);
        // Slower phones: switch to the lite stereo view (no MSAA, lower resolution) if frames run slow.
        if (this.inVR && !this.stereo.lite) {
            this.slowT = dt > 0.024 ? this.slowT + dt : Math.max(0, this.slowT - dt);
            if (this.slowT > 2) this.stereo.lite = true;
        }
        if (this.inVR) this.stereo.render(this.scene, this.camera);
        else this.renderer.render(this.scene, this.camera);
    }

    animate(t, dt) {
        const r = this.ride;
        if (this.state === 'title') {
            // Demo: a ghost ride loops round the track behind the title screen.
            r.dispatched = true;
            this.step(dt);
            if (r.s >= this.track.length - 30 || this.ride.v === 0 && r.s > 100) this.resetRide();
            if (r.launch === 'count') r.launch = 'go';
            this.track.frameAt(r.s, r.pos, r.quat);
        }
        const seg = this.track.segmentAt(r.s);
        this.track.animateTunnels(t, r.launch === 'count' ? 'count' : r.launch === 'go' && seg.tunnel ? 'launch' : 'idle');
        this.train.update(r.s, t, this.excitement(), this.handsUp);
        this.world.animate(t, dt, {
            pos: r.pos, s: r.s, speed: r.v, altitude: this.camera.getWorldPosition(_v).y,
            fireworks: this.fireworks ? this.endPos : null,
        }, this.sound);
        this.sun.position.set(r.pos.x + 40, r.pos.y + 90, r.pos.z + 25);
        this.sun.target.position.copy(r.pos);
        this.shake = Math.max(0, this.shake - dt * 1.6);
    }

    titleCam(t) {
        this.rig.position.set(0, 0, 0);
        this.rig.quaternion.identity();
        this.headBase.rotation.set(0, 0, 0);
        this.headBase.position.set(0, 0, 0);
        const r = this.ride;
        _v.set(Math.cos(t * 0.05) * 70, 32, Math.sin(t * 0.05) * 70).add(r.pos);
        this.camera.position.lerp(_v, 0.05);
        this.camera.lookAt(r.pos);
    }

    placeCamera(dt, t) {
        if (this.state === 'title') return;
        const r = this.ride;
        this.rig.position.copy(r.pos);
        this.rig.quaternion.copy(r.quat);
        // Rumble: stronger with speed, big bumps on launches, landings and splashes.
        const amp = this.shakeOn ? 0.004 * Math.min(1, r.v / 35) + 0.03 * this.shake : 0;
        this.headBase.position.set(Math.sin(t * 61) * amp, Math.sin(t * 47 + 1) * amp, 0);

        if (this.inVR || (this.isPhone && this.phoneHead.data && !this.look.drag && this.look.yaw === 0)) {
            if (this.needRecenter) {
                this.needRecenter = false;
                _v.set(0, 0, -1).applyQuaternion(this.headQuat);
                this.headBase.rotation.y = -Math.atan2(-_v.x, -_v.z);
            }
            this.camera.position.set(0, 0, 0);
            this.camera.quaternion.copy(this.headQuat);
            return;
        }
        this.headBase.rotation.y = 0;
        if (this.view === 'chase') {
            _v.set(0, 3, 12).applyQuaternion(r.quat).add(r.pos);
            if (this.chasePos.distanceTo(_v) > 40) this.chasePos.copy(_v);
            this.chasePos.lerp(_v, 1 - Math.exp(-dt * 5));
            this.rig.updateMatrixWorld();
            this.rig.worldToLocal(this.camera.position.copy(this.chasePos));
            this.camera.lookAt(r.pos); // world space; three.js accounts for the rig's rotation
            return;
        }
        // Keyboard look.
        const k = this.keys;
        if (k.has('ArrowLeft') || k.has('KeyA')) this.look.yaw += dt * 1.8;
        if (k.has('ArrowRight') || k.has('KeyD')) this.look.yaw -= dt * 1.8;
        if (k.has('ArrowUp') || k.has('KeyW')) this.look.pitch = Math.min(1.4, this.look.pitch + dt * 1.5);
        if (k.has('ArrowDown') || k.has('KeyS')) this.look.pitch = Math.max(-1.4, this.look.pitch - dt * 1.5);
        this.camera.position.set(0, 0, 0);
        _e.set(this.look.pitch, this.look.yaw, 0);
        this.camera.quaternion.setFromEuler(_e);
    }
}

new Game();
