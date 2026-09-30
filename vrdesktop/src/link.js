// The WebRTC handshake between the PC (host.html) and the phone (index.html), through the
// /signal mailbox in server.py. The video itself goes straight from the PC to the phone.
//
//   phone: POST hello {id}          -> host: GET hello, makes an offer
//   host:  POST offer-<id> (SDP)    -> phone: GET offer-<id>, makes an answer
//   phone: POST answer-<id> (SDP)   -> host: GET answer-<id>, connected
//
// Both sides wait for all their ICE candidates before sending, so one message each way is enough.

export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I

export function randomCode(n = 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function cleanCode(s) {
    return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export function randomId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
}

const url = (room, box) => new URL(`signal/${room}/${box}`, location.href).href;
// ngrok's free plan shows a warning page to browsers unless asked not to.
const HEADERS = { 'ngrok-skip-browser-warning': '1' };

export async function send(room, box, data) {
    const r = await fetch(url(room, box), { method: 'POST', headers: HEADERS, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`signal server: ${r.status}`);
}

// Takes the message out of the box, or returns null if there is none yet.
export async function take(room, box) {
    const r = await fetch(url(room, box), { headers: HEADERS });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(r.status === 501 || r.status === 404
        ? 'the server has no /signal mailbox: run python server.py in the vrdesktop folder'
        : `signal server: ${r.status}`);
    return r.json();
}

// Polls a box until a message arrives, the time runs out or isCancelled() says so.
export async function waitFor(room, box, { timeout = 30000, every = 700, isCancelled = () => false } = {}) {
    const end = performance.now() + timeout;
    while (performance.now() < end && !isCancelled()) {
        const msg = await take(room, box);
        if (msg) return msg;
        await sleep(every);
    }
    return null;
}

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Resolves once ICE gathering is done (or after `ms`: a STUN server that doesn't answer
// shouldn't hold things up; the local network candidates are there by then).
export function gathered(pc, ms = 2500) {
    return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const done = () => {
            if (pc.iceGatheringState !== 'complete') return;
            pc.removeEventListener('icegatheringstatechange', done);
            resolve();
        };
        pc.addEventListener('icegatheringstatechange', done);
        setTimeout(resolve, ms);
    });
}

export function describe(pc) {
    return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
}
