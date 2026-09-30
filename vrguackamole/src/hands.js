// Hand tracking. The phone's back camera (or a webcam) watches your hands; MediaPipe's
// HandLandmarker finds them in a worker. Every result remembers when its camera frame was
// grabbed, so the game can work out where your head was pointing when the picture was taken.
//
// Same camera tricks as in vrkart:
//   - the image's "up" is learned from the hands themselves (wrist -> knuckles), which
//     fixes phones that deliver the camera picture sideways in landscape,
//   - the widest zoom the camera offers is used, so more of the room is visible.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CONFIDENCE = 0.35;
const PALM = [0, 5, 9, 13, 17];
export const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
const DETECT_EVERY = 33;                // ms between detections
const GRAB_WIDTH = 480;                 // frames are downscaled to this width before detection
const LS_DELEGATE = 'guacamole.tracker';

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

export class HandTracker {
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
        this.hands = [];          // landmarks of the last detection, upright picture, 0..1
        this.result = null;
        this.fresh = false;
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
        this.upX = 0;             // learned "up" direction of the hands in the raw image
        this.upY = -1;
        this.rot = 0;             // quarter turns applied to the raw image
        this.frameW = 640;
        this.frameH = 480;
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
            // A bit more resolution than vrkart: here the picture is also what you see.
            const video = { facingMode: { ideal: facing }, width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
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
            // First guess until the hands say otherwise: a portrait picture on a landscape screen is sideways.
            const sideways = this.facing === 'environment' && innerWidth > innerHeight && this.video.videoHeight > this.video.videoWidth;
            this.rot = sideways ? 1 : 0;
            this.upX = sideways ? 1 : 0;
            this.upY = sideways ? 0 : -1;
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
            this.process({ landmarks: msg.landmarks }, msg.ts / 1000);
        }
    }

    stopStream() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
    }

    // Size of the upright picture (after the quarter turns).
    displaySize() {
        const v = this.video;
        const W = v.videoWidth || this.frameW, H = v.videoHeight || this.frameH;
        return this.rot % 2 ? { w: H, h: W } : { w: W, h: H };
    }

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

    update(nowMs) {
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
        const now = nowMs / 1000;
        if (!this.rateT) this.rateT = now;
        if (now - this.rateT >= 1) { this.rate = this.rateCount / (now - this.rateT); this.rateCount = 0; this.rateT = now; }
    }

    // t = when the frame was grabbed (seconds, performance.now() clock)
    process(res, t) {
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
        const aspect = W2 / H2;
        let out = hands.map(lm => {
            let x = 0, y = 0;
            for (const i of PALM) { x += lm[i].x; y += lm[i].y; }
            return { lm, palm: { x: x / PALM.length, y: y / PALM.length } };
        });
        // The same hand detected twice counts as one.
        if (out.length >= 2 && Math.hypot((out[1].palm.x - out[0].palm.x) * aspect, out[1].palm.y - out[0].palm.y) < 0.08) out = [out[0]];
        this.hands = out.map(h => h.lm);
        if (out.length) this.lastAny = t;
        this.result = { t, hands: out };
        this.fresh = true;
    }

    // The newest detection, once.
    take() {
        if (!this.fresh) return null;
        this.fresh = false;
        return this.result;
    }

    // The upright (and, for a selfie camera, mirrored) camera picture. The canvas keeps its
    // width and takes the picture's aspect ratio; returns true when its size changed.
    drawVideo(canvas) {
        const v = this.video;
        const { w: W2, h: H2 } = this.displaySize();
        const h = Math.round(canvas.width * H2 / W2);
        let resized = false;
        if (canvas.height !== h) { canvas.height = h; resized = true; }
        const c = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        const k = cw / W2;
        c.save();
        c.translate(cw / 2, ch / 2);
        c.rotate(-this.rot * Math.PI / 2);
        if (this.mirrored) c.scale(-1, 1);
        c.drawImage(v, -v.videoWidth * k / 2, -v.videoHeight * k / 2, v.videoWidth * k, v.videoHeight * k);
        c.restore();
        return resized;
    }

    // Camera picture with what the tracker sees, for the title screen.
    drawPreview(canvas) {
        const c = canvas.getContext('2d');
        const cw = canvas.width, ch = canvas.height;
        c.fillStyle = '#111';
        c.fillRect(0, 0, cw, ch);
        const v = this.video;
        const { w: W2, h: H2 } = this.displaySize();
        const k = Math.min(cw / W2, ch / H2);
        const dw = W2 * k, dh = H2 * k, ox = (cw - dw) / 2, oy = (ch - dh) / 2;
        if (v.readyState >= 2) {
            c.save();
            c.translate(cw / 2, ch / 2);
            c.rotate(-this.rot * Math.PI / 2);
            if (this.mirrored) c.scale(-1, 1);
            c.drawImage(v, -v.videoWidth * k / 2, -v.videoHeight * k / 2, v.videoWidth * k, v.videoHeight * k);
            c.restore();
        }
        const X = x => ox + x * dw, Y = y => oy + y * dh;
        c.lineWidth = Math.max(2, cw / 150);
        c.strokeStyle = '#ffc14a';
        for (const lm of this.hands) {
            for (const bone of BONES) {
                c.beginPath();
                bone.forEach((i, n) => (n ? c.lineTo(X(lm[i].x), Y(lm[i].y)) : c.moveTo(X(lm[i].x), Y(lm[i].y))));
                c.stroke();
            }
        }
        const seen = performance.now() / 1000 - this.lastAny < 0.4 ? this.hands.length : 0;
        c.font = `bold ${Math.max(11, cw / 22)}px Fredoka, sans-serif`;
        c.textAlign = 'center';
        c.fillStyle = seen ? '#9fff7a' : '#ff9a7a';
        const msg = this.status === 'loading' ? 'LOADING...' : this.status === 'error' ? 'CAMERA ERROR'
            : this.status === 'off' ? 'CAMERA OFF' : seen === 2 ? 'BOTH HANDS' : seen === 1 ? 'ONE HAND' : 'SHOW YOUR HANDS';
        c.fillText(msg, cw / 2, ch * 0.12);
        if (this.status === 'running') {
            c.font = `${Math.max(9, cw / 32)}px Fredoka, sans-serif`;
            c.fillStyle = 'rgba(255,255,255,0.85)';
            c.fillText(`${Math.round(this.rate)} checks/s ${this.activeDelegate.split(' ')[0]}${this.rot ? ` ROT ${this.rot * 90}` : ''}${this.zoom < 1 ? ` WIDE x${this.zoom}` : ''}`, cw / 2, ch * 0.95);
        }
    }
}
