// Wind, rumble, lift-hill clacks, screaming riders, effects and an original chiptune theme,
// all synthesized with Web Audio.

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

const THEME = {
    bpm: 150,
    voices: [
        { wave: 'pulse25', vol: 0.07, notes: seq(`
            E5:2 E5:1 G5:1 A5:2 E5:2 D5:2 E5:2 G5:4
            E5:2 E5:1 G5:1 A5:2 C6:2 B5:2 A5:2 G5:4
            C6:2 B5:2 A5:2 G5:2 A5:2 G5:2 E5:2 D5:2
            E5:2 G5:2 E5:2 D5:2 C5:4 -:4
            A4:2 C5:2 E5:2 A5:2 G5:2 E5:2 C5:2 E5:2
            F5:2 A5:2 C6:2 A5:2 G5:4 E5:4
            A5:2 A5:1 B5:1 C6:2 A5:2 B5:2 G5:2 E5:2 G5:2
            A5:3 G5:1 E5:2 D5:2 E5:4 -:4`) },
        { wave: 'triangle', vol: 0.22, notes: seq(`
            A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 G2:2 G3:2
            F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2
            F2:2 F3:2 F2:2 F3:2 C3:2 C4:2 C3:2 C4:2
            G2:2 G3:2 G2:2 G3:2 C3:2 C4:2 E3:2 E4:2
            A2:2 A3:2 A2:2 A3:2 C3:2 C4:2 C3:2 C4:2
            F2:2 F3:2 F2:2 F3:2 C3:2 C4:2 C3:2 C4:2
            F2:2 F3:2 F2:2 F3:2 G2:2 G3:2 G2:2 G3:2
            A2:2 A3:2 G2:2 G3:2 A2:2 A3:2 A2:2 A3:2`) },
        { wave: 'noise', vol: 0.045, notes: seq('k:2 x:2 k:1 k:1 x:2 k:2 x:2 k:2 x:1 x:1 '.repeat(8)) },
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
        this.clackDist = 0;
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = this.ctx = new AC();
            this.master = ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.7;
            this.master.connect(ctx.destination);
            this.sfxBus = ctx.createGain();
            this.sfxBus.connect(this.master);
            this.musicBus = ctx.createGain();
            this.musicBus.gain.value = 0.45;
            this.musicBus.connect(this.master);
            this.waves = { pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) };
            this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            this.startRide();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
        return this.muted;
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

    noise(t, dur, { vol = 0.2, freq = 2000, q = 0.8, type = 'bandpass', bus = this.sfxBus, to = null } = {}) {
        const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = this.noiseBuf;
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
        f.Q.value = q;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(bus);
        src.start(t, Math.random());
        src.stop(t + dur + 0.02);
    }

    arp(t, notes, step, opts) {
        notes.forEach((n, i) => this.osc(noteFreq(n), t + i * step, step * 1.1, opts));
    }

    play(name, arg) {
        if (!this.ctx) return;
        const fn = SFX[name];
        if (fn) fn(this, this.ctx.currentTime + 0.01, arg);
    }

    // ---- continuous ride noise: wind (rises with speed) and wheel rumble
    startRide() {
        const ctx = this.ctx;
        const loop = () => {
            const src = ctx.createBufferSource();
            src.buffer = this.noiseBuf;
            src.loop = true;
            src.start();
            return src;
        };
        const wf = ctx.createBiquadFilter(), wg = ctx.createGain();
        wf.type = 'bandpass';
        wf.Q.value = 0.7;
        wf.frequency.value = 400;
        wg.gain.value = 0;
        loop().connect(wf).connect(wg).connect(this.sfxBus);
        const rf = ctx.createBiquadFilter(), rg = ctx.createGain();
        rf.type = 'lowpass';
        rf.frequency.value = 140;
        rg.gain.value = 0;
        loop().connect(rf).connect(rg).connect(this.sfxBus);
        this.ride = { wf, wg, rf, rg };
    }

    // speed m/s; chain = on the lift hill; tunnel = echoey rumble; gap = in the air (no wheels)
    setRide(speed, dt, { chain = false, tunnel = false, gap = false } = {}) {
        const r = this.ride;
        if (!r) return;
        const t = this.ctx.currentTime, k = Math.min(1, speed / 45);
        r.wf.frequency.setTargetAtTime(300 + k * 1500, t, 0.1);
        r.wg.gain.setTargetAtTime(k * k * 0.5, t, 0.1);
        r.rf.frequency.setTargetAtTime(tunnel ? 260 : 110 + k * 120, t, 0.1);
        r.rg.gain.setTargetAtTime(gap ? 0 : Math.min(1, speed / 8) * (0.35 + k * 0.6), t, 0.08);
        if (chain) {
            this.clackDist += speed * dt;
            if (this.clackDist > 0.55) {
                this.clackDist = 0;
                this.noise(t, 0.04, { vol: 0.28, freq: 2400, q: 3 });
                this.osc(170, t, 0.05, { wave: 'triangle', vol: 0.22, to: 90 });
            }
        }
    }

    // ---- screaming riders: sawtooth voices through vowel formants ("AAAAH" / "WHEEE")
    scream(voices = 6, dur = 2.2, whee = false) {
        if (!this.ctx) return;
        const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
        for (let i = 0; i < voices; i++) {
            const t = t0 + Math.random() * 0.35, d = dur * (0.7 + Math.random() * 0.5);
            const f0 = (i === 0 ? 330 : 240 + Math.random() * 380);
            const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = ctx.createGain(), g = ctx.createGain();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(f0 * (whee ? 0.7 : 1.05), t);
            o.frequency.linearRampToValueAtTime(f0 * (whee ? 1.5 : 1.2), t + d * 0.25);
            o.frequency.linearRampToValueAtTime(f0 * (whee ? 1.2 : 0.8), t + d);
            vib.frequency.value = 5 + Math.random() * 3;
            vg.gain.value = f0 * 0.03;
            vib.connect(vg).connect(o.frequency);
            const mix = ctx.createGain();
            mix.gain.value = 1;
            const formants = whee ? [[300, 10, 1], [2300, 14, 0.7], [3000, 14, 0.4]] : [[820, 7, 1], [1200, 9, 0.8], [2600, 10, 0.3]];
            for (const [f, q, a] of formants) {
                const bp = ctx.createBiquadFilter(), ga = ctx.createGain();
                bp.type = 'bandpass';
                bp.frequency.value = f * (0.9 + Math.random() * 0.2);
                bp.Q.value = q;
                ga.gain.value = a;
                o.connect(bp).connect(ga).connect(mix);
            }
            const vol = (i === 0 ? 0.5 : 0.28) / Math.sqrt(voices);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(vol, t + 0.12);
            g.gain.setValueAtTime(vol, t + d * 0.7);
            g.gain.exponentialRampToValueAtTime(0.0001, t + d);
            mix.connect(g).connect(this.sfxBus);
            o.start(t);
            vib.start(t);
            o.stop(t + d + 0.05);
            vib.stop(t + d + 0.05);
        }
    }

    // ---- music
    music(on) {
        if (!this.ctx) return;
        this.stopMusic();
        if (!on) return;
        const gain = this.ctx.createGain();
        gain.connect(this.musicBus);
        const start = this.ctx.currentTime + 0.05;
        this.track = { gain, voices: THEME.voices.map(v => ({ ...v, i: 0, time: start })) };
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
        const sixteenth = 60 / THEME.bpm / 4;
        for (const v of tr.voices) {
            if (v.time < now - 0.1) v.time = now + 0.02;
            while (v.time < horizon) {
                const [f, len] = v.notes[v.i];
                const dur = len * sixteenth;
                if (f === 'x') this.noise(v.time, 0.04, { vol: v.vol * 2, freq: 8000, q: 0.5, bus: tr.gain });
                else if (f === 'k') this.osc(140, v.time, 0.12, { wave: 'sine', to: 45, vol: 0.32, bus: tr.gain });
                else if (f > 0) this.osc(f, v.time, dur * 0.9, { wave: v.wave, vol: v.vol, bus: tr.gain });
                v.time += dur;
                v.i = (v.i + 1) % v.notes.length;
            }
        }
    }
}

