import * as THREE from 'three';

export const TEX = {};

function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
}

function toTexture(c, { pixel = true, repeat = true } = {}) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (pixel) {
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

function girderTex() {
    const c = canvas(32, 32);
    const g = c.getContext('2d');
    g.fillStyle = '#e62210';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#ff5544';
    g.fillRect(0, 0, 32, 3);
    g.fillRect(0, 0, 3, 32);
    g.fillStyle = '#800a00';
    g.fillRect(0, 29, 32, 3);
    g.fillRect(29, 0, 3, 32);
    // Girder cross bracing pattern
    g.strokeStyle = '#800a00';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(2, 2); g.lineTo(30, 30);
    g.moveTo(30, 2); g.lineTo(2, 30);
    g.stroke();
    return toTexture(c);
}

function ladderTex() {
    const c = canvas(16, 32);
    const g = c.getContext('2d');
    g.fillStyle = '#808090';
    g.fillRect(0, 0, 16, 32);
    g.fillStyle = '#000000';
    g.fillRect(3, 0, 10, 32);
    g.fillStyle = '#40c0ff';
    g.fillRect(1, 0, 2, 32);
    g.fillRect(13, 0, 2, 32);
    for (let y = 4; y < 32; y += 8) {
        g.fillStyle = '#40c0ff';
        g.fillRect(2, y, 12, 3);
    }
    return toTexture(c);
}

function barrelTex() {
    const c = canvas(32, 32);
    const g = c.getContext('2d');
    g.fillStyle = '#a0501a';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#5a2600';
    for (let y = 0; y < 32; y += 8) g.fillRect(0, y, 32, 2);
    g.fillStyle = '#404040';
    g.fillRect(0, 4, 32, 4);
    g.fillRect(0, 24, 32, 4);
    g.fillStyle = '#808080';
    g.fillRect(0, 4, 32, 1);
    g.fillRect(0, 24, 32, 1);
    return toTexture(c);
}

export function initTextures() {
    TEX.girder = girderTex();
    TEX.ladder = ladderTex();
    TEX.barrel = barrelTex();
}

const textCache = new Map();
export function textTexture(text, color = '#ffffff') {
    const key = text + color;
    if (textCache.has(key)) return textCache.get(key);
    const c = canvas(256, 64);
    const g = c.getContext('2d');
    g.font = '28px "Press Start 2P", "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#000000';
    g.strokeText(text, 128, 34);
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    const t = toTexture(c, { pixel: false, repeat: false });
    textCache.set(key, t);
    return t;
}
