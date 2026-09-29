// Hand steering. The phone's back camera (or a webcam) watches your hands; MediaPipe's
// HandLandmarker finds them. Hold both hands up like on a steering wheel:
//   left hand higher  -> turn right (wheel turned clockwise)
//   right hand higher -> turn left
//   both hands        -> full throttle, one hand -> coast, no hands -> the kart stops.
//
// Inside a headset the camera moves with your head, so:
//   - head tilt is subtracted (rollFn) so tilting your head doesn't steer,
//   - the image's "up" is learned from the hands themselves (wrist -> knuckles), which
//     fixes phones that deliver the camera picture sideways in landscape,
//   - the widest zoom the camera offers is used so hands held low are still in view.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CONFIDENCE = 0.35;
const PALM = [0, 5, 9, 13, 17];
const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
const FULL_LOCK = 35 * Math.PI / 180;   // wheel angle that gives full steering
const DEADZONE = 4 * Math.PI / 180;
const GRACE = 0.5;                      // seconds a missing hand is tolerated (detection hiccups)
const DETECT_EVERY = 40;                // ms between detections
const GRAB_WIDTH = 480;                 // frames are downscaled to this width before detection
const LS_SWAP = 'kart64.swapSteering';
const LS_DELEGATE = 'kart64.tracker';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Fallback when the worker can't run MediaPipe: detect on the main thread.
async function createLandmarker(delegate) {
    const { FilesetResolver, HandLandmarker } = await import(`${MP}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    const options = delegate => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: CONFIDENCE,
        minHandPresenceConfidence: CONFIDENCE,
        minTrackingConfidence: CONFIDENCE,
    });
    try {
        return await HandLandmarker.createFromOptions(fileset, options(delegate));
    } catch {
        return HandLandmarker.createFromOptions(fileset, options(delegate === 'GPU' ? 'CPU' : 'GPU'));
    }
}

export class HandWheel {
    constructor() {
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', '');
        // Kept in the page (invisible) so no browser pauses it for being detached.
        this.video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
        document.body.appendChild(this.video);
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
        this.rate = 0;
        this.rateCount = 0;
        this.rateT = 0;
        this.facing = '';
        this.mirrored = false;
        this.zoom = 1;
        this.rollFn = () => 0;    // camera roll (clockwise, radians) — set by the game in VR
        this.upX = 0;             // learned "up" direction of the hands in the raw image
        this.upY = -1;
        this.rot = 0;             // quarter turns applied to the raw image
        this.frameW = 640;
        this.frameH = 480;
        let swap = null;
        try { swap = localStorage.getItem(LS_SWAP); } catch { /* ignore */ }
        this.swap = swap === '1';
        let delegate = null;
        try { delegate = localStorage.getItem(LS_DELEGATE); } catch { /* ignore */ }
        this.delegate = delegate === 'CPU' ? 'CPU' : 'GPU';   // what the user asked for
        this.activeDelegate = '';                              // what MediaPipe actually runs on
    }

    // GPU is usually fastest, but in VR the GPU is also drawing both eyes; CPU may keep up better.
    async setDelegate(d) {
        this.delegate = d;
        try { localStorage.setItem(LS_DELEGATE, d); } catch { /* ignore */ }
        if (!this.worker && !this.landmarker) return;
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.landmarker = null;
        this.busy = false;
        if (this.status === 'running') {
            this.status = 'loading';
            await this.createDetector();
            this.status = 'running';
        }
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
            const video = { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
            let stream;
            try {
                // zoom: true asks for zoom control, used below to pick the widest view.
                stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, zoom: true } });
            } catch {
                stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
            }
            this.stream = stream;
            this.video.srcObject = stream;
            await this.video.play();
            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings();
            this.facing = settings.facingMode || facing;
            this.mirrored = this.facing !== 'environment'; // a selfie camera sees you mirrored
            await this.widen(track);
            this.upX = 0;
            this.upY = -1;
            this.rot = 0;
            if (!this.worker && !this.landmarker) await this.createDetector();
            this.status = 'running';
        } catch (e) {
            this.status = 'error';
            this.error = e && e.message ? e.message : String(e);
        }
    }

    // Use the widest field of view the camera allows (e.g. the ultra-wide lens).
    async widen(track) {
        this.zoom = 1;
        try {
            const caps = track.getCapabilities ? track.getCapabilities() : {};
            if (caps.zoom && caps.zoom.min < (track.getSettings().zoom || 1)) {
                await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
            }
            this.zoom = track.getSettings().zoom || 1;
        } catch {
            // Zoom not supported: keep the default view.
        }
    }

    // Prefer a worker (smooth rendering); fall back to the main thread.
    async createDetector() {
        try {
            const worker = new Worker(new URL('./hands-worker.js', import.meta.url), { type: 'module' });
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('worker timeout')), 30000);
                worker.onmessage = e => {
                    if (e.data.type === 'ready') { clearTimeout(timer); this.activeDelegate = e.data.delegate; resolve(); }
                    if (e.data.type === 'error') { clearTimeout(timer); reject(new Error(e.data.message)); }
                };
                worker.onerror = err => { clearTimeout(timer); reject(err); };
                worker.postMessage({ type: 'init', mp: MP, model: MODEL, confidence: CONFIDENCE, delegate: this.delegate });
            });
            worker.onmessage = e => this.onWorker(e.data);
            this.worker = worker;
            this.busy = false;
        } catch {
            this.landmarker = await createLandmarker(this.delegate);
            this.activeDelegate = this.delegate + ' (main thread)';
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

    // Draw the current video frame (downscaled) exactly as the preview shows it, so the
    // detector and the preview always agree on the picture's orientation.
    grabFrame() {
        const v = this.video;
        const w = GRAB_WIDTH, h = Math.round(GRAB_WIDTH * v.videoHeight / v.videoWidth);
        // The worker gets an OffscreenCanvas (cheap transfer); the fallback detector a normal canvas.
        const offscreen = !!this.worker && typeof OffscreenCanvas !== 'undefined';
        if (!this.grab || this.grab.width !== w || this.grab.height !== h || (this.grab instanceof HTMLCanvasElement) === offscreen) {
            this.grab = offscreen ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
            this.grabCtx = this.grab.getContext('2d');
        }
        this.grabCtx.drawImage(v, 0, 0, w, h);
        this.frameW = w;
        this.frameH = h;
        return this.grab;
    }

    update(nowMs, dt) {
        const v = this.video;
        if (this.status === 'running' && !this.busy && v.readyState >= 2 && v.videoWidth && nowMs >= this.nextDetect && v.currentTime !== this.lastVideoTime) {
            this.lastVideoTime = v.currentTime;
            this.nextDetect = nowMs + DETECT_EVERY;
            const frame = this.grabFrame();
            if (this.worker) {
                this.busy = true;
                const send = bitmap => this.worker.postMessage({ type: 'frame', bitmap, ts: nowMs }, [bitmap]);
                if (frame.transferToImageBitmap) send(frame.transferToImageBitmap());
                else createImageBitmap(frame).then(send).catch(() => { this.busy = false; });
            } else {
                const t0 = performance.now();
                let res = null;
                this.lastTs = Math.max(nowMs, (this.lastTs || 0) + 1);
                try { res = this.landmarker.detectForVideo(frame, this.lastTs); } catch { res = null; }
                this.detectMs = performance.now() - t0;
                if (res) this.process(res, nowMs / 1000);
            }
        }
        this.steer += (this.target - this.steer) * (1 - Math.exp(-dt / 0.06));
        this.rateT += dt;
        if (this.rateT >= 1) { this.rate = this.rateCount / this.rateT; this.rateCount = 0; this.rateT = 0; }
    }

    process(res, now) {
        this.rateCount++;
        const W = this.frameW, H = this.frameH;
        let hands = (res.landmarks || []).map(lm => lm.map(p => ({ x: this.mirrored ? 1 - p.x : p.x, y: p.y })));

        // Learn which way is up in the picture: raised hands point up from wrist to knuckles.
        for (const lm of hands) {
            const dx = (lm[9].x - lm[0].x) * W, dy = (lm[9].y - lm[0].y) * H;
            const l = Math.hypot(dx, dy);
            if (l < 1e-6) continue;
            this.upX += (dx / l - this.upX) * 0.06;
            this.upY += (dy / l - this.upY) * 0.06;
        }
        if (Math.hypot(this.upX, this.upY) > 0.65) {
            const a = Math.atan2(this.upX, -this.upY);
            const k = ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
            if (k !== this.rot && Math.abs(a - Math.round(a / (Math.PI / 2)) * Math.PI / 2) < Math.PI / 6) this.rot = k;
        }
        const odd = this.rot % 2 === 1;
        const W2 = odd ? H : W, H2 = odd ? W : H;
        if (this.rot) {
            const th = -this.rot * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
            hands = hands.map(lm => lm.map(p => {
                const X = (p.x - 0.5) * W, Y = (p.y - 0.5) * H;
                return { x: (X * c - Y * s) / W2 + 0.5, y: (X * s + Y * c) / H2 + 0.5 };
            }));
        }
        this.hands = hands;
        const aspect = W2 / H2;

        let palms = hands.map(lm => {
            let x = 0, y = 0;
            for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
            return { x: x / PALM.length, y: y / PALM.length };
        }).sort((a, b) => a.x - b.x);
        // The same hand detected twice counts as one.
        if (palms.length >= 2 && Math.hypot((palms[1].x - palms[0].x) * aspect, palms[1].y - palms[0].y) < 0.08) palms = [palms[0]];
        this.palms = palms;
        if (palms.length) this.lastAny = now;
        if (palms.length >= 2) {
            const L = palms[0], R = palms[palms.length - 1];
            // Image y grows downwards: a lower right hand means the wheel is turned clockwise.
            // Adding the head's own clockwise roll makes the angle relative to the real horizon.
            const ang = Math.atan2(R.y - L.y, Math.max(0.05, (R.x - L.x) * aspect)) + this.rollFn();
            this.angle = ang;
            const a = Math.abs(ang) < DEADZONE ? 0 : ang - Math.sign(ang) * DEADZONE;
            this.target = clamp(a / (FULL_LOCK - DEADZONE), -1, 1) * (this.swap ? -1 : 1);
            this.lastBoth = now;
        } else if (now - this.lastBoth > GRACE) {
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

    // Camera picture with what the tracker sees drawn on top.
    // opts.fit: resize the canvas to the picture's aspect (passthrough); opts.dim: darken the picture.
    drawPreview(canvas, opts = {}) {
        const v = this.video;
        const odd = this.rot % 2 === 1;
        const W = v.videoWidth || this.frameW, H = v.videoHeight || this.frameH;
        const W2 = odd ? H : W, H2 = odd ? W : H;
        if (opts.fit) {
            const h = Math.round(canvas.width * H2 / W2);
            if (canvas.height !== h) canvas.height = h;
        }
        const c = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        c.fillStyle = '#111';
        c.fillRect(0, 0, cw, ch);
        const k = Math.min(cw / W2, ch / H2);
        const dw = W2 * k, dh = H2 * k, ox = (cw - dw) / 2, oy = (ch - dh) / 2;
        if (v.readyState >= 2) {
            c.save();
            c.translate(cw / 2, ch / 2);
            c.rotate(-this.rot * Math.PI / 2);
            if (this.mirrored) c.scale(-1, 1);
            c.drawImage(v, -W * k / 2, -H * k / 2, W * k, H * k);
            c.restore();
            if (opts.dim !== false) {
                c.fillStyle = 'rgba(0,0,0,0.2)';
                c.fillRect(0, 0, cw, ch);
            }
        }
        const X = x => ox + x * dw, Y = y => oy + y * dh;
        c.lineWidth = Math.max(2, cw / 150);
        c.strokeStyle = '#7dff6a';
        for (const lm of this.hands) {
            for (const bone of BONES) {
                c.beginPath();
                bone.forEach((i, n) => (n ? c.lineTo(X(lm[i].x), Y(lm[i].y)) : c.moveTo(X(lm[i].x), Y(lm[i].y))));
                c.stroke();
            }
        }
        const ctl = this.controls(performance.now() / 1000);
        if (this.palms.length >= 2) {
            const L = this.palms[0], R = this.palms[this.palms.length - 1];
            c.strokeStyle = '#ffd83a';
            c.lineWidth = Math.max(3, cw / 90);
            c.beginPath();
            c.moveTo(X(L.x), Y(L.y));
            c.lineTo(X(R.x), Y(R.y));
            c.stroke();
        }
        // Steering gauge
        const gx = cw / 2, gy = ch - ch * 0.1, gw = cw * 0.35;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(gx - gw - 6, gy - 10, gw * 2 + 12, 20);
        c.fillStyle = '#ffd83a';
        const sv = ctl ? ctl.steer : 0;
        c.fillRect(gx, gy - 6, sv * gw, 12);
        c.fillStyle = '#fff';
        c.fillRect(gx - 1, gy - 10, 2, 20);
        c.font = `${Math.max(10, cw / 30)}px "Press Start 2P", monospace`;
        c.textAlign = 'center';
        c.fillStyle = !ctl ? '#fff' : ctl.hands === 2 ? '#7dff6a' : ctl.hands === 1 ? '#ffd83a' : '#ff6a6a';
        const msg = !ctl ? (this.status === 'loading' ? 'LOADING...' : this.status === 'error' ? 'CAMERA ERROR' : 'CAMERA OFF')
            : ctl.hands === 2 ? (Math.abs(sv) < 0.05 ? 'STRAIGHT' : sv > 0 ? 'RIGHT' : 'LEFT')
                : ctl.hands === 1 ? 'ONE HAND: SLOW' : 'NO HANDS: STOP';
        c.fillText(msg, gx, ch * 0.1);
        if (ctl) {
            c.font = `${Math.max(8, cw / 45)}px "Press Start 2P", monospace`;
            c.fillStyle = 'rgba(255,255,255,0.8)';
            c.fillText(`${Math.round(this.rate)} Hz ${this.activeDelegate.split(' ')[0]}${this.rot ? ` ROT ${this.rot * 90}` : ''}${this.zoom < 1 ? ` WIDE x${this.zoom}` : ''}`, gx, ch * 0.18);
        }
        if (opts.label) {
            c.font = `${Math.max(8, cw / 50)}px "Press Start 2P", monospace`;
            c.fillStyle = 'rgba(0,0,0,0.6)';
            c.fillRect(0, ch * 0.22, cw, ch * 0.06);
            c.fillStyle = '#fff';
            c.fillText(opts.label, gx, ch * 0.265);
        }
        // Palm centres and hand count, useful when debugging detection.
        c.fillStyle = '#ff4fd8';
        for (const p of this.palms) {
            c.beginPath();
            c.arc(X(p.x), Y(p.y), Math.max(4, cw / 80), 0, Math.PI * 2);
            c.fill();
        }
    }
}
