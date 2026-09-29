// Runs MediaPipe's HandLandmarker off the main thread so hand tracking never stalls the VR view.
// MediaPipe loads its WebAssembly glue with importScripts(), which module workers lack,
// so this provides one (synchronous fetch + global eval).
self.importScripts = (...urls) => {
    for (const url of urls) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send();
        (0, eval)(`${xhr.responseText}\n//# sourceURL=${url}`);
    }
};

let landmarker = null;
let lastTs = 0;

async function create(mp, model, confidence = 0.5, delegate = 'GPU') {
    const { FilesetResolver, HandLandmarker } = await import(`${mp}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${mp}/wasm`);
    const options = delegate => ({
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: confidence,
        minHandPresenceConfidence: confidence,
        minTrackingConfidence: confidence,
    });
    const other = delegate === 'GPU' ? 'CPU' : 'GPU';
    try {
        return { lm: await HandLandmarker.createFromOptions(fileset, options(delegate)), delegate };
    } catch {
        return { lm: await HandLandmarker.createFromOptions(fileset, options(other)), delegate: other };
    }
}

self.onmessage = async e => {
    const msg = e.data;
    try {
        if (msg.type === 'init') {
            const made = await create(msg.mp, msg.model, msg.confidence, msg.delegate);
            landmarker = made.lm;
            self.postMessage({ type: 'ready', delegate: made.delegate });
        } else if (msg.type === 'frame') {
            const t0 = performance.now();
            // MediaPipe refuses (permanently) timestamps that don't increase.
            lastTs = Math.max(msg.ts, lastTs + 1);
            const res = landmarker.detectForVideo(msg.bitmap, lastTs);
            msg.bitmap.close();
            self.postMessage({ type: 'result', landmarks: res.landmarks || [], ms: performance.now() - t0 });
        }
    } catch (err) {
        if (msg.bitmap) msg.bitmap.close();
        self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
};
