// Phone-headset VR without WebXR: the page draws the side-by-side stereo view itself
// and reads head rotation from the gyroscope. Browsers stop sending motion-sensor
// events to the page during a WebXR session, but not here, so walking in place and
// hopping keep working exactly like on the title screen.
import * as THREE from 'three';

const LS_LENS = 'smb3d.lens';
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

// Side-by-side stereo rendering with optional barrel distortion for the headset lenses.
export class StereoView {
    constructor(renderer) {
        this.renderer = renderer;
        this.active = false;
        this.ipd = 0.064;
        this.fov = 85;
        let lens = null;
        try { lens = localStorage.getItem(LS_LENS); } catch { /* ignore */ }
        this.lens = lens !== 'off';

        this.eye = new THREE.PerspectiveCamera(this.fov, 1, 0.05, 120);
        this.eye.matrixAutoUpdate = false;
        this.eye.matrixWorldAutoUpdate = false;
        this.rt = new THREE.WebGLRenderTarget(16, 16, { samples: 4 });
        this.rt.texture.colorSpace = THREE.SRGBColorSpace;
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
            uniforms: { tDiffuse: { value: null }, aspect: { value: 1 }, k: { value: new THREE.Vector2() } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float aspect;
                uniform vec2 k;
                varying vec2 vUv;
                void main() {
                    vec2 p = (vUv - 0.5) * 2.0;
                    p.x *= aspect;
                    float r2 = dot(p, p);
                    vec2 q = p * (1.0 + k.x * r2 + k.y * r2 * r2) / (1.0 + k.x + k.y);
                    q.x /= aspect;
                    vec2 uv = q * 0.5 + 0.5;
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

    setLens(on) {
        this.lens = on;
        try { localStorage.setItem(LS_LENS, on ? 'on' : 'off'); } catch { /* ignore */ }
    }

    render(scene, head) {
        const r = this.renderer;
        r.getSize(this.size);
        const w = this.size.x / 2, h = this.size.y;
        const pr = r.getPixelRatio();
        const rw = Math.max(1, Math.round(w * pr)), rh = Math.max(1, Math.round(h * pr));
        if (this.rt.width !== rw || this.rt.height !== rh) this.rt.setSize(rw, rh);

        scene.updateMatrixWorld();
        const eye = this.eye;
        eye.fov = this.fov;
        eye.aspect = w / h;
        eye.near = head.near;
        eye.far = head.far;
        eye.updateProjectionMatrix();
        const u = this.quad.material.uniforms;
        u.aspect.value = w / h;
        u.k.value.set(this.lens ? 0.22 : 0, this.lens ? 0.24 : 0);
        u.tDiffuse.value = this.rt.texture;

        // Draw the shadow map once for both eyes.
        const autoShadow = r.shadowMap.autoUpdate;
        r.shadowMap.autoUpdate = false;
        r.shadowMap.needsUpdate = true;
        for (let i = 0; i < 2; i++) {
            this.offset.makeTranslation((i === 0 ? -0.5 : 0.5) * this.ipd, 0, 0);
            eye.matrixWorld.multiplyMatrices(head.matrixWorld, this.offset);
            eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
            r.setRenderTarget(this.rt);
            r.render(scene, eye);
            r.setRenderTarget(null);
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
