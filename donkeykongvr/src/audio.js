const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(n) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
    if (!m) return 0;
    const s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    const midi = (parseInt(m[3], 10) + 1) * 12 + s;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

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
    theme: {
        bpm: 140,
        voices: [
            { wave: 'pulse25', vol: 0.12, notes: seq(`
                C4:2 E4:2 G4:2 C5:2 F4:2 A4:2 C5:2 F5:2
                G4:2 B4:2 D5:2 G5:2 C5:4 G4:4
                C4:2 E4:2 G4:2 C5:2 F4:2 A4:2 C5:2 F5:2
                G4:4 B4:4 C5:6 -:2`) },
            { wave: 'triangle', vol: 0.25, notes: seq(`
                C3:4 F2:4 G2:4 C3:4
                C3:4 F2:4 G2:4 C3:4`) },
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
            this.waves = { pulse25: pulseWave(ctx, 0.25), pulse50: pulseWave(ctx, 0.5) };
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

    osc(freq, t, dur, { wave = 'pulse50', vol = 0.15, to = null, bus = this.sfxBus } = {}) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        if (this.waves[wave]) o.setPeriodicWave(this.waves[wave]);
        else o.type = wave;
        o.frequency.setValueAtTime(freq, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.004);
        g.gain.setValueAtTime(vol, t + dur * 0.6);
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

    play(name) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime + 0.01;
        if (name === 'jump') this.osc(300, t, 0.2, { to: 820, vol: 0.12 });
        else if (name === 'cannon') { this.noise(t, 0.4, { vol: 0.5, freq: 500 }); this.osc(150, t, 0.3, { to: 600, vol: 0.3 }); }
        else if (name === 'stomp') this.noise(t, 0.1, { vol: 0.3, freq: 800 });
        else if (name === 'hurt') this.osc(600, t, 0.3, { to: 150, vol: 0.2 });
        else if (name === 'climb') this.noise(t, 0.04, { vol: 0.08, freq: 1200 });
        else if (name === 'item') this.osc(988, t, 0.1, { wave: 'pulse25', to: 1319, vol: 0.15 });
        else if (name === 'win') {
            for (let i = 0; i < 4; i++) this.osc(500 + i * 200, t + i * 0.12, 0.1, { wave: 'pulse25', vol: 0.15 });
        }
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
    }

    stopMusic() {
        if (!this.track || !this.ctx) return;
        const g = this.track.gain;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
        setTimeout(() => g.disconnect(), 400);
        this.track = null;
    }

    update() {
        const tr = this.track;
        if (!tr || !this.ctx) return;
        const now = this.ctx.currentTime;
        const horizon = now + 0.25;
        const sixteenth = 60 / tr.def.bpm / 4;
        for (const v of tr.voices) {
            if (v.time < now - 0.1) v.time = now + 0.02;
            while (v.time < horizon) {
                const [f, len] = v.notes[v.i];
                const dur = len * sixteenth;
                if (f > 0) this.osc(f, v.time, dur * 0.92, { wave: v.wave, vol: v.vol, bus: tr.gain });
                v.time += dur;
                v.i = (v.i + 1) % v.notes.length;
            }
        }
    }
}
