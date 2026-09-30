// Whack-a-Mole VR — moles pop out of floating holes in your own room (camera passthrough)
// and you swat them with your real hands. Phone in a Cardboard headset, or a webcam on a screen.
// Same rules as eye-toy/whack-a-mole.html: bombs cost a life, 3 lives, a level every 10 moles,
// a life back every 5 levels.
import * as THREE from 'three';
import { PhoneHead, StereoView } from './cardboard.js';
import { HandTracker } from './hands.js';
import { Passthrough, HeadHistory } from './passthrough.js';
import { Field, LAYOUT, CENTER } from './moles.js';
import { Effects } from './effects.js';
import { Garden } from './garden.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { Scores } from './scores.js';

const MAX_LIVES = 3;
const BASE_SPAWN = 1.1;          // seconds between moles at level 1
const BASE_SHOW = 1.9;           // seconds a mole stays out at level 1
const DIST = 0.55;               // metres from your eyes to the holes: within arm's reach
const DIST_FLAT = 0.95;          // on a screen there's no depth to match: further away looks the right size
const VR_SPAN_YAW = 95;          // degrees the field spreads across in the headset...
const VR_SPAN_PITCH = 76;
const VR_PITCH = -8;             // ...a little below eye level
const HAND_HIT_AGE = 0.15;       // seconds a detected hand keeps whacking
const HAND_SHOW_AGE = 0.3;       // seconds its marker stays visible
const HOLD_TO_START = 1.2;       // seconds holding the screen starts without whacking
const LS_FOV = 'guacamole.cameraFov';
const LS_BG = 'guacamole.background';
const LS_OCC = 'guacamole.handsInFront';
const params = new URLSearchParams(location.search);
// How far the camera picture lags behind your head (ms). Tune with ?lag=120 if the room swims.
const LAG = (parseFloat(params.get('lag')) >= 0 ? parseFloat(params.get('lag')) : 80) / 1000;
const Y = new THREE.Vector3(0, 1, 0);
const KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyC'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const clamp = THREE.MathUtils.clamp;
const d2r = THREE.MathUtils.degToRad;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

