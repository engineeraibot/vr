// A sunny cartoon garden, used instead of the passthrough when there's no camera
// (or you pick it on the title screen). Same look as the original game's background.
import * as THREE from 'three';

const GROUND_Y = -1.4;

export class Garden {
    constructor() {
        const g = this.group = new THREE.Group();
        const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `
                varying vec3 vP;
                void main() {
                    vec3 top = vec3(0.37, 0.66, 1.0), hor = vec3(0.87, 0.95, 1.0);
                    vec3 c = mix(hor, top, smoothstep(0.0, 0.6, vP.y));
                    gl_FragColor = vec4(c, 1.0);
                    #include <colorspace_fragment>
                }`,
        }));
        sky.renderOrder = -200;
        g.add(sky);

        const ground = new THREE.Mesh(new THREE.CircleGeometry(85, 48), new THREE.MeshLambertMaterial({ color: 0x4f9b22 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = GROUND_Y;
        g.add(ground);

        const rnd = (a, b) => a + Math.random() * (b - a);
        const hillGeo = new THREE.SphereGeometry(1, 20, 10);
        [0x5b9d3a, 0x3e7d22, 0x6aab45].forEach((color, k) => {
            const mat = new THREE.MeshLambertMaterial({ color });
            for (let i = 0; i < 5; i++) {
                const a = (i / 5 + k * 0.07) * Math.PI * 2, d = 55 + k * 8, r = rnd(14, 24);
                const h = new THREE.Mesh(hillGeo, mat);
                h.scale.set(r, r * rnd(0.3, 0.45), r);
                h.position.set(Math.sin(a) * d, GROUND_Y, -Math.cos(a) * d);
                g.add(h);
            }
        });

        const trunk = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), crown = new THREE.SphereGeometry(1, 10, 8);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 }), leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a1e });
        for (let i = 0; i < 14; i++) {
            const a = rnd(0, Math.PI * 2), d = rnd(14, 30);
            const t = new THREE.Group();
            const tr = new THREE.Mesh(trunk, trunkMat);
            tr.position.y = 0.6;
            const cr = new THREE.Mesh(crown, leafMat);
            cr.position.y = 1.8;
            cr.scale.set(1.1, 1.3, 1.1);
            t.add(tr, cr);
            t.scale.setScalar(rnd(1.2, 2));
            t.position.set(Math.sin(a) * d, GROUND_Y, -Math.cos(a) * d);
            g.add(t);
        }

        const puff = new THREE.SphereGeometry(1, 14, 10), cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa4b0 });
        for (let i = 0; i < 8; i++) {
            const c = new THREE.Group();
            for (let j = 0; j < 4; j++) {
                const p = new THREE.Mesh(puff, cloudMat);
                p.position.set((j - 1.5) * 2.2, Math.sin(j * 2) * 0.6, rnd(-0.8, 0.8));
                p.scale.set(rnd(2, 3), rnd(1.3, 2), 2);
                c.add(p);
            }
            const a = i / 8 * Math.PI * 2 + rnd(0, 0.5), d = rnd(45, 60);
            c.position.set(Math.sin(a) * d, rnd(12, 20), -Math.cos(a) * d);
            c.lookAt(0, c.position.y, 0);
            g.add(c);
        }

        const sunTex = (() => {
            const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
            const x = cv.getContext('2d');
            const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
            gr.addColorStop(0, 'rgba(255,250,210,1)');
            gr.addColorStop(0.45, 'rgba(255,236,150,1)');
            gr.addColorStop(1, 'rgba(255,236,150,0)');
            x.fillStyle = gr;
            x.fillRect(0, 0, 64, 64);
            const t = new THREE.CanvasTexture(cv);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        })();
        const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, depthWrite: false, fog: false }));
        sun.position.set(40, 45, -50);
        sun.scale.setScalar(14);
        g.add(sun);
    }
}
