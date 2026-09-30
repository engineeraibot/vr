// PC side: captures the screen and streams it to the headset over WebRTC. Optionally passes
// the headset's clicks / scrolls on to control.py, which moves the real mouse.
import { ICE_SERVERS, randomCode, send, take, waitFor, gathered, describe } from './link.js';

const CONTROL_URL = 'http://127.0.0.1:8001';
const LS = 'vrdesktop.host';
const $ = id => document.getElementById(id);

const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const S = {
    code: saved.code || randomCode(),
    stream: null,
    pc: null,
    dc: null,
    polling: false,
    monitors: [],
    controlOk: false,
    controlQueue: Promise.resolve(),
    last: null,
};
const SETTINGS = ['content', 'res', 'fps', 'bitrate', 'codec', 'audio', 'control', 'monitor'];

function save() {
    const o = { code: S.code };
    for (const id of SETTINGS) o[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ }
}

function setStatus(text, state = '') {
    $('status').textContent = text;
    $('status').dataset.state = state;
}

// ------------------------------------------------------------------ sharing

async function share() {
    if (S.stream) return stopSharing();
    const fps = +$('fps').value;
    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: fps, max: 60 }, cursor: 'always', displaySurface: 'monitor' },
            audio: $('audio').value === '1',
            systemAudio: 'include',
            selfBrowserSurface: 'include',
            surfaceSwitching: 'include',
            monitorTypeSurfaces: 'include',
        });
    } catch (e) {
        setStatus(e.name === 'NotAllowedError' ? 'Sharing was cancelled.' : `Could not share the screen: ${e.message}`);
        return;
    }
    S.stream = stream;
    const video = stream.getVideoTracks()[0];
    video.addEventListener('ended', () => stopSharing());
    pickMonitor(video.getSettings());
    await applyQuality();
    $('preview').srcObject = stream;
    $('preview').classList.remove('hidden');
    $('share').textContent = 'Stop sharing';
    $('share').classList.add('stop');
    setStatus(`Sharing. Waiting for the headset: type ${S.code} on the phone.`);
    updateControlStatus();
}

function stopSharing() {
    if (!S.stream) return;
    disconnect();
    S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
    $('preview').srcObject = null;
    $('preview').classList.add('hidden');
    $('share').textContent = 'Share screen';
    $('share').classList.remove('stop');
    $('stats').textContent = '';
    setStatus('Not sharing.');
    updateControlStatus();
}

// The phone says hello every few seconds until it gets an offer.
async function poll() {
    if (!S.stream || S.polling) return;
    S.polling = true;
    try {
        const hello = await take(S.code, 'hello');
        if (hello && /^[0-9a-f]{16}$/.test(hello.id)) connect(hello.id).catch(e => setStatus(`Connection error: ${e.message}`));
    } catch (e) {
        setStatus(`Signal server problem: ${e.message}`);
    } finally {
        S.polling = false;
    }
}

async function connect(id) {
    disconnect();   // one headset at a time; a new one replaces the old
    const pc = S.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    for (const track of S.stream.getTracks()) {
        const tr = pc.addTransceiver(track, { direction: 'sendonly', streams: [S.stream] });
        if (track.kind === 'video') preferCodec(tr, $('codec').value);
    }
    const dc = S.dc = pc.createDataChannel('input');
    dc.onopen = () => sendInfo();
    dc.onmessage = e => onInput(e.data);
    pc.onconnectionstatechange = () => {
        if (pc !== S.pc) return;
        const s = pc.connectionState;
        if (s === 'connected') {
            setStatus('Headset connected.', 'connected');
            $('kick').disabled = false;
            applyQuality();
        } else if (s === 'failed' || s === 'closed') {
            disconnect();
            setStatus('Headset connection lost. Waiting for it to come back...');
        } else if (s === 'disconnected') setStatus('Headset connection interrupted...');
    };
    setStatus('A headset is connecting...');
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (pc !== S.pc) return;
    await send(S.code, 'offer-' + id, describe(pc));
    const answer = await waitFor(S.code, 'answer-' + id, { timeout: 30000, isCancelled: () => pc !== S.pc });
    if (pc !== S.pc) return;
    if (!answer) {
        disconnect();
        setStatus('The headset did not answer. Waiting...');
        return;
    }
    await pc.setRemoteDescription(answer);
}