class Game {
    constructor() {
        this.isTouch = matchMedia('(pointer: coarse)').matches;
        this.isPhone = this.isTouch && !/OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        r.setSize(window.innerWidth, window.innerHeight);
        r.setClearColor(0x000000);
        document.body.appendChild(r.domElement);
        this.clock = new THREE.Clock();

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.02, 200);
        this.scene.add(this.camera);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6a4a, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.8);
        sun.position.set(0.4, 1, 0.6);
        this.scene.add(sun);
        this.world = new THREE.Group();     // the field; shaken by bombs
        this.scene.add(this.world);

        this.sound = new Sound();
        this.scores = new Scores();
        this.tracker = new HandTracker();
        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(r);
        this.history = new HeadHistory();
        this.pass = new Passthrough();
        this.scene.add(this.pass.group);
        this.garden = new Garden();
        this.scene.add(this.garden.group);
        this.field = new Field();
        this.world.add(this.field.group);
        this.fx = new Effects();
        this.world.add(this.fx.group);
        // A ring around each tracked hand: its whacking zone.
        this.markers = Array.from({ length: 2 }, () => {
            const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32),
                new THREE.MeshBasicMaterial({ color: 0xffc14a, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
            m.renderOrder = 60;
            m.visible = false;
            this.scene.add(m);
            return m;
        });
        this.hud = new Hud(this);

        this.headQuat = new THREE.Quaternion();
        this.yawQuat = new THREE.Quaternion();
        this.needRecenter = true;
        this.hands = [];
        this.pokes = [];               // one-off whacks: mouse, taps, keys
        this.touching = false;
        this.holdT = 0;
        this.state = 'title';
        this.stateT = 0;
        this.level = 1;
        this.score = 0;
        this.lives = MAX_LIVES;
        this.shake = 0;
        this.damageCd = 0;
        this.demoT = 0;
        this.layoutKey = '';
        this.handStatus = { text: '', color: '#fff' };
        this.fovSetting = lsGet(LS_FOV, 'auto');
        this.bgSetting = lsGet(LS_BG, 'pass');
        this.handsInFront = lsGet(LS_OCC, '1') === '1';

        this.setupUI();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop(() => this.frame());
        window.game = this; // handy for debugging from the console
    }

    get inVR() { return this.stereo.active; }

    get dist() { return this.inVR ? DIST : DIST_FLAT; }

    // No camera in the headset: look at a mole and tap to whack it.
    get gazeMode() { return this.inVR && this.tracker.status !== 'running' && this.tracker.status !== 'loading'; }

    get passOn() { return this.bgSetting === 'pass' && this.tracker.status === 'running' && this.pass.hasFrame; }

    // ------------------------------------------------------------------ UI

    setupUI() {
        const $ = id => document.getElementById(id);
        this.ui = { title: $('title'), camStatus: $('camStatus'), preview: $('handPreview'), vrStatus: $('vrStatus'), board: $('board') };
        $('enterVR').onclick = () => this.enterPhoneVR();
        $('play').onclick = () => this.playFlat();
        $('exit').onclick = () => this.toTitle();
        if (!this.isPhone) $('vrStatus').textContent = 'VR mode is made for a phone in a headset: open this page on your phone (https via ngrok).';
        const facing = $('camFacing');
        facing.value = this.isPhone ? 'environment' : 'user';
        $('camStart').onclick = () => {
            this.sound.unlock();
            this.tracker.start(facing.value);
        };
        facing.onchange = () => { if (this.tracker.status !== 'off') this.tracker.start(facing.value); };
        const tracker = $('tracker');
        tracker.value = this.tracker.delegate;
        tracker.onchange = () => this.tracker.setDelegate(tracker.value);
        const fov = $('fov');
        fov.value = this.fovSetting;
        if (fov.value !== this.fovSetting) { fov.value = 'auto'; this.fovSetting = 'auto'; }
        fov.onchange = () => { this.fovSetting = fov.value; lsSet(LS_FOV, fov.value); };
        const bg = $('background');
        bg.value = this.bgSetting;
        bg.onchange = () => { this.bgSetting = bg.value; lsSet(LS_BG, bg.value); };
        const occ = $('handsInFront');
        occ.checked = this.handsInFront;
        occ.onchange = () => { this.handsInFront = occ.checked; lsSet(LS_OCC, occ.checked ? '1' : '0'); };
        this.useHands = $('useHands');
        this.useHands.checked = true;
        const viewer = $('viewer');
        viewer.value = this.stereo.viewerId;
        viewer.onchange = () => this.stereo.setViewer(viewer.value);
        const name = this.nameInput = $('name');
        name.value = this.scores.name;
        name.onchange = () => { this.scores.name = name.value.trim(); };
        this.renderBoard();
        $('title').addEventListener('pointerdown', () => { if (!this.phoneHead.listening) this.phoneHead.enable(); });
        this.phoneHead.enable();

        window.addEventListener('keydown', e => {
            if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
            if (e.code === 'Space') e.preventDefault();
            const k = KEYS.indexOf(e.code);
            if (k >= 0 && this.state !== 'title') this.pokeHole(k);
            if (e.code === 'KeyM') this.sound.toggleMute();
            if (e.code === 'KeyR') this.recenter();
            if (e.code === 'Escape' && this.state !== 'title' && !this.inVR) this.toTitle();
            if ((e.code === 'Enter' || e.code === 'Space') && (this.state === 'ready' || (this.state === 'over' && this.stateT > 1))) this.startGame();
            if (e.code === 'Enter' && this.state === 'title' && document.activeElement !== name) this.playFlat();
        });
        const canvas = this.renderer.domElement;
        canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            this.touching = true;
            this.phoneHead.enable();
            const now = performance.now();
            if (this.inVR) {
                // Double tap (the headset button twice) recenters the field in front of you.
                if (now - (this.lastTap || 0) < 350) { this.recenter(); this.lastTap = 0; } else this.lastTap = now;
                if (this.gazeMode) this.poke(_v.set(0, 0, -1).applyQuaternion(this.headQuat), 0.06);
            } else {
                const t = e.changedTouches[0];
                this.pokeScreen(t.clientX, t.clientY);
            }
        }, { passive: false });
        const end = e => { e.preventDefault(); this.touching = e.touches.length > 0; };
        canvas.addEventListener('touchend', end, { passive: false });
        canvas.addEventListener('touchcancel', end, { passive: false });
        canvas.addEventListener('mousedown', e => { if (!this.inVR) this.pokeScreen(e.clientX, e.clientY); });
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });
    }

    renderBoard(highlight) {
        this.ui.board.innerHTML = this.scores.html(highlight);
    }

    poke(dir, ang) { this.pokes.push({ dir: dir.clone().normalize(), ang }); }

    pokeScreen(x, y) {
        if (this.state === 'title') return;
        const ndc = new THREE.Vector2(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1);
        _v.set(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position);
        this.poke(_v, 0.03);
    }

    pokeHole(i) {
        this.field.holes[i].head.getWorldPosition(_v);
        this.poke(_v, 0.01);
    }

    recenter() {
        this.needRecenter = true;
        if (this.inVR) this.hud.message('RECENTERED', '', 0.8);
    }

    enterPhoneVR() {
        // Permission prompts first: requestFullscreen uses up the click.
        this.sound.unlock();
        this.scores.name = this.nameInput.value.trim();
        this.phoneHead.enable();
        this.tracker.start('environment');
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { this.wakeLock = l; }).catch(() => {});
        this.stereo.active = true;
        this.needRecenter = true;
        this.toReady();
    }

    exitPhoneVR() {
        this.stereo.active = false;
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.onResize();
        this.toTitle();
    }

    playFlat() {
        this.sound.unlock();
        this.scores.name = this.nameInput.value.trim();
        if (this.useHands.checked) this.tracker.start(document.getElementById('camFacing').value);
        this.toReady();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ------------------------------------------------------------------ game flow

    setState(s) {
        this.state = s;
        this.stateT = 0;
    }

    toTitle() {
        if (this.inVR) { this.exitPhoneVR(); return; }
        this.setState('title');
        this.ui.title.classList.remove('hidden');
        this.sound.stopMusic();
        this.hud.clearMessage();
        this.field.clear();
        this.renderBoard(this.lastEntry);
    }

    toReady() {
        this.ui.title.classList.add('hidden');
        this.field.clear();
        this.setState('ready');
        this.lives = MAX_LIVES;
        this.level = 1;
        this.score = 0;
        this.sound.stopMusic();
    }

    startGame() {
        const now = performance.now() / 1000;
        this.field.leaveAll(now);
        this.lives = MAX_LIVES;
        this.level = 1;
        this.score = 0;
        this.scoreThisLevel = 0;
        this.spawnInterval = BASE_SPAWN;
        this.showDuration = BASE_SHOW;
        this.spawnT = -0.6;            // a short breath before the first mole
        this.damageCd = 0;
        this.setState('play');
        this.hud.message('GO!', '', 0.8);
        this.sound.play('start');
        this.sound.music(true);
    }

    gameOver() {
        this.setState('over');
        this.field.leaveAll(performance.now() / 1000);
        this.sound.stopMusic();
        this.sound.play('over');
        const name = this.scores.name || 'Player';
        let rankText = '';
        if (this.score > 0) {
            const { entry, rank } = this.scores.add(name, this.score, this.level);
            this.lastEntry = entry;
            rankText = rank === 0 ? 'NEW HIGH SCORE!' : rank > 0 ? `Ranked #${rank + 1} of the top 10` : '';
        }
        this.overText = `Level ${this.level}  ·  ${this.score} mole${this.score === 1 ? '' : 's'} whacked` + (rankText ? `\n${rankText}` : '');
    }

    levelUp() {
        this.level++;
        this.spawnInterval = Math.max(0.38, BASE_SPAWN * Math.pow(0.88, this.level - 1));
        this.showDuration = Math.max(0.7, BASE_SHOW * Math.pow(0.90, this.level - 1));
        this.sound.tempo = Math.min(1.35, 1 + (this.level - 1) * 0.03);
        if ((this.level - 1) % 5 === 0 && this.lives < MAX_LIVES) {
            this.lives++;
            this.hud.flash(0x60ff60, 0.35);
            this.sound.play('life');
            this.hud.message(`LEVEL ${this.level}!`, 'Extra life!', 1.4);
        } else {
            this.sound.play('level');
            this.hud.message(`LEVEL ${this.level}!`, '', 1.2);
        }
    }

    spawnMole(now) {
        const free = this.field.free();
        if (!free.length) return;
        const hole = free[Math.floor(Math.random() * free.length)];
        const bombChance = Math.min(0.32, 0.08 + this.level * 0.025);
        hole.spawn(Math.random() < bombChance ? 'bomb' : 'mole', this.showDuration * (0.85 + Math.random() * 0.3), now);
        this.sound.play('pop');
    }

    whack(hole, now) {
        const kind = hole.kind;
        hole.hit(now);
        const p = this.world.worldToLocal(hole.head.getWorldPosition(new THREE.Vector3()));
        if (kind === 'start') {
            this.fx.starBurst(p, 8);
            this.fx.burst(p, 0xffc14a, 16);
            this.sound.play('whack');
            this.startGame();
            return;
        }
        if (kind === 'mole') {
            this.fx.burst(p, 0xff7a3a, 14);
            this.fx.burst(p, 0x7d4a25, 10);
            this.fx.starBurst(p, 6);
            this.fx.text(p.clone().addScaledVector(Y, 0.05), '+1');
            this.sound.play('whack');
            this.score++;
            if (++this.scoreThisLevel >= 10) {
                this.scoreThisLevel = 0;
                this.levelUp();
            }
            return;
        }
        // A bomb.
        this.fx.blast(p);
        this.sound.play('bomb');
        if (this.damageCd > 0) return;
        this.damageCd = 0.9;
        this.shake = 1;
        this.hud.flash(0xff1e1e, 0.55);
        if (navigator.vibrate) navigator.vibrate(120);
        this.lives--;
        if (this.lives <= 0) this.gameOver();
    }

    // ------------------------------------------------------------------ hands

    // Camera half field of view as tangents, for the upright picture.
    cameraTangents() {
        const s = this.tracker.displaySize();
        const auto = this.fovSetting === 'auto';
        let t = Math.tan(d2r((auto ? 66 : parseFloat(this.fovSetting)) / 2));  // along the long side
        if (auto) t /= Math.min(1, this.tracker.zoom || 1);
        const tanH = s.w >= s.h ? t : t * s.w / s.h;
        return { tanH, tanV: tanH * s.h / s.w };
    }

    updateHands(now) {
        const res = this.tracker.take();
        if (res) {
            // Where the head pointed when this frame was taken.
            const q = this.history.at(res.t - LAG, _q);
            const { tanH, tanV } = this.cameraTangents();
            const prev = this.hands, used = new Set();
            const hands = res.hands.map(h => {
                const dir = new THREE.Vector3((h.palm.x - 0.5) * 2 * tanH, (0.5 - h.palm.y) * 2 * tanV, -1).normalize().applyQuaternion(q);
                let r = 0;
                for (const p of h.lm) r = Math.max(r, Math.hypot((p.x - h.palm.x) * 2 * tanH, (p.y - h.palm.y) * 2 * tanV));
                let best = null, bestD = 0.4;
                for (const o of prev) {
                    if (used.has(o)) continue;
                    const d = o.dir.angleTo(dir);
                    if (d < bestD) { bestD = d; best = o; }
                }
                if (best) used.add(best);
                return { dir, prev: best && now - best.t < 0.3 ? best.dir : null, ang: clamp(r * 0.7, 0.05, 0.22), t: now, fresh: true };
            });
            // A hand missing from one detection is kept a moment (detection hiccups).
            for (const o of prev) if (!used.has(o)) { o.fresh = false; hands.push(o); }
            this.hands = hands;
            if (this.passOn && this.handsInFront) this.pass.drawMask(this.tracker.hands);
        } else {
            for (const h of this.hands) h.fresh = false;
        }
        this.hands = this.hands.filter(h => now - h.t < HAND_SHOW_AGE);
    }

    checkHits(now) {
        const hitBy = (h, target, lim) => {
            if (h.dir.angleTo(target) < lim) return true;
            if (!h.fresh || !h.prev) return false;
            // Fast swats: check the path between the last two detections too.
            for (let i = 1; i < 6; i++) {
                if (_v2.copy(h.prev).lerp(h.dir, i / 6).normalize().angleTo(target) < lim) return true;
            }
            return false;
        };
        for (const hole of this.field.holes) {
            if (!hole.hittable()) continue;
            hole.head.getWorldPosition(_v);
            const mAng = Math.atan(hole.radius / _v.length());
            _v.normalize();
            let hit = false;
            for (const h of this.hands) {
                if (now - h.t < HAND_HIT_AGE && hitBy(h, _v, mAng + h.ang * 0.7)) { hit = true; break; }
            }
            if (!hit) hit = this.pokes.some(p => p.dir.angleTo(_v) < mAng + p.ang);
            if (hit) this.whack(hole, now);
        }
        this.pokes.length = 0;
    }

    updateHandStatus() {
        const hs = this.handStatus, st = this.tracker.status;
        const seen = this.hands.filter(h => performance.now() / 1000 - h.t < HAND_SHOW_AGE).length;
        if (st === 'running') {
            if (seen) { hs.text = seen === 2 ? 'BOTH HANDS' : 'ONE HAND'; hs.color = '#9fff7a'; }
            else { hs.text = 'SHOW YOUR HANDS'; hs.color = '#ffb38a'; }
        } else if (st === 'loading') { hs.text = 'STARTING CAMERA...'; hs.color = '#ffffff'; }
        else if (st === 'error') { hs.text = this.inVR ? 'NO CAMERA: LOOK + TAP' : 'NO CAMERA'; hs.color = '#ff9a7a'; }
        else if (this.inVR) { hs.text = 'LOOK + TAP'; hs.color = '#ffffff'; }
        else { hs.text = this.isTouch ? 'TAP THE MOLES' : 'CLICK THE MOLES'; hs.color = '#ffffff'; }
    }

    // ------------------------------------------------------------------ layout

    // Flat screen: the half height of the view (tangent), so the camera picture covers the screen.
    flatTan() {
        const A = window.innerWidth / window.innerHeight;
        if (!this.passOn) return Math.tan(d2r(30));
        const { tanH, tanV } = this.cameraTangents();
        return Math.min(tanV, tanH / A);
    }

    layout() {
        let key, dirs;
        if (this.inVR) {
            key = 'vr';
            dirs = LAYOUT.map(p => {
                const a = d2r((p.x - 0.5) * VR_SPAN_YAW), e = d2r((0.5 - p.y) * VR_SPAN_PITCH + VR_PITCH);
                return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
            });
        } else {
            const tv = this.flatTan(), A = window.innerWidth / window.innerHeight;
            key = `flat:${tv.toFixed(3)}:${A.toFixed(3)}`;
            dirs = LAYOUT.map(p => new THREE.Vector3((p.x - 0.5) * 2 * tv * A * 0.9, (0.5 - p.y) * 2 * tv * 0.9 + tv * 0.08, -1));
        }
        if (key === this.layoutKey) return;
        this.layoutKey = key;
        this.field.layout(dirs, this.dist);
    }

    // ------------------------------------------------------------------ main loop

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const now = performance.now() / 1000;
        this.stateT += dt;
        this.updateHead(now);
        this.tracker.update(now * 1000);
        this.sound.update();
        if (this.bgSetting === 'pass') this.pass.grab(this.tracker, now);
        this.updateHands(now);
        this.updateHandStatus();
        this.holdT = this.touching ? this.holdT + dt : 0;
        this.damageCd = Math.max(0, this.damageCd - dt);
        this.layout();

        switch (this.state) {
            case 'title': this.updateTitle(now, dt); break;
            case 'ready': this.updateReady(now); break;
            case 'play': this.updatePlay(now, dt); break;
            case 'over': this.updateOver(now); break;
        }
        if (this.state !== 'title') this.checkHits(now);
        this.pokes.length = 0;
        this.field.update(now);
        this.updateView(now, dt);
        this.fx.update(dt, this.camera.quaternion);
        this.hud.update(dt);
        if (this.inVR) this.stereo.render(this.scene, this.camera);
        else this.renderer.render(this.scene, this.camera);
    }

    updateHead(now) {
        if (this.inVR) {
            if (this.phoneHead.update()) {
                if (this.needRecenter) {
                    this.needRecenter = false;
                    _v.set(0, 0, -1).applyQuaternion(this.phoneHead.quat);
                    this.yawQuat.setFromAxisAngle(Y, -Math.atan2(-_v.x, -_v.z));
                    this.history.clear();
                }
                this.headQuat.multiplyQuaternions(this.yawQuat, this.phoneHead.quat);
            }
        } else {
            this.headQuat.identity();
        }
        this.history.push(now, this.headQuat);
    }

    updateTitle(now, dt) {
        // Moles pop up behind the title screen for fun.
        this.demoT -= dt;
        if (this.demoT <= 0) {
            this.demoT = 0.7;
            const free = this.field.free();
            if (free.length) free[Math.floor(Math.random() * free.length)].spawn(Math.random() < 0.2 ? 'bomb' : 'mole', 1.6, now);
        }
        if (this.tracker.status !== 'off') this.tracker.drawPreview(this.ui.preview);
        const h = this.tracker;
        this.ui.camStatus.textContent = h.status === 'running'
            ? `Camera OK (${h.facing === 'environment' ? 'back' : 'front'}). Tracker ${h.activeDelegate}: ${Math.round(h.rate)} checks/s`
            : h.status === 'loading' ? 'Starting camera and downloading the hand model (~10 MB)...'
                : h.status === 'error' ? 'Camera problem: ' + h.error : '';
    }

    startHint() {
        const st = this.tracker.status;
        if (st === 'loading') return 'Starting the camera and hand tracking...';
        if (st === 'running') {
            return this.inVR
                ? 'Swat the mole in the middle with your hand\nHold your hands up in front of you: the camera must see them\nDouble tap: recenter · Hold the screen: start without whacking'
                : 'Swat the mole in the middle with your hand (or click it)';
        }
        if (this.inVR) return 'No camera: look at the mole and tap the screen to whack\nDouble tap: recenter';
        return this.isTouch ? 'Tap the mole in the middle' : 'Click the mole in the middle (or press S)';
    }

    updateReady(now) {
        this.field.showStart('START', now);
        this.hud.board('WHACK-A-MOLE', this.startHint());
        if (this.holdT > HOLD_TO_START) this.startGame();
    }

    updatePlay(now, dt) {
        this.spawnT += dt;
        if (this.spawnT >= this.spawnInterval) {
            this.spawnT = 0;
            this.spawnMole(now);
        }
        this.noHandsT = this.hands.length === 0 && this.tracker.status === 'running' ? (this.noHandsT || 0) + dt : 0;
        if (this.noHandsT > 4) {
            this.noHandsT = 0;
            this.hud.message('HANDS UP!', 'The camera can\'t see your hands', 1.2);
        }
    }

    updateOver(now) {
        const again = this.stateT > 1.8;
        this.hud.board('KO!', this.overText + (again ? '\nWhack the mole to play again' + (this.inVR ? '' : ' · Esc: menu') : ''));
        if (again) this.field.showStart('AGAIN', now);
        if (again && this.holdT > HOLD_TO_START) this.startGame();
    }

    updateView(now, dt) {
        const passOn = this.passOn;
        const { tanH, tanV } = this.cameraTangents();
        this.pass.group.visible = passOn;
        this.pass.fg.visible = passOn && this.handsInFront && this.hands.length > 0 && !this.pass.maskEmpty;
        if (passOn) this.pass.place(this.history.at(this.pass.frameT - LAG, _q), tanH, tanV, this.dist);
        this.garden.group.visible = !passOn;

        if (!this.inVR) {
            const fov = THREE.MathUtils.radToDeg(2 * Math.atan(this.flatTan()));
            if (Math.abs(fov - this.camera.fov) > 0.01 || this.camera.aspect !== window.innerWidth / window.innerHeight) {
                this.camera.fov = fov;
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
            }
        }
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.copy(this.headQuat);
        this.camera.updateMatrixWorld();

        // Bomb shake (the field shakes, not your head).
        this.shake = Math.max(0, this.shake - dt * 2.5);
        const s = this.shake * this.shake * 0.012;
        this.world.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);

        this.markers.forEach((m, i) => {
            const h = this.hands[i];
            m.visible = !!h && this.state !== 'title';
            if (!m.visible) return;
            m.position.copy(h.dir).multiplyScalar(this.dist * 0.95);
            m.quaternion.copy(this.headQuat);
            m.scale.setScalar(Math.tan(h.ang * 0.7) * this.dist * 0.95);
            m.material.opacity = 0.75 * (1 - (now - h.t) / HAND_SHOW_AGE);
        });
        // Lighter stereo rendering while the hand tracker needs the GPU.
        this.stereo.lite = this.tracker.status === 'running' || this.tracker.status === 'loading';
    }
}

new Game();
