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

async function create(mp, model) {
    const { FilesetResolver, HandLandmarker } = await import(`${mp}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${mp}/wasm`);
    const options = delegate => ({
        baseOptions: { modelAssetPath: model, delegate },
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

self.onmessage = async e => {
    const msg = e.data;
    try {
        if (msg.type === 'init') {
            landmarker = await create(msg.mp, msg.model);
            self.postMessage({ type: 'ready' });
        } else if (msg.type === 'frame') {
            const t0 = performance.now();
            const res = landmarker.detectForVideo(msg.bitmap, msg.ts);
            msg.bitmap.close();
            self.postMessage({ type: 'result', landmarks: res.landmarks || [], ms: performance.now() - t0 });
        }
    } catch (err) {
        if (msg.bitmap) msg.bitmap.close();
        self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
};
