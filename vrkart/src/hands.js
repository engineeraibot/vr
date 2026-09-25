// Hand steering. The phone's back camera (or a webcam) watches your hands; MediaPipe's
// HandLandmarker finds them. Hold both hands up like on a steering wheel:
//   left hand higher  -> turn right (wheel turned clockwise)
//   right hand higher -> turn left
//   both hands        -> full throttle, one hand -> coast, no hands -> the kart stops.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const PALM = [0, 5, 9, 13, 17];
const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
const FULL_LOCK = 35 * Math.PI / 180;   // wheel angle that gives full steering
const DEADZONE = 4 * Math.PI / 180;
const GRACE = 0.4;                      // seconds a missing hand is tolerated (detection hiccups)
const DETECT_EVERY = 45;                // ms between detections (~20 Hz keeps the phone responsive)
const LS_SWAP = 'kart64.swapSteering';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Fallback when the worker can't run MediaPipe: detect on the main thread.
async function createLandmarker() {
    const { FilesetResolver, HandLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const options = delegate => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });
    try {
        return await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
        return HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
}

export class HandWheel {
    constructor() {
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', '');
        this.status = 'off';      // off | loading | running | error
        this.error = '';
        this.landmarker = null;
        this.stream = null;
        this.hands = [];
        this.palms = [];
        this.target = 0;
        this.steer = 0;
        this.angle = 0;
        this.lastBoth = -9;
        this.lastAny = -9;
        this.lastVideoTime = -1;
        this.nextDetect = 0;
        this.detectMs = 0;
        this.facing = '';
        this.mirrored = false;
        let swap = null;
        try { swap = localStorage.getItem(LS_SWAP); } catch { /* ignore */ }
        this.swap = swap === '1';
    }

    setSwap(on) {
        this.swap = on;
        try { localStorage.setItem(LS_SWAP, on ? '1' : '0'); } catch { /* ignore */ }
    }

    // facing: 'environment' (back camera, phone in a headset) or 'user' (webcam / selfie)
    start(facing) {
        if (this.status === 'loading' && this.wanted === facing) return this.ready;
        if (this.status === 'running' && this.wanted === facing) return Promise.resolve();
        this.wanted = facing;
        this.ready = this.open(facing);
        return this.ready;
    }

