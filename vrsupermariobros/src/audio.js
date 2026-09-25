// Chiptune-style sound effects and music synthesized with the Web Audio API.
// All melodies are original compositions (no copyrighted tunes).

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(n) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
    if (!m) return 0;
    const s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    const midi = (parseInt(m[3], 10) + 1) * 12 + s;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// "C5:2 -:2 x:1" -> [[freq|0|'x', sixteenths], ...]
function seq(str) {
    return str.trim().split(/\s+/).map(tok => {
        const [n, d] = tok.split(':');
        const len = parseFloat(d);
        if (n === '-') return [0, len];
        if (n === 'x') return ['x', len];
        return [noteFreq(n), len];
    });
}

const TRACKS = {
    overworld: {
        bpm: 150,
        voices: [
            { wave: 'pulse25', vol: 0.11, notes: seq(`
                C5:2 E5:2 G5:2 E5:2 A5:3 G5:1 E5:2 C5:2
                D5:2 F5:2 A5:2 F5:2 G5:4 -:2 G4:2
                C5:2 E5:2 G5:2 C6:2 B5:2 A5:2 G5:2 E5:2
                F5:2 E5:2 D5:2 E5:2 C5:4 -:4
                A5:2 -:1 A5:1 G5:2 E5:2 F5:2 -:1 F5:1 E5:2 C5:2
                D5:2 E5:2 F5:2 A5:2 G5:6 -:2
                A5:2 -:1 A5:1 B5:2 C6:2 D6:2 C6:2 B5:2 G5:2
                A5:2 G5:2 E5:2 D5:2 C5:4 -:4`) },
            { wave: 'triangle', vol: 0.26, notes: seq(`
                C3:2 C4:2 G2:2 G3:2 C3:2 C4:2 G2:2 G3:2
                D3:2 D4:2 A2:2 A3:2 G2:2 G3:2 B2:2 B3:2
                C3:2 C4:2 G2:2 G3:2 E3:2 E4:2 G2:2 G3:2
                F2:2 F3:2 G2:2 G3:2 C3:2 C4:2 C3:2 -:2
                F2:2 F3:2 F2:2 F3:2 C3:2 C4:2 C3:2 C4:2
                D3:2 D4:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2
                F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2
                F2:2 F3:2 G2:2 G3:2 C3:2 C4:2 G2:2 G3:2`) },
            { wave: 'noise', vol: 0.05, notes: seq(('-:2 x:2 '.repeat(4) + ' ').repeat(8)) },
        ],
    },
    underground: {
        bpm: 112,
        voices: [
            { wave: 'pulse12', vol: 0.12, notes: seq(`
                E4:2 E5:2 G4:2 E5:2 D4:2 D5:2 B3:2 -:2
                C4:2 C5:2 E4:2 C5:2 B3:2 B4:2 G3:2 -:2
                E4:2 E5:2 G4:2 E5:2 A4:2 A5:2 G4:2 -:2
                F4:2 E4:2 D4:2 B3:2 C4:4 -:4`) },
            { wave: 'triangle', vol: 0.22, notes: seq(`
                E2:4 -:4 D2:4 -:4
                C2:4 -:4 B1:4 -:4
                E2:4 -:4 A1:4 -:4
                D2:4 G1:4 C2:4 -:4`) },
        ],
    },
    star: {
        bpm: 180,
        voices: [
            { wave: 'pulse25', vol: 0.1, notes: seq(`
                C5:1 E5:1 G5:1 C6:1 G5:1 E5:1 C5:1 E5:1 D5:1 F5:1 A5:1 D6:1 A5:1 F5:1 D5:1 F5:1
                E5:1 G5:1 B5:1 E6:1 B5:1 G5:1 E5:1 G5:1 F5:1 A5:1 C6:1 F6:1 C6:1 A5:1 G5:1 B5:1`) },
            { wave: 'triangle', vol: 0.24, notes: seq(`
                C3:2 C4:2 C3:2 C4:2 D3:2 D4:2 D3:2 D4:2
                E3:2 E4:2 E3:2 E4:2 F3:2 F4:2 G3:2 G4:2`) },
            { wave: 'noise', vol: 0.05, notes: seq('x:1 -:1 '.repeat(16)) },
        ],
    },
};