const SFX = {
    beep: (s, t) => s.osc(520, t, 0.3, { wave: 'pulse25', vol: 0.16 }),
    go: (s, t) => {
        s.osc(1040, t, 0.7, { wave: 'pulse25', vol: 0.16 });
        s.osc(60, t, 1.4, { wave: 'sawtooth', to: 30, vol: 0.3 });
        s.noise(t, 2.2, { vol: 0.5, freq: 300, to: 3000, q: 0.7 });
    },
    bell: (s, t) => { for (let i = 0; i < 3; i++) s.osc(1320, t + i * 0.28, 0.25, { wave: 'triangle', vol: 0.15 }); },
    pop: (s, t, n = 0) => {
        s.noise(t, 0.12, { vol: 0.5, freq: 1800, q: 0.6 });
        const base = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7'][n % 6];
        s.osc(noteFreq(base), t + 0.03, 0.12, { wave: 'pulse25', vol: 0.1 });
        s.osc(noteFreq(base) * 1.5, t + 0.1, 0.16, { wave: 'pulse25', vol: 0.1 });
    },
    star: (s, t) => s.arp(t, ['C6', 'E6', 'G6', 'C7', 'E7', 'G7'], 0.06, { wave: 'pulse25', vol: 0.12 }),
    splash: (s, t) => {
        s.noise(t, 1.6, { vol: 0.9, freq: 2500, to: 300, q: 0.4, type: 'lowpass' });
        s.noise(t + 0.05, 0.9, { vol: 0.4, freq: 5000, q: 0.5 });
        s.osc(420, t, 0.6, { wave: 'sine', to: 90, vol: 0.2 });
    },
    whoosh: (s, t) => s.noise(t, 0.5, { vol: 0.5, freq: 400, to: 2500, q: 2 }),
    land: (s, t) => {
        s.osc(90, t, 0.35, { wave: 'triangle', to: 35, vol: 0.6 });
        s.noise(t, 0.4, { vol: 0.5, freq: 900, q: 0.5, type: 'lowpass' });
        s.noise(t, 0.25, { vol: 0.25, freq: 5000, q: 1 });
    },
    roar: (s, t) => {
        const ctx = s.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        o.type = 'sawtooth';
        o2.type = 'sawtooth';
        o.frequency.setValueAtTime(70, t);
        o.frequency.linearRampToValueAtTime(110, t + 0.5);
        o.frequency.linearRampToValueAtTime(55, t + 2.2);
        o2.frequency.setValueAtTime(73, t);
        o2.frequency.linearRampToValueAtTime(52, t + 2.2);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(500, t);
        f.frequency.linearRampToValueAtTime(1400, t + 0.4);
        f.frequency.linearRampToValueAtTime(300, t + 2.2);
        f.Q.value = 6;
        lfo.frequency.value = 23;
        lg.gain.value = 0.25;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
        lfo.connect(lg).connect(g.gain);
        o.connect(f);
        o2.connect(f);
        f.connect(g).connect(s.sfxBus);
        for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + 2.4); }
        s.noise(t, 2.0, { vol: 0.25, freq: 600, q: 1.5 });
    },
    firework: (s, t) => {
        s.osc(700, t, 0.5, { wave: 'sine', to: 2400, vol: 0.05 });
        s.osc(80, t + 0.55, 0.6, { wave: 'triangle', to: 30, vol: 0.5 });
        s.noise(t + 0.55, 0.8, { vol: 0.4, freq: 800, q: 0.4, type: 'lowpass' });
        for (let i = 0; i < 8; i++) s.noise(t + 0.8 + Math.random() * 0.8, 0.03, { vol: 0.25, freq: 6000, q: 1 });
    },
    fanfare: (s, t) => {
        s.arp(t, ['G5', 'C6', 'E6', 'G6', 'E6', 'G6'], 0.12, { wave: 'pulse25', vol: 0.12 });
        s.osc(noteFreq('C7'), t + 0.75, 1.1, { wave: 'pulse25', vol: 0.12 });
        s.arp(t, ['C3', 'G3', 'C4', 'E4'], 0.25, { wave: 'triangle', vol: 0.3 });
    },
    ufo: (s, t) => {
        for (let i = 0; i < 6; i++) s.osc(600 + i * 90, t + i * 0.12, 0.3, { wave: 'sine', to: 1400 - i * 60, vol: 0.06 });
    },
};
