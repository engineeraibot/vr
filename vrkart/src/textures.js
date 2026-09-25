// Procedural textures drawn on canvases (no image files needed).
import * as THREE from 'three';

export const TEX = {};

function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
}

function toTexture(c, { pixel = false, repeat = true } = {}) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (pixel) t.magFilter = THREE.NearestFilter;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

function rand(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Road: u runs across the road (0 = left edge), v along it (one tile = 12 m).
function asphalt() {
    const [c, g] = canvas(256, 256);
    const r = rand(3);
    g.fillStyle = '#62646b';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
        const v = 78 + (r() * 46) | 0;
        g.fillStyle = `rgb(${v},${v},${v + 5})`;
        g.fillRect(r() * 256, r() * 256, 2, 2);
    }
    g.fillStyle = '#f2f2f2';
    g.fillRect(9, 0, 6, 256);
    g.fillRect(241, 0, 6, 256);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(126, 0, 4, 128);
    return toTexture(c);
}

function kerb() {
    const [c, g] = canvas(8, 64);
    g.fillStyle = '#e02424';
    g.fillRect(0, 0, 8, 32);
    g.fillStyle = '#f6f6f6';
    g.fillRect(0, 32, 8, 32);
    return toTexture(c, { pixel: true });
}

function checker() {
    const [c, g] = canvas(128, 32);
    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
            g.fillRect(x * 16, y * 16, 16, 16);
        }
    }
    return toTexture(c, { pixel: true });
}

// Dash panel: yellow chevrons pointing along +v (forward).
function turbo() {
    const [c, g] = canvas(64, 128);
    g.fillStyle = '#d24a00';
    g.fillRect(0, 0, 64, 128);
    for (const y0 of [8, 72]) {
        g.fillStyle = '#ffe23a';
        g.beginPath();
        g.moveTo(6, y0 + 44); g.lineTo(32, y0 + 8); g.lineTo(58, y0 + 44);
        g.lineTo(58, y0 + 56); g.lineTo(32, y0 + 22); g.lineTo(6, y0 + 56);
        g.closePath();
        g.fill();
    }
    g.strokeStyle = '#fff4a0';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 124);
    const t = toTexture(c);
    return t;
}

function grass() {
    const [c, g] = canvas(256, 256);
    const r = rand(7);
    for (let x = 0; x < 4; x++) {
        g.fillStyle = x % 2 ? '#57b746' : '#4fad3f';
        g.fillRect(x * 64, 0, 64, 256);
    }
    for (let i = 0; i < 2500; i++) {
        const light = r() < 0.5;
        g.fillStyle = light ? 'rgba(140,220,110,0.35)' : 'rgba(30,90,30,0.25)';
        g.fillRect(r() * 256, r() * 256, 2, 3);
    }
    return toTexture(c);
}

function water() {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#2f86e6';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(200,235,255,0.55)';
    g.lineWidth = 2;
    for (let y = 8; y < 128; y += 16) {
        g.beginPath();
        for (let x = 0; x <= 128; x += 4) g.lineTo(x, y + Math.sin((x / 128) * Math.PI * 4 + y) * 3);
        g.stroke();
    }
    return toTexture(c);
}

function stone() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#9a8f82';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#6f665c';
    for (const y of [0, 16, 32, 48]) g.fillRect(0, y, 64, 2);
    for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 16 : 0;
        for (let x = off; x < 64; x += 32) g.fillRect(x, row * 16, 2, 16);
    }
    return toTexture(c, { pixel: true });
}

function castleWall() {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#f3e7cc';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e2d3b2';
    for (const y of [0, 21, 42]) g.fillRect(0, y, 64, 1);
    for (let row = 0; row < 3; row++) {
        const off = row % 2 ? 16 : 0;
        for (let x = off; x < 64; x += 32) g.fillRect(x, row * 21, 1, 21);
    }
    return toTexture(c);
}

function banner() {
    const [c, g] = canvas(512, 96);
    for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
            g.fillRect(x * 16, y * 8, 16, 8);
            g.fillRect(x * 16, 80 + y * 8, 16, 8);
        }
    }
    g.fillStyle = '#d21f1f';
    g.fillRect(0, 16, 512, 64);
    g.fillStyle = '#fff';
    g.font = 'bold 52px "Press Start 2P", Arial Black, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('START', 256, 50);
    return toTexture(c, { repeat: false });
}

export function initTextures() {
    TEX.asphalt = asphalt();
    TEX.kerb = kerb();
    TEX.checker = checker();
    TEX.turbo = turbo();
    TEX.grass = grass();
    TEX.water = water();
    TEX.stone = stone();
    TEX.castle = castleWall();
    TEX.banner = banner();
}