function pulseWave(ctx, duty) {
    const n = 64;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
        real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
        imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
    }
    return ctx.createPeriodicWave(real, imag);
}

export class Sound {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.track = null;
        this.tempo = 1;
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = this.ctx = new AC();
            this.master = ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.6;
            this.master.connect(ctx.destination);
            this.sfxBus = ctx.createGain();
            this.sfxBus.gain.value = 0.9;
            this.sfxBus.connect(this.master);
            this.musicBus = ctx.createGain();
            this.musicBus.gain.value = 0.55;
            this.musicBus.connect(this.master);
            this.waves = { pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5), pulse12: pulseWave(ctx, 0.125) };
            const len = ctx.sampleRate;
            this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
        return this.muted;
    }

    osc(freq, t, dur, { wave = 'pulse50', vol = 0.15, to = null, bus = this.sfxBus, attack = 0.004 } = {}) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        if (this.waves[wave]) o.setPeriodicWave(this.waves[wave]);
        else o.type = wave;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    noise(t, dur, { vol = 0.2, freq = 2000, q = 0.8, bus = this.sfxBus } = {}) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(bus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    arp(t, notes, step, opts) {
        notes.forEach((n, i) => this.osc(typeof n === 'number' ? n : noteFreq(n), t + i * step, step * 1.1, opts));
    }

    play(name) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + 0.01;
        const fn = SFX[name];
        if (fn) fn(this, t);
    }

    music(name) {
        if (!this.ctx) return;
        this.stopMusic();
        const def = TRACKS[name];
        if (!def) return;
        const gain = this.ctx.createGain();
        gain.gain.value = 1;
        gain.connect(this.musicBus);
        const start = this.ctx.currentTime + 0.08;
        this.track = { name, def, gain, voices: def.voices.map(v => ({ ...v, i: 0, time: start })) };
        this.tempo = 1;
    }

    stopMusic() {
        if (!this.track || !this.ctx) return;
        const g = this.track.gain;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => g.disconnect(), 400);
        this.track = null;
    }

    pauseMusic(paused) {
        if (this.musicBus) this.musicBus.gain.setTargetAtTime(paused ? 0 : 0.55, this.ctx.currentTime, 0.03);
    }

    update() {
        const tr = this.track;
        if (!tr || !this.ctx) return;
        const now = this.ctx.currentTime;
        const horizon = now + 0.25;
        const sixteenth = 60 / tr.def.bpm / 4 / this.tempo;
        for (const v of tr.voices) {
            if (v.time < now - 0.1) v.time = now + 0.02; // tab was hidden: skip ahead
            while (v.time < horizon) {
                const [f, len] = v.notes[v.i];
                const dur = len * sixteenth;
                if (f === 'x') this.noise(v.time, 0.05, { vol: v.vol * 2, freq: 7000, q: 0.5, bus: tr.gain });
                else if (f > 0) this.osc(f, v.time, dur * 0.92, { wave: v.wave, vol: v.vol, bus: tr.gain, attack: 0.006 });
                v.time += dur;
                v.i = (v.i + 1) % v.notes.length;
            }
        }
    }
}

