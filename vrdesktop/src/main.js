// VR Desktop: your PC's screen on a big virtual monitor, for a phone in a Cardboard headset.
// The PC shares its screen from host.html; this page receives it over WebRTC.
// Look at things + tap (the headset button) to use the buttons, or to click on the PC.
import * as THREE from 'three';
import { PhoneHead, StereoView } from './cardboard.js';
import { VirtualScreen } from './screen.js';
import { Toolbar } from './toolbar.js';
import { Receiver } from './receiver.js';
import { cleanCode } from './link.js';

const LS_CODE = 'vrdesktop.code';
const LS_SOUND = 'vrdesktop.sound';
const TAP_MAX = 0.45;         // s; longer and it isn't a click
const RIGHT_CLICK_HOLD = 0.8; // s holding still = right click
const SCROLL_START = THREE.MathUtils.degToRad(2.5);  // head tilt while holding that starts scrolling
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const clamp = THREE.MathUtils.clamp;

function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function store(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

class App {
    constructor() {
        this.isTouch = matchMedia('(pointer: coarse)').matches;
        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
        r.setPixelRatio(Math.min(window.devicePixelRatio, 3));
        r.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(r.domElement);
        this.clock = new THREE.Clock();

        const bg = 0x0b0f17;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(bg);
        this.scene.fog = new THREE.Fog(bg, 6, 22);
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
        this.headBase = new THREE.Group();  // recentering yaw
        this.headBase.add(this.camera);
        this.scene.add(this.headBase);
        this.buildRoom();

        this.screen = new VirtualScreen(r);
        this.scene.add(this.screen.group);
        this.soundOn = load(LS_SOUND, '1') === '1';
        this.mouseOn = false;       // the viewer wants to click on the PC
        this.hostControl = false;   // the PC allows it
        this.toolbar = new Toolbar([
            { text: 'Recenter', action: () => { this.needRecenter = true; } },
            { text: 'Smaller', action: () => this.screen.resize(1 / 1.15) },
            { text: 'Bigger', action: () => this.screen.resize(1.15) },
            { label: () => this.screen.curved ? 'Curved' : 'Flat', action: () => this.screen.toggleCurve() },
            { label: () => this.mouseOn && this.hostControl ? 'Mouse ON' : 'Mouse off', on: () => this.mouseOn && this.hostControl, action: () => this.toggleMouse() },
            { text: 'Closer', action: () => this.screen.move(1 / 1.15) },
            { text: 'Further', action: () => this.screen.move(1.15) },
            { label: () => this.soundOn ? 'Sound on' : 'Sound off', on: () => this.soundOn, action: () => this.setSound(!this.soundOn) },
        ]);
        this.scene.add(this.toolbar.group);

        this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.014, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
        this.reticle.renderOrder = 20;
        this.scene.add(this.reticle);

        this.phoneHead = new PhoneHead();
        this.stereo = new StereoView(r);
        this.headQuat = new THREE.Quaternion();
        this.needRecenter = true;
        this.look = { yaw: 0, pitch: 0, drag: null };
        this.raycaster = new THREE.Raycaster();
        this.gaze = null;       // { kind: 'button', button } | { kind: 'screen', x, y } | null
        this.hold = null;       // the press in progress
        this.lastClick = null;
        this.lastTap = 0;
        this.slowT = 0;
        this.statsT = 0;
        this.statsText = '';
        this.linkText = '';

        this.receiver = new Receiver({
            onStatus: (state, text) => this.onLinkStatus(state, text),
            onStream: stream => this.screen.setStream(stream),
            onInfo: info => { this.hostControl = !!info.control; },
        });
        this.setupUI();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop(() => this.frame());
        window.app = this; // handy for debugging from the console
    }

    get inVR() { return this.stereo.active; }
    get controlling() { return this.mouseOn && this.hostControl && this.receiver.connected; }

    buildRoom() {
        const floorY = -1.2;
        const grid = new THREE.GridHelper(60, 60, 0x1c2640, 0x1c2640);
        grid.position.y = floorY;
        this.scene.add(grid);
        // A starry dome, so there's something to look at around the screen.
        const n = 900, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            _v.randomDirection();
            _v.y = Math.abs(_v.y) * 0.9 + 0.05;
            _v.normalize().multiplyScalar(40);
            pos.set([_v.x, _v.y, _v.z], i * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fa6d8, size: 1.5, sizeAttenuation: false, fog: false })));
    }

    // ------------------------------------------------------------------ UI

    setupUI() {
        const $ = id => document.getElementById(id);
        this.ui = { title: $('title'), linkStatus: $('linkStatus'), code: $('code'), hint: $('hint') };
        const params = new URLSearchParams(location.search);
        const code = cleanCode(params.get('code') || load(LS_CODE, ''));
        this.ui.code.value = code;
        this.ui.code.addEventListener('input', () => {
            const c = cleanCode(this.ui.code.value);
            this.ui.code.value = c;
            if (c.length >= 6) this.connect();
        });
        this.ui.code.addEventListener('keydown', e => { if (e.key === 'Enter') this.connect(); });
        $('connect').onclick = () => this.connect();
        $('enterVR').onclick = () => this.enterPhoneVR();
        $('flat').onclick = () => this.viewFlat();
        const viewer = $('viewer');
        viewer.value = this.stereo.viewerId;
        viewer.onchange = () => this.stereo.setViewer(viewer.value);
        const sound = $('sound');
        sound.checked = this.soundOn;
        sound.onchange = () => this.setSound(sound.checked);
        if (!window.isSecureContext) {
            this.ui.linkStatus.textContent = 'Open this page over https (e.g. the ngrok URL) or head tracking won\'t work on the phone.';
        }
        if (code.length >= 6) this.connect();
        $('title').addEventListener('pointerdown', () => { if (!this.phoneHead.listening) this.phoneHead.enable(); });
        this.phoneHead.enable();

        window.addEventListener('keydown', e => {
            if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
            if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.press(); }
            if (e.code === 'KeyR') this.needRecenter = true;
            if (e.code === 'Equal' || e.code === 'NumpadAdd') this.screen.resize(1.15);
            if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.screen.resize(1 / 1.15);
            if (e.code === 'KeyF') this.screen.toggleCurve();
            if (e.code === 'KeyM') this.toggleMouse();
            if (e.code === 'Escape' && !this.inVR && this.ui.title.classList.contains('hidden')) this.showTitle();
            if (e.code.startsWith('Arrow')) {
                const s = 0.06;
                if (e.code === 'ArrowLeft') this.look.yaw += s;
                if (e.code === 'ArrowRight') this.look.yaw -= s;
                if (e.code === 'ArrowUp') this.look.pitch = clamp(this.look.pitch + s, -1.4, 1.4);
                if (e.code === 'ArrowDown') this.look.pitch = clamp(this.look.pitch - s, -1.4, 1.4);
            }
        });
        window.addEventListener('keyup', e => { if (e.code === 'Space') this.release(); });

        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', e => {
            this.phoneHead.enable();
            if (!this.inVR) this.look.drag = { x: e.clientX, y: e.clientY, yaw: this.look.yaw, pitch: this.look.pitch, moved: false };
            this.press();
        });
        window.addEventListener('pointermove', e => {
            const d = this.look.drag;
            if (!d) return;
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
                d.moved = true;
                this.hold = null;   // dragging to look around, not a click
            }
            if (!d.moved) return;
            this.look.yaw = d.yaw + (e.clientX - d.x) * 0.004;
            this.look.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.004, -1.4, 1.4);
        });
        const up = () => { this.look.drag = null; this.release(); };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (this.controlling && this.gaze && this.gaze.kind === 'screen') {
                this.receiver.send({ t: 'scroll', x: this.gaze.x, y: this.gaze.y, dy: Math.sign(e.deltaY) });
            } else this.screen.move(e.deltaY > 0 ? 1.08 : 1 / 1.08);
        }, { passive: false });
        canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.stereo.active) this.exitPhoneVR();
        });
    }

    connect() {
        const code = cleanCode(this.ui.code.value);
        if (code.length < 4) {
            this.ui.linkStatus.textContent = 'Type the code shown on the PC (host.html).';
            return;
        }
        store(LS_CODE, code);
        this.receiver.start(code);
    }

    onLinkStatus(state, text) {
        this.linkText = state === 'connected' ? `Connected to ${this.receiver.code}` : text.split('\n')[0];
        this.ui.linkStatus.textContent = state === 'idle' ? '' : text;
        this.ui.linkStatus.dataset.state = state;
        if (state === 'searching') this.screen.showMessage('Waiting for your PC', `Code ${this.receiver.code}. ${text}`);
        if (state === 'connecting') this.screen.showMessage('Connecting...', '');
    }

    setSound(on) {
        this.soundOn = on;
        store(LS_SOUND, on ? '1' : '0');
        document.getElementById('sound').checked = on;
        this.screen.setSound(on);
    }

    toggleMouse() {
        if (!this.hostControl) {
            this.flash('Mouse control is off on the PC: tick it on host.html (needs control.py running)');
            this.mouseOn = false;
            return;
        }
        this.mouseOn = !this.mouseOn;
        this.flash(this.mouseOn ? 'Tap = click, hold = right click, hold + tilt head = scroll' : 'Mouse control off');
    }

    flash(text) {
        this.flashText = text;
        this.flashT = 4;
    }

    startViewing() {
        this.connect();
        this.screen.setSound(this.soundOn);    // a tap, so the browser lets it play sound
        this.ui.title.classList.add('hidden');
        this.needRecenter = true;
    }

    enterPhoneVR() {
        // Permission prompt first: requestFullscreen uses up the click.
        this.phoneHead.enable();
        const el = document.documentElement;
        const fs = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
        Promise.resolve(fs).catch(() => {}).then(() => {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        });
        if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { this.wakeLock = l; }).catch(() => {});
        this.stereo.active = true;
        this.ui.hint.classList.add('hidden');
        this.startViewing();
    }

    exitPhoneVR() {
        this.stereo.active = false;
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.onResize();
        this.showTitle();
    }

    viewFlat() {
        this.look.yaw = this.look.pitch = 0;
        this.ui.hint.classList.remove('hidden');
        this.startViewing();
    }

    showTitle() {
        this.ui.title.classList.remove('hidden');
        this.ui.hint.classList.add('hidden');
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // ------------------------------------------------------------------ input

    // Screen tap / headset button / space.
    press() {
        if (!this.ui.title.classList.contains('hidden')) return;
        this.screen.setSound(this.soundOn);
        const g = this.gaze;
        if (g && g.kind === 'button') {
            g.button.action();
            return;
        }
        this.hold = { t: 0, gaze: g, dir: this.gazeDir.clone(), mode: 'pending', acc: 0, sent: 0 };
    }

    release() {
        const h = this.hold;
        this.hold = null;
        if (!h) return;
        const onScreen = h.gaze && h.gaze.kind === 'screen';
        if (onScreen && this.controlling) {
            if (h.mode === 'pending' && h.t < TAP_MAX) this.click(h.gaze);
            return;
        }
        if (h.t >= TAP_MAX) return;
        // Double tap (the headset button twice) recenters the view.
        const now = performance.now();
        if (now - this.lastTap < 400) { this.needRecenter = true; this.lastTap = 0; } else this.lastTap = now;
    }

    click(at, button = 'left') {
        const now = performance.now();
        let { x, y } = at;
        // The head never keeps perfectly still: a quick second click lands on the first, so it counts as a double click.
        const l = this.lastClick;
        if (l && button === 'left' && now - l.time < 450 && Math.hypot(x - l.x, (y - l.y) / this.screen.aspect) < 0.02) ({ x, y } = l);
        this.lastClick = { x, y, time: now };
        this.receiver.send({ t: 'click', x, y, button });
        this.pulse = 1;
    }

    updateHold(dt) {
        const h = this.hold;
        if (!h) return;
        h.t += dt;
        if (!(h.gaze && h.gaze.kind === 'screen' && this.controlling)) return;
        const tilt = Math.asin(clamp(h.dir.y, -1, 1)) - Math.asin(clamp(this.gazeDir.y, -1, 1));  // > 0: looking lower than at the start
        if (h.mode === 'pending') {
            if (Math.abs(tilt) > SCROLL_START) h.mode = 'scroll';
            else if (h.t > RIGHT_CLICK_HOLD) {
                h.mode = 'done';
                this.click(h.gaze, 'right');
            }
        }
        if (h.mode === 'scroll') {
            // Like a joystick: the further you tilt, the faster it scrolls (in wheel notches per second).
            const deg = THREE.MathUtils.radToDeg(Math.abs(tilt)) - 1.5;
            h.acc += Math.sign(tilt) * Math.max(0, deg) * 1.4 * dt;
            h.sent += dt;
            if (Math.abs(h.acc) >= 0.25 && h.sent > 0.05) {
                this.receiver.send({ t: 'scroll', x: h.gaze.x, y: h.gaze.y, dy: h.acc });
                h.acc = 0;
                h.sent = 0;
            }
        }
    }

    // ------------------------------------------------------------------ main loop

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        if (this.phoneHead.update()) this.headQuat.copy(this.phoneHead.quat);
        this.placeCamera();
        this.updateGaze(dt);
        this.updateHold(dt);

        this.statsT -= dt;
        if (this.statsT <= 0) {
            this.statsT = 1;
            this.receiver.stats().then(s => { this.statsText = s; }).catch(() => {});
        }
        if (this.flashT > 0) this.flashT -= dt;
        const status = this.flashT > 0 ? this.flashText
            : [this.linkText, this.receiver.connected ? this.statsText : ''].filter(Boolean).join(' · ');
        this.toolbar.setStatus(status);

        // Slower phones: switch to the lite stereo view (no MSAA, lower resolution) if frames run slow.
        if (this.inVR && !this.stereo.lite) {
            this.slowT = dt > 0.024 ? this.slowT + dt : Math.max(0, this.slowT - dt);
            if (this.slowT > 3) this.stereo.lite = true;
        }
        if (this.inVR) this.stereo.render(this.scene, this.camera);
        else this.renderer.render(this.scene, this.camera);
    }

    placeCamera() {
        if (this.inVR) {
            if (this.needRecenter) {
                this.needRecenter = false;
                _v.set(0, 0, -1).applyQuaternion(this.headQuat);
                this.headBase.rotation.y = -Math.atan2(-_v.x, -_v.z);
            }
            this.camera.quaternion.copy(this.headQuat);
        } else {
            if (this.needRecenter) {
                this.needRecenter = false;
                this.look.yaw = this.look.pitch = 0;
            }
            this.headBase.rotation.y = 0;
            _e.set(this.look.pitch, this.look.yaw, 0);
            this.camera.quaternion.setFromEuler(_e);
        }
        this.camera.updateMatrixWorld();
    }

    updateGaze(dt) {
        const cam = this.camera;
        this.gazeDir = cam.getWorldDirection(this.gazeDir || new THREE.Vector3());
        this.raycaster.set(cam.getWorldPosition(_v), this.gazeDir);
        const canPress = this.toolbar.update(dt, Math.asin(clamp(this.gazeDir.y, -1, 1)));
        const b = canPress ? this.toolbar.hit(this.raycaster) : null;
        const s = b ? null : this.screen.hit(this.raycaster);
        this.toolbar.setHot(b && b.button);
        this.gaze = b ? { kind: 'button', button: b.button } : s ? { kind: 'screen', x: s.x, y: s.y } : null;

        // The reticle sits on whatever you look at, so both eyes agree on how far away it is.
        const dist = b ? b.distance : s ? s.distance : 2.5;
        this.pulse = Math.max(0, (this.pulse || 0) - dt * 4);
        const scale = dist * (1 + (b ? 0.4 : 0) + this.pulse * 0.8);
        this.reticle.position.copy(this.raycaster.ray.origin).addScaledVector(this.gazeDir, dist * 0.985);
        this.reticle.quaternion.copy(cam.getWorldQuaternion(this.reticle.quaternion));
        this.reticle.scale.setScalar(scale);
        const h = this.hold;
        const color = b ? 0xffd84d
            : h && h.mode === 'scroll' ? 0x4ade80
            : h && h.mode === 'done' ? 0xff8a3d
            : s && this.controlling ? 0x5ab0ff : 0xffffff;
        this.reticle.material.color.setHex(color);
    }
}

new App();
