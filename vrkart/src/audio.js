// Engine, sound effects and an original chiptune race theme, synthesized with Web Audio.

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

const RACE = {
    bpm: 164,
    voices: [
        { wave: 'pulse25', vol: 0.09, notes: seq(`
            G5:2 B5:2 D6:2 B5:2 C6:2 A5:2 F#5:2 A5:2
            G5:3 A5:1 B5:2 G5:2 E5:4 -:4
            E5:2 G5:2 C6:2 G5:2 A5:2 F#5:2 D5:2 F#5:2
            G5:2 F#5:2 E5:2 D5:2 B4:4 -:4
            C6:2 -:1 C6:1 B5:2 A5:2 B5:2 -:1 B5:1 A5:2 G5:2
            A5:2 G5:2 F#5:2 E5:2 F#5:4 D5:4
            E5:2 F#5:2 G5:2 A5:2 B5:2 C6:2 D6:2 B5:2
            C6:2 A5:2 F#5:2 D5:2 G5:4 -:4`) },
        { wave: 'triangle', vol: 0.24, notes: seq(`
            G2:2 G3:2 G2:2 G3:2 D3:2 D4:2 D3:2 D4:2
            E2:2 E3:2 E2:2 E3:2 C3:2 C4:2 C3:2 C4:2
            C3:2 C4:2 C3:2 C4:2 D3:2 D4:2 D3:2 D4:2
            G2:2 G3:2 B2:2 B3:2 E2:2 E3:2 D3:2 D4:2
            A2:2 A3:2 A2:2 A3:2 G2:2 G3:2 G2:2 G3:2
            D3:2 D4:2 D3:2 D4:2 D3:2 D4:2 C3:2 C4:2
            C3:2 C4:2 C3:2 C4:2 D3:2 D4:2 D3:2 D4:2
            D3:2 D4:2 D3:2 D4:2 G2:2 G3:2 G2:2 G3:2`) },
        { wave: 'noise', vol: 0.05, notes: seq('k:2 x:2 k:2 x:2 k:2 x:2 k:2 x:2 '.repeat(8)) },
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
            this.musicBus.gain.value = 0.5;
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

    // ---- engine: two detuned oscillators through a low-pass filter
    startEngine() {
        if (!this.ctx || this.engine) return;
        const ctx = this.ctx;
        const a = ctx.createOscillator(), b = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        a.type = 'sawtooth';
        b.setPeriodicWave(this.waves.pulse25);
        f.type = 'lowpass';
        f.frequency.value = 600;
        g.gain.value = 0;
        a.connect(f);
        b.connect(f);
        f.connect(g).connect(this.sfxBus);
        a.start();
        b.start();
        this.engine = { a, b, f, g };
    }

    setEngine(speed, throttle, boost) {
        const e = this.engine;
        if (!e) return;
        const t = this.ctx.currentTime;
        const freq = 42 + speed * 5 + throttle * 12 + (boost ? 25 : 0);
        e.a.frequency.setTargetAtTime(freq, t, 0.06);
        e.b.frequency.setTargetAtTime(freq * 1.51, t, 0.06);
        e.f.frequency.setTargetAtTime(400 + speed * 45 + throttle * 300, t, 0.08);
        e.g.gain.setTargetAtTime(0.035 + throttle * 0.045 + (boost ? 0.03 : 0), t, 0.1);
    }

    stopEngine() {
        const e = this.engine;
        if (!e) return;
        e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        setTimeout(() => { e.a.stop(); e.b.stop(); }, 600);
        this.engine = null;
    }

    // ---- music
    music(on) {
        if (!this.ctx) return;
        this.stopMusic();
        if (!on) return;
        const gain = this.ctx.createGain();
        gain.connect(this.musicBus);
        const start = this.ctx.currentTime + 0.05;
        this.track = { gain, voices: RACE.voices.map(v => ({ ...v, i: 0, time: start })) };
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
        const sixteenth = 60 / RACE.bpm / 4 / this.tempo;
        for (const v of tr.voices) {
            if (v.time < now - 0.1) v.time = now + 0.02;
            while (v.time < horizon) {
                const [f, len] = v.notes[v.i];
                const dur = len * sixteenth;
                if (f === 'x') this.noise(v.time, 0.04, { vol: v.vol * 2, freq: 8000, q: 0.5, bus: tr.gain });
                else if (f === 'k') this.osc(140, v.time, 0.12, { wave: 'sine', to: 45, vol: 0.35, bus: tr.gain });
                else if (f > 0) this.osc(f, v.time, dur * 0.9, { wave: v.wave, vol: v.vol, bus: tr.gain });
                v.time += dur;
                v.i = (v.i + 1) % v.notes.length;
            }
        }
    }
}

const SFX = {
    beep: (s, t) => s.osc(440, t, 0.35, { wave: 'pulse25', vol: 0.14 }),
    go: (s, t) => s.osc(880, t, 0.8, { wave: 'pulse25', vol: 0.14 }),
    boost: (s, t) => {
        s.noise(t, 0.6, { vol: 0.25, freq: 1200, q: 0.6 });
        s.osc(300, t, 0.5, { wave: 'sawtooth', to: 1200, vol: 0.08 });
    },
    lap: (s, t) => s.arp(t, ['E6', 'G6', 'C7'], 0.09, { wave: 'pulse25', vol: 0.1 }),
    finalLap: (s, t) => s.arp(t, ['C6', 'E6', 'G6', 'C7', 'G6', 'C7', 'E7'], 0.08, { wave: 'pulse25', vol: 0.11 }),
    finish: (s, t) => {
        s.arp(t, ['G5', 'C6', 'E6', 'G6', 'E6', 'G6'], 0.12, { wave: 'pulse25', vol: 0.12 });
        s.osc(noteFreq('C7'), t + 0.75, 1.0, { wave: 'pulse25', vol: 0.12 });
        s.arp(t, ['C3', 'G3', 'C4', 'E4'], 0.25, { wave: 'triangle', vol: 0.3 });
    },
    splash: (s, t) => {
        s.noise(t, 1.0, { vol: 0.45, freq: 700, q: 0.4, type: 'lowpass' });
        s.osc(500, t, 0.5, { wave: 'sine', to: 120, vol: 0.12 });
    },
    bump: (s, t) => { s.osc(120, t, 0.12, { wave: 'triangle', to: 60, vol: 0.4 }); s.noise(t, 0.08, { vol: 0.15, freq: 500 }); },
    land: (s, t) => s.osc(90, t, 0.15, { wave: 'triangle', to: 45, vol: 0.45 }),
    scrape: (s, t) => s.noise(t, 0.12, { vol: 0.12, freq: 3000, q: 2 }),
    lakitu: (s, t) => s.arp(t, ['A5', 'F5', 'D5'], 0.1, { wave: 'pulse25', vol: 0.1 }),
    wrong: (s, t) => { s.osc(220, t, 0.2, { vol: 0.1 }); s.osc(196, t + 0.22, 0.3, { vol: 0.1 }); },
};