const SFX = {
    jump: (s, t) => s.osc(300, t, 0.2, { to: 820, vol: 0.12 }),
    jumpBig: (s, t) => s.osc(230, t, 0.24, { to: 640, vol: 0.13 }),
    coin: (s, t) => {
        s.osc(988, t, 0.08, { wave: 'pulse25', vol: 0.12 });
        s.osc(1319, t + 0.08, 0.45, { wave: 'pulse25', vol: 0.12 });
    },
    stomp: (s, t) => {
        s.osc(520, t, 0.12, { to: 120, vol: 0.18 });
        s.noise(t, 0.08, { vol: 0.15, freq: 900 });
    },
    kick: (s, t) => { s.osc(900, t, 0.04, { vol: 0.14 }); s.osc(1500, t + 0.04, 0.05, { vol: 0.12 }); },
    bump: (s, t) => { s.osc(160, t, 0.1, { wave: 'triangle', to: 70, vol: 0.45 }); s.noise(t, 0.05, { vol: 0.1, freq: 400 }); },
    break: (s, t) => {
        s.noise(t, 0.3, { vol: 0.35, freq: 1400, q: 0.6 });
        s.osc(140, t, 0.2, { wave: 'triangle', to: 50, vol: 0.4 });
    },
    sprout: (s, t) => s.arp(t, ['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5', 'A5', 'B5'], 0.045, { wave: 'pulse25', vol: 0.1 }),
    powerup: (s, t) => s.arp(t, ['C5', 'G4', 'C5', 'E5', 'G5', 'C6', 'G5', 'D5', 'G5', 'B5', 'D6', 'B5', 'E5', 'G#5', 'B5', 'E6'], 0.04, { wave: 'pulse25', vol: 0.1 }),
    oneup: (s, t) => s.arp(t, ['C6', 'E6', 'G6', 'C7', 'G6', 'C7'], 0.09, { wave: 'pulse25', vol: 0.11 }),
    fireball: (s, t) => s.osc(1400, t, 0.08, { to: 350, vol: 0.12 }),
    hurt: (s, t) => { for (let i = 0; i < 3; i++) s.osc(600 - i * 120, t + i * 0.1, 0.09, { to: 200 - i * 40, vol: 0.14 }); },
    pipe: (s, t) => { for (let i = 0; i < 3; i++) s.osc(420, t + i * 0.13, 0.1, { to: 120, vol: 0.14 }); },
    death: (s, t) => {
        s.osc(700, t, 0.5, { to: 90, vol: 0.14 });
        s.arp(t + 0.6, ['G4', 'E4', 'C4', 'D4', 'B3', 'G3'], 0.16, { wave: 'pulse25', vol: 0.12 });
        s.osc(noteFreq('C3'), t + 1.6, 0.6, { wave: 'triangle', vol: 0.3 });
    },
    flag: (s, t) => s.osc(1600, t, 1.1, { to: 260, vol: 0.1, wave: 'pulse25' }),
    clear: (s, t) => {
        s.arp(t, ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0.09, { wave: 'pulse25', vol: 0.11 });
        s.arp(t + 0.6, ['A5', 'B5', 'C6'], 0.18, { wave: 'pulse25', vol: 0.11 });
        s.osc(noteFreq('E6'), t + 1.2, 0.9, { wave: 'pulse25', vol: 0.11 });
        s.arp(t, ['C3', 'G3', 'C4', 'G3', 'F3', 'G3', 'C3'], 0.3, { wave: 'triangle', vol: 0.3 });
    },
    tick: (s, t) => s.osc(1760, t, 0.025, { wave: 'pulse25', vol: 0.06 }),
    firework: (s, t) => { s.noise(t, 0.6, { vol: 0.4, freq: 300, q: 0.5 }); s.osc(90, t, 0.3, { wave: 'triangle', to: 40, vol: 0.4 }); },
    gameover: (s, t) => {
        s.arp(t, ['G4', 'E4', 'C4', 'A3'], 0.3, { wave: 'pulse25', vol: 0.12 });
        s.osc(noteFreq('F3'), t + 1.2, 1.0, { wave: 'triangle', vol: 0.3 });
    },
    hurry: (s, t) => s.arp(t, ['E6', 'C6', 'E6', 'C6', 'E6', 'C6'], 0.08, { wave: 'pulse25', vol: 0.1 }),
    pause: (s, t) => s.arp(t, ['E6', 'C6', 'E6', 'C6'], 0.07, { wave: 'pulse25', vol: 0.1 }),
    step: (s, t) => s.noise(t, 0.04, { vol: 0.05, freq: 500 }),
};
