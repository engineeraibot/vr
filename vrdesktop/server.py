"""VR Desktop server. Serves this folder (without caching, so the phone always runs the latest
code) plus a tiny mailbox at /signal/<room>/<box> that the PC and the phone use to find each
other (the WebRTC handshake): POST stores a small message, GET takes it out (204 if empty).

  http://localhost:8000      for the PC's browser (host.html); only reachable from this PC
  https://<wifi ip>:8443     for the phone on the same Wi-Fi. The phone needs https to read the
                             gyroscope; the certificate is made here, by itself, so the phone
                             warns about it the first time (Advanced -> Proceed).

Usage:  python server.py [phone address]   (the address is picked by itself; give it if the guess is wrong)
(`ngrok http 8000` still works too, instead of the Wi-Fi address.)
"""
import functools
import http.server
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time

HTTP_PORT = 8000
HTTPS_PORT = 8443
ROOT = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(ROOT, 'cert')

SIGNAL_PATH = re.compile(r'^/signal/([A-Z0-9]{4,16})/([a-z0-9-]{1,40})$')
SIGNAL_MAX_BYTES = 64 * 1024
SIGNAL_TTL = 60          # seconds a message waits before it's thrown away
SIGNAL_MAX_BOXES = 200

mailbox = {}             # (room, box) -> (time, bytes)
mailbox_lock = threading.Lock()
phone_url = None


def mailbox_prune(now):
    for key in [k for k, (t, _) in mailbox.items() if now - t > SIGNAL_TTL]:
        del mailbox[key]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/phone.json':   # host.html shows the address to open on the phone
            return self.send_json(json.dumps({'url': phone_url}).encode())
        m = SIGNAL_PATH.match(self.path)
        if not m:
            return super().do_GET()
        with mailbox_lock:
            mailbox_prune(time.time())
            item = mailbox.pop(m.groups(), None)
        if item is None:
            self.send_response(204)
            self.end_headers()
            return
        self.send_json(item[1])

    def do_POST(self):
        m = SIGNAL_PATH.match(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        if not m or length > SIGNAL_MAX_BYTES:
            self.send_error(404 if not m else 413)
            return
        body = self.rfile.read(length)
        with mailbox_lock:
            now = time.time()
            mailbox_prune(now)
            if len(mailbox) >= SIGNAL_MAX_BOXES and m.groups() not in mailbox:
                self.send_error(503)
                return
            mailbox[m.groups()] = (now, body)
        self.send_response(204)
        self.end_headers()

    def log_message(self, format, *args):
        if not self.path.startswith('/signal/'):  # the handshake polls every second
            super().log_message(format, *args)


class TLSServer(http.server.ThreadingHTTPServer):
    """HTTPS, with the TLS handshake done in each connection's own thread (a slow or refusing
    client, like a phone that hasn't accepted the certificate yet, doesn't hold up the rest)."""

    def __init__(self, address, handler, context):
        self.context = context
        super().__init__(address, handler)

    def finish_request(self, request, client_address):
        try:
            tls = self.context.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError):
            return
        try:
            self.RequestHandlerClass(tls, client_address, self)
        finally:
            tls.close()

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ssl.SSLError, ConnectionError)):
            super().handle_error(request, client_address)


def local_ips():
    """This PC's IPv4 addresses, the likeliest home Wi-Fi / LAN one first. A VPN can own the
    route to the internet, so that alone doesn't say which address the phone can reach:
    home routers almost always hand out 192.168.x.x, then 10.x.x.x, VPNs often 172.16-31.x.x."""
    ips = set()
    try:
        ips.update(a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))   # nothing is sent: this only picks the route
        ips.add(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    ips = [ip for ip in ips if not ip.startswith(('127.', '169.254.'))]

    def rank(ip):
        a, b = (int(x) for x in ip.split('.')[:2])
        if a == 192 and b == 168:
            return 0
        if a == 10:
            return 1
        if a == 172 and 16 <= b <= 31:
            return 2
        return 3
    return sorted(ips, key=lambda ip: (rank(ip), ip))


def find_openssl():
    found = shutil.which('openssl')
    if found:
        return found
    for base in (os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)'), os.environ.get('LOCALAPPDATA')):
        for sub in (r'Git\usr\bin\openssl.exe', r'Programs\Git\usr\bin\openssl.exe', r'Git\mingw64\bin\openssl.exe'):
            path = os.path.join(base or '', sub)
            if base and os.path.exists(path):
                return path
    return None


def make_cert(ips):
    """A self-signed certificate for this PC's addresses, made once (and again if they change)."""
    cert, key, stamp = (os.path.join(CERT_DIR, n) for n in ('cert.pem', 'key.pem', 'ip.txt'))
    names = ' '.join(sorted(ips))
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp):
        with open(stamp) as f:
            if f.read().strip() == names:
                return cert, key
    openssl = find_openssl()
    if not openssl:
        print('Could not find openssl (it comes with Git for Windows), so no https for the phone.')
        return None
    os.makedirs(CERT_DIR, exist_ok=True)
    san = ','.join([f'IP:{ip}' for ip in sorted(ips)] + ['IP:127.0.0.1', 'DNS:localhost'])
    subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
                    '-keyout', key, '-out', cert, '-subj', '/CN=VR Desktop', '-addext', f'subjectAltName={san}'],
                   check=True, capture_output=True)
    with open(stamp, 'w') as f:
        f.write(names)
    print(f'Made a new certificate for {names} (in {CERT_DIR})')
    return cert, key


def serve(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()


if __name__ == '__main__':
    handler = functools.partial(Handler, directory=ROOT)
    # Only this PC can use plain http (ngrok connects from this PC too).
    serve(http.server.ThreadingHTTPServer(('127.0.0.1', HTTP_PORT), handler))
    print(f'VR Desktop')
    print(f'  PC:    http://localhost:{HTTP_PORT}/host.html')

    ips = local_ips()
    if len(sys.argv) > 1:          # python server.py 192.168.1.23: the address the phone should use
        ips = [sys.argv[1]] + [ip for ip in ips if ip != sys.argv[1]]
    pair = None
    if not ips:
        print('  No Wi-Fi / network address found: for the phone use ngrok instead.')
    else:
        try:
            pair = make_cert(ips)
        except (subprocess.CalledProcessError, OSError) as e:
            print(f'  Could not make a certificate ({e}): for the phone use ngrok instead.')
    if pair:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(*pair)
        serve(TLSServer(('', HTTPS_PORT), handler, ctx))
        phone_url = f'https://{ips[0]}:{HTTPS_PORT}/'
        print(f'  phone: {phone_url}   (same Wi-Fi; first time: Advanced -> Proceed)')
        for ip in ips[1:]:
            print(f'         or https://{ip}:{HTTPS_PORT}/ if the phone is on that network'
                  f' (python server.py {ip} to make it the main one)')
    print('Ctrl+C to stop')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
