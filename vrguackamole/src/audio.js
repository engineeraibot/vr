// Whacks, bombs, jingles and an original bouncy chiptune, synthesized with Web Audio.

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(n) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
    if (!m) return 0;
    const s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, ((parseInt(m[3], 10) + 1) * 12 + s - 69) / 12);
}

function seq(str) {
    return str.trim().split(/\s+/).map(tok => {
        const [n, d] = tok.split(':');
        const len = parseFloat(d);
        if (n === '-') return [0, len];
        if (n === 'x' || n === 'k') return [n, len];
        return [noteFreq(n), len];
    });
}

// Lengths in sixteenths; every line is one bar.
const TUNE = {
    bpm: 138,
    voices: [
        { wave: 'pulse25', vol: 0.08, notes: seq(`
            C5:2 E5:2 G5:2 E5:2 F5:2 A5:2 G5:4
            E5:2 G5:2 C6:2 G5:2 A5:2 G5:2 E5:4
            D5:2 F5:2 A5:2 F5:2 G5:2 F5:2 E5:2 D5:2
            C5:2 E5:2 D5:2 B4:2 C5:4 -:4
            E5:1 E5:1 -:2 G5:2 E5:2 A5:3 G5:1 E5:4
            F5:1 F5:1 -:2 A5:2 F5:2 B5:3 A5:1 G5:4
            C6:2 B5:2 A5:2 G5:2 F5:2 E5:2 D5:2 E5:2
            C5:2 G4:2 C5:2 E5:2 C5:4 -:4`) },
        { wave: 'triangle', vol: 0.22, notes: seq(`
            C3:4 G2:4 F2:4 G2:4
            C3:4 G2:4 A2:4 E2:4
            D3:4 A2:4 G2:4 G2:4
            F2:4 G2:4 C3:4 C3:4
            C3:4 C3:4 A2:4 A2:4
            F2:4 F2:4 G2:4 G2:4
            A2:4 F2:4 D3:4 G2:4
            C3:4 G2:4 C3:4 C3:4`) },
        { wave: 'noise', vol: 0.04, notes: seq('k:4 x:2 x:2 k:4 x:4 '.repeat(8)) },
    ],
};

function pulseWave(ctx, duty) {
    const n = 64, real = new Float32Array(n), imag = new Float32Array(n);
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
            this.sfxBus.connect(this.master);
            this.musicBus = ctx.createGain();
            this.musicBus.gain.value = 0.45;
            this.musicBus.connect(this.master);
            this.waves = { pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) };
            this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    }

    osc(freq, t, dur, { wave = 'pulse50', vol = 0.15, to = null, bus = this.sfxBus, attack = 0.005 } = {}) {
        const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
        if (this.waves[wave]) o.setPeriodicWave(this.waves[wave]); else o.type = wave;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + dur + 0.02);
    }

    noise(t, dur, { vol = 0.2, freq = 2000, q = 0.8, type = 'bandpass', bus = this.sfxBus } = {}) {
        const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = this.noiseBuf;
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(bus);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.02);
    }

    arp(t, notes, step, opts) {
        notes.forEach((n, i) => this.osc(noteFreq(n), t + i * step, step * 1.1, opts));
    }

    play(name) {
        if (!this.ctx) return;
        const fn = SFX[name];
        if (fn) fn(this, this.ctx.currentTime + 0.01);
    }

    // ---- music
    music(on) {
        if (!this.ctx) return;
        this.stopMusic();
        if (!on) return;
        const gain = this.ctx.createGain();
        gain.connect(this.musicBus);
        const start = this.ctx.currentTime + 0.05;
        this.track = { gain, voices: TUNE.voices.map(v => ({ ...v, i: 0, time: start })) };
        this.tempo = 1;
    }

    stopMusic() {
        if (!this.track || !this.ctx) return;
        const g = this.track.gain;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        setTimeout(() => g.disconnect(), 500);
        this.track = null;
    }

    update() {
        const tr = this.track;
        if (!tr) return;
        const now = this.ctx.currentTime, horizon = now + 0.25;
        const sixteenth = 60 / TUNE.bpm / 4 / this.tempo;
        for (const v of tr.voices) {
            if (v.time < now - 0.1) v.time = now + 0.02;
            while (v.time < horizon) {
                const [f, len] = v.notes[v.i];
                const dur = len * sixteenth;
                if (f === 'x') this.noise(v.time, 0.04, { vol: v.vol * 2, freq: 8000, q: 0.5, bus: tr.gain });
                else if (f === 'k') this.osc(140, v.time, 0.12, { wave: 'sine', to: 45, vol: 0.3, bus: tr.gain });
                else if (f > 0) this.osc(f, v.time, dur * 0.85, { wave: v.wave, vol: v.vol, bus: tr.gain });
                v.time += dur;
                v.i = (v.i + 1) % v.notes.length;
            }
        }
    }
}

const SFX = {
    pop: (s, t) => s.osc(380, t, 0.09, { wave: 'sine', to: 900, vol: 0.07 }),
    whack: (s, t) => {
        s.osc(190, t, 0.14, { wave: 'triangle', to: 55, vol: 0.5 });
        s.noise(t, 0.09, { vol: 0.3, freq: 1400, q: 0.7 });
        s.osc(1500, t + 0.04, 0.16, { wave: 'pulse25', to: 650, vol: 0.05 });   // squeak
    },
    bomb: (s, t) => {
        s.noise(t, 1.1, { vol: 0.7, freq: 500, q: 0.5, type: 'lowpass' });
        s.noise(t, 0.3, { vol: 0.25, freq: 2600, q: 0.6 });
        s.osc(130, t, 0.7, { wave: 'sine', to: 28, vol: 0.55 });
    },
    level: (s, t) => s.arp(t, ['C6', 'E6', 'G6', 'C7'], 0.07, { wave: 'pulse25', vol: 0.1 }),
    life: (s, t) => {
        s.arp(t, ['G5', 'C6', 'E6', 'G6', 'C7'], 0.06, { wave: 'triangle', vol: 0.3 });
        s.arp(t + 0.32, ['E7', 'G7'], 0.08, { wave: 'pulse25', vol: 0.07 });
    },
    start: (s, t) => {
        s.arp(t, ['C5', 'E5', 'G5', 'C6'], 0.08, { wave: 'pulse25', vol: 0.1 });
        s.osc(noteFreq('C6'), t + 0.32, 0.35, { wave: 'pulse25', vol: 0.1 });
    },
    over: (s, t) => {
        s.arp(t, ['G5', 'E5', 'C5', 'G4'], 0.16, { wave: 'pulse25', vol: 0.11 });
        s.osc(noteFreq('C4'), t + 0.66, 0.9, { wave: 'triangle', vol: 0.3 });
        s.osc(noteFreq('C3'), t + 0.66, 0.9, { wave: 'triangle', vol: 0.3 });
    },
    miss: (s, t) => s.osc(300, t, 0.12, { wave: 'sine', to: 180, vol: 0.05 }),
};
