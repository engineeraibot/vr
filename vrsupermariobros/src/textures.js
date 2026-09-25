// Procedural pixel-art textures (drawn on canvases, no image assets needed).
import * as THREE from 'three';

export const TEX = {};

function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
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

function pixelTex(draw) {
    const c = canvas(16, 16);
    const g = c.getContext('2d');
    const px = (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    draw(px);
    return toTexture(c);
}

// Rough stone block, used for the floor.
function groundTex(base, light, dark) {
    return pixelTex(px => {
        px(0, 0, base, 16, 16);
        px(0, 0, light, 15, 1);
        px(0, 0, light, 1, 15);
        px(0, 15, dark, 16, 1);
        px(15, 0, dark, 1, 16);
        for (let y = 1; y < 6; y++) { px(9, y, dark); px(10, y, light); }
        px(10, 6, dark); px(11, 6, dark); px(12, 7, dark); px(13, 7, dark); px(14, 7, dark);
        px(11, 7, light); px(12, 8, light); px(13, 8, light);
        for (let x = 1; x < 6; x++) { px(x, 9, dark); px(x, 10, light); }
        px(6, 10, dark);
        for (let y = 11; y < 15; y++) { px(6, y, dark); px(7, y, light); }
        px(12, 11, dark); px(13, 11, dark); px(12, 12, light);
        px(3, 3, dark); px(4, 3, light);
    });
}

function brickTex(base, light, mortar) {
    return pixelTex(px => {
        px(0, 0, base, 16, 16);
        for (const y of [0, 4, 8, 12]) px(0, y, light, 16, 1);
        for (const y of [3, 7, 11, 15]) px(0, y, mortar, 16, 1);
        const joints = [[0, [7, 15]], [4, [3, 11]], [8, [7, 15]], [12, [3, 11]]];
        for (const [y0, xs] of joints) for (const x of xs) px(x, y0, mortar, 1, 3);
    });
}

const QMARK = [
    '.XXXX.',
    'XX..XX',
    'XX..XX',
    '...XX.',
    '..XX..',
    '..XX..',
    '......',
    '..XX..',
    '..XX..',
];

function questionTex() {
    return pixelTex(px => {
        px(0, 0, '#f7a81c', 16, 16);
        px(0, 0, '#ffd66a', 16, 1);
        px(0, 0, '#ffd66a', 1, 16);
        px(0, 15, '#9a4a00', 16, 1);
        px(15, 0, '#9a4a00', 1, 16);
        for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, '#5a2600');
        QMARK.forEach((row, y) => [...row].forEach((ch, x) => {
            if (ch === 'X') px(5 + x + 1, 3 + y + 1, '#8a4000');
        }));
        QMARK.forEach((row, y) => [...row].forEach((ch, x) => {
            if (ch === 'X') px(5 + x, 3 + y, '#fff6d0');
        }));
    });
}

function usedTex() {
    return pixelTex(px => {
        px(0, 0, '#a0582a', 16, 16);
        px(0, 0, '#c07848', 16, 1);
        px(0, 0, '#c07848', 1, 16);
        px(0, 15, '#4a2208', 16, 1);
        px(15, 0, '#4a2208', 1, 16);
        for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, '#3a1804');
    });
}

function hardTex(base, light, dark) {
    return pixelTex(px => {
        px(0, 0, base, 16, 16);
        for (let i = 0; i < 2; i++) {
            px(i, i, light, 16 - 2 * i, 1);
            px(i, i, light, 1, 16 - 2 * i);
            px(i, 15 - i, dark, 16 - 2 * i, 1);
            px(15 - i, i, dark, 1, 16 - 2 * i);
        }
        px(4, 4, light, 2, 1);
        px(10, 11, dark, 2, 1);
    });
}

// Vertical stripes wrapped around a cylinder: u = 0 faces +z (towards the camera).
function pipeTex() {
    const c = canvas(64, 4);
    const g = c.getContext('2d');
    const bands = [
        [0.00, '#34b834'], [0.04, '#b4fa94'], [0.10, '#34b834'], [0.14, '#78e468'],
        [0.17, '#2aa42a'], [0.40, '#157a1a'], [0.62, '#1e901e'], [0.86, '#34b834'],
    ];
    for (let x = 0; x < 64; x++) {
        const u = x / 64;
        let col = bands[0][1];
        for (const [s, cc] of bands) if (u >= s) col = cc;
        g.fillStyle = col;
        g.fillRect(x, 0, 1, 4);
    }
    const t = toTexture(c);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
}

function emblemTex() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e0201c';
    g.font = 'bold 84px Arial Black, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('M', 64, 70);
    return toTexture(c, { pixel: false, repeat: false });
}

function flagTex() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(64, 2); g.lineTo(0, 32); g.lineTo(64, 62);
    g.closePath();
    g.fill();
    g.fillStyle = '#1ca01c';
    g.beginPath(); g.arc(46, 32, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(46, 32, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1ca01c';
    g.fillRect(44, 22, 4, 20);
    return toTexture(c, { pixel: false, repeat: false });
}

function starFlagTex() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 8, 64, 48);
    g.fillStyle = '#e0201c';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 9 : 20;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    return toTexture(c, { pixel: false, repeat: false });
}

export function initTextures() {
    TEX.ground = groundTex('#d0641e', '#ffc79a', '#4a1a02');
    TEX.brick = brickTex('#c0501a', '#ff9f6a', '#2a0e00');
    TEX.question = questionTex();
    TEX.used = usedTex();
    TEX.hard = hardTex('#c0601c', '#ffb070', '#5a1e04');
    TEX.ugGround = groundTex('#1a6a8a', '#9fe8ff', '#002030');
    TEX.ugBrick = brickTex('#1a7a9a', '#7fe0f0', '#002433');
    TEX.pipe = pipeTex();
    TEX.emblem = emblemTex();
    TEX.flag = flagTex();
    TEX.starFlag = starFlagTex();
}

// Text sprites for score popups ("100", "1UP", ...)
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
export function clearTextCache() {
    for (const t of textCache.values()) t.dispose();
    textCache.clear();
}
