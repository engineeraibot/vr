// Phone-headset VR without WebXR: the page draws the side-by-side stereo view itself
// and reads head rotation from the gyroscope. Browsers stop sending motion-sensor
// events to the page during a WebXR session, but not here (camera access too).
import * as THREE from 'three';

const LS_VIEWER = 'kart64.viewer';
const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90deg around x
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const d2r = THREE.MathUtils.degToRad;

function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return window.orientation || 0;
}

// Head rotation from 'deviceorientation' (same maths three.js' old DeviceOrientationControls used).
export class PhoneHead {
    constructor() {
        this.quat = new THREE.Quaternion();
        this.data = null;
        this.listening = false;
        this._on = e => {
            if (e.alpha === null || e.alpha === undefined) return;
            this.data = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
        };
    }

    // Like BodyMotion.enable(): call it from taps until the browser grants permission.
    async enable() {
        if (typeof DeviceOrientationEvent === 'undefined') return false;
        if (!this.listening) {
            window.addEventListener('deviceorientation', this._on);
            this.listening = true;
        }
        if (this.granted || typeof DeviceOrientationEvent.requestPermission !== 'function') return true;
        try {
            this.granted = await DeviceOrientationEvent.requestPermission() === 'granted';
        } catch {
            this.granted = false;
        }
        return this.granted;
    }

    update() {
        const d = this.data;
        if (!d) return false;
        _euler.set(d2r(d.beta), d2r(d.alpha), -d2r(d.gamma), 'YXZ');
        this.quat.setFromEuler(_euler).multiply(Q1).multiply(_q0.setFromAxisAngle(ZEE, -d2r(screenAngle())));
        return true;
    }
}

// Headset lens profiles, in metres (values from the Cardboard viewer specifications).
export const VIEWERS = {
    v2: { interLens: 0.064, screenToLens: 0.039, trayToLens: 0.035, k1: 0.34, k2: 0.55, maxFov: 60 },
    v1: { interLens: 0.060, screenToLens: 0.042, trayToLens: 0.035, k1: 0.441, k2: 0.156, maxFov: 40 },
    none: { interLens: 0.064, screenToLens: 0.039, trayToLens: 0.035, k1: 0, k2: 0, maxFov: 60 },
};
const BEZEL = 0.0035;            // metres between the tray and the bottom of the screen
const CSS_PX_PER_INCH = 150;     // typical for phones (1 CSS px = 1 Android dp)

// Side-by-side stereo rendering using the Cardboard optical model: each eye gets an
// off-axis view centred on its lens, and the image is pre-warped so the lens undoes it.
export class StereoView {
    constructor(renderer) {
        this.renderer = renderer;
        this.active = false;
        let v = null;
        try { v = localStorage.getItem(LS_VIEWER); } catch { /* ignore */ }
        this.viewerId = VIEWERS[v] ? v : 'v2';
        const dpi = parseFloat(new URLSearchParams(location.search).get('dpi'));
        this.metersPerPx = 0.0254 / (dpi > 50 ? dpi : CSS_PX_PER_INCH);

        this.eye = new THREE.PerspectiveCamera();
        this.eye.matrixAutoUpdate = false;
        this.eye.matrixWorldAutoUpdate = false;
        this.rt = new THREE.WebGLRenderTarget(16, 16, { samples: 4 });
        this.rt.texture.colorSpace = THREE.SRGBColorSpace;
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                offset: { value: new THREE.Vector2() },   // viewport's lower-left corner relative to the lens (m)
                size: { value: new THREE.Vector2() },     // viewport size (m)
                screenToLens: { value: 0.039 },
                k: { value: new THREE.Vector2() },
                frustum: { value: new THREE.Vector4() },  // tan angles: left, bottom, right, top
            },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 offset;
                uniform vec2 size;
                uniform float screenToLens;
                uniform vec2 k;
                uniform vec4 frustum;
                varying vec2 vUv;
                void main() {
                    // Where this pixel sits relative to the lens, as a tangent of the viewing angle...
                    vec2 s = (offset + vUv * size) / screenToLens;
                    float r2 = dot(s, s);
                    // ...and the direction the lens makes the eye see it in.
                    vec2 t = s * (1.0 + k.x * r2 + k.y * r2 * r2);
                    vec2 uv = (t - frustum.xy) / (frustum.zw - frustum.xy);
                    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    else gl_FragColor = texture2D(tDiffuse, uv);
                    #include <colorspace_fragment>
                }`,
            depthTest: false,
            depthWrite: false,
        }));
        this.quad.frustumCulled = false;
        this.quadScene = new THREE.Scene();
        this.quadScene.add(this.quad);
        this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.size = new THREE.Vector2();
        this.offset = new THREE.Matrix4();
    }

    setViewer(id) {
        if (!VIEWERS[id]) return;
        this.viewerId = id;
        try { localStorage.setItem(LS_VIEWER, id); } catch { /* ignore */ }
    }

    render(scene, head) {
        const r = this.renderer;
        const V = VIEWERS[this.viewerId];
        r.getSize(this.size);
        const w = this.size.x / 2, h = this.size.y;
        const pr = r.getPixelRatio();
        const rw = Math.max(1, Math.round(w * pr)), rh = Math.max(1, Math.round(h * pr));
        if (this.rt.width !== rw || this.rt.height !== rh) this.rt.setSize(rw, rh);

        // Physical layout of the screen in the headset (landscape, fullscreen).
        const mpp = this.metersPerPx;
        const Wm = this.size.x * mpp, Hm = h * mpp;
        const lensY = V.trayToLens - BEZEL;
        const d = V.screenToLens;
        const lim = Math.tan(THREE.MathUtils.degToRad(V.maxFov));
        const distort = x => x * (1 + V.k1 * x * x + V.k2 * x * x * x * x);

        scene.updateMatrixWorld();
        const eye = this.eye;
        const n = head.near, f = head.far;
        const u = this.quad.material.uniforms;
        u.tDiffuse.value = this.rt.texture;
        u.screenToLens.value = d;
        u.k.value.set(V.k1, V.k2);
        u.size.value.set(Wm / 2, Hm);

        // Draw the shadow map once for both eyes.
        const autoShadow = r.shadowMap.autoUpdate;
        r.shadowMap.autoUpdate = false;
        r.shadowMap.needsUpdate = true;
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            const lensX = Wm / 2 + side * V.interLens / 2;
            const x0 = (i === 0 ? 0 : Wm / 2) - lensX;
            // Field of view each eye can see through its lens (tangents), limited by the lens size.
            const fl = Math.max(distort(x0 / d), -lim);
            const fr = Math.min(distort((x0 + Wm / 2) / d), lim);
            const fb = Math.max(distort(-lensY / d), -lim);
            const ft = Math.min(distort((Hm - lensY) / d), lim);
            eye.projectionMatrix.makePerspective(fl * n, fr * n, ft * n, fb * n, n, f);
            eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
            this.offset.makeTranslation(side * V.interLens / 2, 0, 0);
            eye.matrixWorld.multiplyMatrices(head.matrixWorld, this.offset);
            eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
            r.setRenderTarget(this.rt);
            r.render(scene, eye);
            r.setRenderTarget(null);

            u.offset.value.set(x0, -lensY);
            u.frustum.value.set(fl, fb, fr, ft);
            r.setViewport(i * w, 0, w, h);
            r.setScissor(i * w, 0, w, h);
            r.setScissorTest(true);
            r.render(this.quadScene, this.quadCam);
        }
        r.setScissorTest(false);
        r.setViewport(0, 0, this.size.x, this.size.y);
        r.shadowMap.autoUpdate = autoShadow;
    }
}