function disconnect() {
    const { pc, dc } = S;
    S.pc = S.dc = null;
    S.last = null;
    $('kick').disabled = true;
    if (dc && dc.readyState === 'open') {
        try { dc.send(JSON.stringify({ t: 'bye' })); } catch { /* ignore */ }
    }
    if (pc) {
        pc.onconnectionstatechange = null;
        setTimeout(() => pc.close(), 200);  // let the goodbye get out first
    }
}

function preferCodec(transceiver, name) {
    if (!name || !transceiver.setCodecPreferences || !RTCRtpSender.getCapabilities) return;
    const codecs = RTCRtpSender.getCapabilities('video').codecs;
    const want = codecs.filter(c => c.mimeType.toUpperCase() === 'VIDEO/' + name);
    if (!want.length) return;
    try { transceiver.setCodecPreferences([...want, ...codecs.filter(c => !want.includes(c))]); } catch { /* keep the default */ }
}

async function applyQuality() {
    const track = S.stream && S.stream.getVideoTracks()[0];
    if (!track) return;
    const text = $('content').value === 'text';
    const fps = +$('fps').value, res = +$('res').value;
    track.contentHint = text ? 'detail' : 'motion';
    const c = { frameRate: { ideal: fps, max: fps } };
    if (res) {
        c.width = { max: Math.round(res * 16 / 9) * 2 };  // limits the height; wide screens keep their shape
        c.height = { max: res };
    }
    try { await track.applyConstraints(c); } catch (e) { console.warn('applyConstraints', e); }
    const sender = S.pc && S.pc.getSenders().find(s => s.track === track);
    if (!sender) return;
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) return;
    p.encodings[0].maxBitrate = +$('bitrate').value * 1e6;
    p.encodings[0].maxFramerate = fps;
    p.degradationPreference = text ? 'maintain-resolution' : 'maintain-framerate';
    try { await sender.setParameters(p); } catch (e) { console.warn('setParameters', e); }
}

async function updateStats() {
    const pc = S.pc;
    if (!pc || pc.connectionState !== 'connected') {
        if (S.stream) $('stats').textContent = '';
        return;
    }
    const report = await pc.getStats();
    let out = null, rtt = null;
    report.forEach(s => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') out = s;
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime !== undefined) rtt = s.currentRoundTripTime;
    });
    if (!out) return;
    let mbps = 0;
    if (S.last && out.timestamp > S.last.t) mbps = (out.bytesSent - S.last.bytes) * 8 / ((out.timestamp - S.last.t) / 1000) / 1e6;
    S.last = { t: out.timestamp, bytes: out.bytesSent };
    const parts = [`${out.frameWidth || '?'}x${out.frameHeight || '?'}`, `${Math.round(out.framesPerSecond || 0)} fps`, `${mbps.toFixed(1)} Mbps`];
    if (out.encoderImplementation) parts.push(out.encoderImplementation);
    if (rtt !== null) parts.push(`${Math.round(rtt * 1000)} ms`);
    if (out.qualityLimitationReason && out.qualityLimitationReason !== 'none') parts.push(`limited by ${out.qualityLimitationReason}`);
    $('stats').textContent = parts.join(' · ');
}

// ------------------------------------------------------------------ mouse control

function controlActive() {
    const track = S.stream && S.stream.getVideoTracks()[0];
    const surface = track && track.getSettings().displaySurface;
    return $('control').checked && S.controlOk && $('monitor').value !== '' && (!surface || surface === 'monitor');
}

function sendInfo() {
    if (S.dc && S.dc.readyState === 'open') S.dc.send(JSON.stringify({ t: 'info', control: controlActive() }));
}