    async open(facing) {
        this.status = 'loading';
        this.error = '';
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('the camera needs https (open the page through ngrok)');
            }
            this.stopStream();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
            });
            this.stream = stream;
            this.video.srcObject = stream;
            await this.video.play();
            const settings = stream.getVideoTracks()[0].getSettings();
            this.facing = settings.facingMode || facing;
            this.mirrored = this.facing !== 'environment'; // a selfie camera sees you mirrored
            if (!this.worker && !this.landmarker) await this.createDetector();
            this.status = 'running';
        } catch (e) {
            this.status = 'error';
            this.error = e && e.message ? e.message : String(e);
        }
    }

    // Prefer a worker (smooth rendering); fall back to the main thread.
    async createDetector() {
        try {
            const worker = new Worker(new URL('./hands-worker.js', import.meta.url), { type: 'module' });
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('worker timeout')), 30000);
                worker.onmessage = e => {
                    if (e.data.type === 'ready') { clearTimeout(timer); resolve(); }
                    if (e.data.type === 'error') { clearTimeout(timer); reject(new Error(e.data.message)); }
                };
                worker.onerror = err => { clearTimeout(timer); reject(err); };
                worker.postMessage({ type: 'init', mp: MP, model: MODEL });
            });
            worker.onmessage = e => this.onWorker(e.data);
            this.worker = worker;
            this.busy = false;
        } catch {
            this.landmarker = await createLandmarker();
        }
    }

    onWorker(msg) {
        this.busy = false;
        if (msg.type === 'result') {
            this.detectMs = msg.ms;
            this.process({ landmarks: msg.landmarks }, performance.now() / 1000);
        }
    }

    stopStream() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
    }

    update(nowMs, dt) {
        const v = this.video;
        if (this.status === 'running' && !this.busy && v.readyState >= 2 && nowMs >= this.nextDetect && v.currentTime !== this.lastVideoTime) {
            this.lastVideoTime = v.currentTime;
            this.nextDetect = nowMs + DETECT_EVERY;
            if (this.worker) {
                this.busy = true;
                createImageBitmap(v).then(bitmap => {
                    this.worker.postMessage({ type: 'frame', bitmap, ts: nowMs }, [bitmap]);
                }).catch(() => { this.busy = false; });
            } else {
                const t0 = performance.now();
                let res = null;
                try { res = this.landmarker.detectForVideo(v, nowMs); } catch { res = null; }
                this.detectMs = performance.now() - t0;
                if (res) this.process(res, nowMs / 1000);
            }
        }
        this.steer += (this.target - this.steer) * (1 - Math.exp(-dt / 0.08));
    }

    process(res, now) {
        const aspect = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
        this.hands = (res.landmarks || []).map(lm => lm.map(p => ({ x: this.mirrored ? 1 - p.x : p.x, y: p.y })));
        this.palms = this.hands.map(lm => {
            let x = 0, y = 0;
            for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
            return { x: x / PALM.length, y: y / PALM.length };
        }).sort((a, b) => a.x - b.x);
        if (this.palms.length) this.lastAny = now;
        if (this.palms.length >= 2) {
            const L = this.palms[0], R = this.palms[this.palms.length - 1];
            // Image y grows downwards: a lower right hand means the wheel is turned clockwise.
            const ang = Math.atan2(R.y - L.y, Math.max(0.05, (R.x - L.x) * aspect));
            this.angle = ang;
            const a = Math.abs(ang) < DEADZONE ? 0 : ang - Math.sign(ang) * DEADZONE;
            this.target = clamp(a / (FULL_LOCK - DEADZONE), -1, 1) * (this.swap ? -1 : 1);
            this.lastBoth = now;
        } else {
            this.target *= 0.8;
        }
    }

    // Throttle / steering for this frame. now = seconds.
    controls(now) {
        if (this.status !== 'running') return null;
        if (now - this.lastBoth < GRACE) return { throttle: 1, steer: this.steer, hands: 2 };
        if (now - this.lastAny < GRACE) return { throttle: 0.5, steer: this.steer, hands: 1 };
        return { throttle: 0, steer: 0, hands: 0 };
    }

    drawPreview(canvas) {
        const c = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        c.fillStyle = '#111';
        c.fillRect(0, 0, w, h);
        const v = this.video;
        if (v.readyState >= 2) {
            c.save();
            if (this.mirrored) { c.translate(w, 0); c.scale(-1, 1); }
            c.drawImage(v, 0, 0, w, h);
            c.restore();
            c.fillStyle = 'rgba(0,0,0,0.25)';
            c.fillRect(0, 0, w, h);
        }
        c.lineWidth = Math.max(2, w / 160);
        for (const lm of this.hands) {
            c.strokeStyle = '#7dff6a';
            for (const bone of BONES) {
                c.beginPath();
                bone.forEach((i, k) => (k ? c.lineTo(lm[i].x * w, lm[i].y * h) : c.moveTo(lm[i].x * w, lm[i].y * h)));
                c.stroke();
            }
        }
        const now = performance.now() / 1000;
        const ctl = this.controls(now);
        if (this.palms.length >= 2) {
            const L = this.palms[0], R = this.palms[this.palms.length - 1];
            c.strokeStyle = '#ffd83a';
            c.lineWidth = Math.max(3, w / 90);
            c.beginPath();
            c.moveTo(L.x * w, L.y * h);
            c.lineTo(R.x * w, R.y * h);
            c.stroke();
        }
        // Steering gauge
        const gx = w / 2, gy = h - h * 0.12, gw = w * 0.35;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(gx - gw - 6, gy - 10, gw * 2 + 12, 20);
        c.fillStyle = '#ffd83a';
        const sv = ctl ? ctl.steer : 0;
        c.fillRect(gx, gy - 6, sv * gw, 12);
        c.fillStyle = '#fff';
        c.fillRect(gx - 1, gy - 10, 2, 20);
        c.font = `${Math.max(10, w / 32)}px "Press Start 2P", monospace`;
        c.textAlign = 'center';
        c.fillStyle = !ctl ? '#fff' : ctl.hands === 2 ? '#7dff6a' : ctl.hands === 1 ? '#ffd83a' : '#ff6a6a';
        const msg = !ctl ? (this.status === 'loading' ? 'LOADING...' : this.status === 'error' ? 'CAMERA ERROR' : 'CAMERA OFF')
            : ctl.hands === 2 ? (Math.abs(sv) < 0.05 ? 'STRAIGHT' : sv > 0 ? 'RIGHT' : 'LEFT')
                : ctl.hands === 1 ? 'ONE HAND: SLOW' : 'NO HANDS: STOP';
        c.fillText(msg, gx, h * 0.1);
    }
}
