// Phone side of the link: finds the PC by its code, receives the screen video and
// sends clicks / scrolls back over a data channel. Reconnects by itself.
import { ICE_SERVERS, cleanCode, randomId, send, waitFor, gathered, describe, sleep } from './link.js';

export class Receiver {
    constructor({ onStatus, onStream, onInfo }) {
        this.onStatus = onStatus;
        this.onStream = onStream;
        this.onInfo = onInfo;
        this.code = null;
        this.pc = null;
        this.dc = null;
        this.run = 0;
        this.state = 'idle';     // idle | searching | connecting | connected
        this.last = null;        // previous stats sample
    }

    get connected() { return this.state === 'connected'; }

    start(code) {
        code = cleanCode(code);
        if (!code || code === this.code) return;
        this.stop();
        this.code = code;
        this.loop(++this.run);
    }

    stop() {
        this.run++;
        this.closePeer();
        this.code = null;
        this.status('idle', '');
    }

    status(state, text) {
        this.state = state;
        this.onStatus(state, text);
    }

    async loop(run) {
        const alive = () => run === this.run;
        while (alive()) {
            if (this.pc) { await sleep(500); continue; }   // connecting or connected; closePeer() clears it
            try {
                await this.attempt(alive);
            } catch (e) {
                this.closePeer();
                if (alive()) this.status('searching', `Problem: ${e.message}`);
                await sleep(3000);
            }
            if (alive() && !this.pc) await sleep(1000);
        }
    }

    async attempt(alive) {
        const id = randomId();
        if (this.state !== 'searching') this.status('searching', 'Looking for your PC...');
        await send(this.code, 'hello', { id });
        const offer = await waitFor(this.code, 'offer-' + id, { timeout: 6000, isCancelled: () => !alive() });
        if (!alive()) return;
        if (!offer) {
            this.status('searching', `No PC is sharing with code ${this.code}.\nOn the PC open host.html and press Share screen.`);
            return;
        }
        this.status('connecting', 'Connecting...');
        const pc = this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pc.ontrack = e => {
            // Show frames as soon as they arrive instead of buffering for smoothness.
            try { e.receiver.playoutDelayHint = 0; } catch { /* not supported */ }
            try { e.receiver.jitterBufferTarget = 0; } catch { /* not supported */ }
            if (e.track.kind === 'video') this.onStream(e.streams[0] || new MediaStream(pc.getReceivers().map(r => r.track)));
        };
        pc.ondatachannel = e => {
            this.dc = e.channel;
            this.dc.onmessage = m => this.onMessage(pc, m.data);
        };
        pc.onconnectionstatechange = () => {
            if (pc !== this.pc) return;
            const s = pc.connectionState;
            if (s === 'connected') {
                clearTimeout(this.dropTimer);
                this.status('connected', 'Connected');
            } else if (s === 'failed' || s === 'closed') {
                this.lost('Connection lost, reconnecting...');
            } else if (s === 'disconnected') {
                clearTimeout(this.dropTimer);
                this.dropTimer = setTimeout(() => {
                    if (pc === this.pc && pc.connectionState !== 'connected') this.lost('Connection lost, reconnecting...');
                }, 4000);
            }
        };
        await pc.setRemoteDescription(offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        if (pc !== this.pc || !alive()) return;
        await send(this.code, 'answer-' + id, describe(pc));
        setTimeout(() => {
            if (pc === this.pc && pc.connectionState !== 'connected') {
                this.lost('Found the PC but the video could not get through.\nAre the phone and the PC on the same Wi-Fi?');
            }
        }, 15000);
    }

    onMessage(pc, data) {
        if (pc !== this.pc) return;
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg.t === 'info') this.onInfo(msg);
        if (msg.t === 'bye') this.lost('The PC stopped sharing.\nWaiting for it to share again...');
    }

    lost(text) {
        this.closePeer();
        this.status('searching', text);
    }

    closePeer() {
        clearTimeout(this.dropTimer);
        if (this.pc) {
            this.pc.onconnectionstatechange = null;
            this.pc.close();
        }
        this.pc = null;
        this.dc = null;
        this.last = null;
        this.onStream(null);
        this.onInfo({ control: false });
    }

    send(msg) {
        if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(msg));
    }

    // "1920x1080 · 30 fps · 8.2 Mbps · 9 ms", or '' when not connected.
    async stats() {
        const pc = this.pc;
        if (!pc || !this.connected) return '';
        const report = await pc.getStats();
        let video = null, rtt = null;
        report.forEach(s => {
            if (s.type === 'inbound-rtp' && s.kind === 'video') video = s;
            if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime !== undefined) rtt = s.currentRoundTripTime;
        });
        if (!video) return '';
        const now = { t: video.timestamp, bytes: video.bytesReceived };
        let mbps = 0;
        if (this.last && now.t > this.last.t) mbps = (now.bytes - this.last.bytes) * 8 / ((now.t - this.last.t) / 1000) / 1e6;
        this.last = now;
        const parts = [];
        if (video.frameWidth) parts.push(`${video.frameWidth}x${video.frameHeight}`);
        if (video.framesPerSecond !== undefined) parts.push(`${Math.round(video.framesPerSecond)} fps`);
        parts.push(`${mbps.toFixed(1)} Mbps`);
        if (rtt !== null) parts.push(`${Math.round(rtt * 1000)} ms`);
        return parts.join(' · ');
    }
}