function onInput(data) {
    if (!controlActive()) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const inside = v => typeof v === 'number' && v >= 0 && v <= 1;
    if (!inside(m.x) || !inside(m.y)) return;
    let body;
    if (m.t === 'click') body = { t: 'click', x: m.x, y: m.y, button: m.button === 'right' ? 'right' : 'left' };
    else if (m.t === 'scroll' && typeof m.dy === 'number') body = { t: 'scroll', x: m.x, y: m.y, dy: Math.max(-20, Math.min(20, m.dy)) };
    else return;
    body.monitor = +$('monitor').value;
    // One after the other, so a double click stays a double click.
    S.controlQueue = S.controlQueue.then(() => fetch(CONTROL_URL + '/input', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).catch(() => { S.controlOk = false; updateControlStatus(); });
}

async function checkControl() {
    try {
        const r = await fetch(CONTROL_URL + '/monitors');
        if (!r.ok) throw new Error(r.status);
        const list = await r.json();
        const changed = JSON.stringify(list) !== JSON.stringify(S.monitors);
        S.monitors = list;
        S.controlOk = true;
        if (changed) fillMonitors();
    } catch {
        S.controlOk = false;
    }
    updateControlStatus();
}

function fillMonitors() {
    const sel = $('monitor'), prev = sel.value || saved.monitor;
    sel.innerHTML = '';
    S.monitors.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = `${i + 1}: ${m.w}x${m.h}${m.primary ? ' (main)' : ''}`;
        sel.appendChild(o);
    });
    const primary = S.monitors.findIndex(m => m.primary);
    sel.value = prev !== undefined && prev !== '' && S.monitors[prev] ? prev : String(Math.max(0, primary));
    if (S.stream) pickMonitor(S.stream.getVideoTracks()[0].getSettings());
}

// Which screen was shared? Chrome doesn't say, but its size usually gives it away.
function pickMonitor(settings) {
    if (!S.monitors.length || !settings.width) return;
    const same = S.monitors.map((m, i) => i).filter(i => S.monitors[i].w === settings.width && S.monitors[i].h === settings.height);
    const sel = $('monitor');
    if (same.length && !same.includes(+sel.value)) sel.value = same.find(i => S.monitors[i].primary) ?? same[0];
}

function updateControlStatus() {
    const el = $('controlStatus');
    const track = S.stream && S.stream.getVideoTracks()[0];
    const surface = track && track.getSettings().displaySurface;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        el.textContent = 'Mouse control only works when this page is opened as http://localhost:8000/host.html.';
    } else if (!S.controlOk) {
        el.innerHTML = 'control.py is not running. Start it in another terminal: <code>python control.py</code>';
    } else if (surface && surface !== 'monitor') {
        el.textContent = 'You shared a window or a tab: mouse control needs "Entire screen".';
    } else if (!$('control').checked) {
        el.textContent = 'control.py is running. Tick the box to allow clicks from the headset.';
    } else {
        el.textContent = 'On. In the headset, look down and turn Mouse ON.';
    }
    sendInfo();
}

// ------------------------------------------------------------------ setup

for (const id of SETTINGS) {
    if (saved[id] === undefined || id === 'monitor') continue;
    if ($(id).type === 'checkbox') $(id).checked = saved[id];
    else $(id).value = saved[id];
}
$('code').textContent = S.code;
save();
$('share').onclick = share;
$('kick').onclick = () => { disconnect(); setStatus(S.stream ? 'Headset disconnected. Waiting...' : 'Not sharing.'); };
$('newCode').onclick = () => {
    S.code = randomCode();
    $('code').textContent = S.code;
    disconnect();
    save();
    if (S.stream) setStatus(`New code. Waiting for the headset: type ${S.code} on the phone.`);
};
for (const id of ['content', 'res', 'fps', 'bitrate']) $(id).onchange = () => { save(); applyQuality(); };
for (const id of ['codec', 'audio', 'monitor']) $(id).onchange = () => { save(); updateControlStatus(); };
$('control').onchange = () => { save(); if ($('control').checked) checkControl(); else updateControlStatus(); };
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    $('originWarn').textContent = 'Tip: open this page on the PC as http://localhost:8000/host.html (not through ngrok): it is faster and mouse control needs it.';
    $('originWarn').classList.remove('hidden');
}
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    $('share').disabled = true;
    setStatus('This browser can\'t share the screen. Use Chrome or Edge on the PC, via http://localhost.');
}
window.addEventListener('beforeunload', () => disconnect());

// Timers in background tabs get slowed right down; a worker's don't, so it keeps the beat.
const beat = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000)'], { type: 'text/javascript' })));
let beats = 0;
beat.onmessage = () => {
    beats++;
    poll();
    if (beats % 2 === 0) updateStats().catch(() => {});
    if (beats % 5 === 0 && !S.controlOk && $('control').checked) checkControl();
};
checkControl();
fetch('phone.json').then(r => r.json()).then(({ url }) => { if (url) $('phoneUrl').textContent = url; }).catch(() => {});
