"""Lets VR Desktop click and scroll on this PC (Windows only, no extra packages).

The headset sends clicks to host.html (open in a browser on this PC), which passes them on
to this little server. It only listens on 127.0.0.1 and only takes requests from pages served
by localhost, so nothing on the network (and nothing through ngrok) can reach it directly.

Usage:  python control.py      (keep it running while you want mouse control)
"""
import ctypes
import http.server
import json
import re
import sys
from ctypes import wintypes

PORT = 8001
ALLOWED_ORIGIN = re.compile(r'^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$')

if sys.platform != 'win32':
    sys.exit('control.py only works on Windows.')

user32 = ctypes.windll.user32
# Work in real pixels, whatever the display scaling is (125%, 150%...).
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except (AttributeError, OSError):
    user32.SetProcessDPIAware()

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120


class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT), ('rcWork', wintypes.RECT),
                ('dwFlags', wintypes.DWORD), ('szDevice', wintypes.WCHAR * 32)]


MonitorEnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC,
                                     ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
user32.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(wintypes.RECT), MonitorEnumProc, wintypes.LPARAM]
user32.GetMonitorInfoW.argtypes = [wintypes.HMONITOR, ctypes.POINTER(MONITORINFOEXW)]
user32.mouse_event.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_long, ctypes.c_size_t]


def monitors():
    found = []

    def callback(hmon, hdc, rect, data):
        info = MONITORINFOEXW()
        info.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
            r = info.rcMonitor
            found.append({'name': info.szDevice, 'x': r.left, 'y': r.top, 'w': r.right - r.left,
                          'h': r.bottom - r.top, 'primary': bool(info.dwFlags & 1)})
        return True

    user32.EnumDisplayMonitors(None, None, MonitorEnumProc(callback), 0)
    found.sort(key=lambda m: (m['x'], m['y']))
    return found


def move_to(mon, x, y):
    # x, y: 0..1 across the shared screen
    px = mon['x'] + round(min(max(x, 0.0), 1.0) * (mon['w'] - 1))
    py = mon['y'] + round(min(max(y, 0.0), 1.0) * (mon['h'] - 1))
    user32.SetCursorPos(px, py)


def handle(msg):
    mons = monitors()
    i = msg.get('monitor')
    if not isinstance(i, int) or not 0 <= i < len(mons):
        raise ValueError('unknown monitor')
    x, y = float(msg['x']), float(msg['y'])
    kind = msg.get('t')
    if kind == 'click':
        move_to(mons[i], x, y)
        down, up = ((MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) if msg.get('button') == 'right'
                    else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP))
        user32.mouse_event(down, 0, 0, 0, 0)
        user32.mouse_event(up, 0, 0, 0, 0)
    elif kind == 'scroll':
        move_to(mons[i], x, y)
        notches = max(-20.0, min(20.0, float(msg['dy'])))   # > 0: scroll down
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, -round(notches * WHEEL_DELTA), 0)
    else:
        raise ValueError('unknown input')


class Handler(http.server.BaseHTTPRequestHandler):
    def allowed(self):
        origin = self.headers.get('Origin')
        return origin if origin and ALLOWED_ORIGIN.match(origin) else None

    def reply(self, code, body=None):
        self.send_response(code)
        origin = self.allowed()
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Vary', 'Origin')
        data = json.dumps(body).encode() if body is not None else b''
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.reply(204 if self.allowed() else 403)

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error': 'only pages from localhost may use this'})
        if self.path == '/monitors':
            return self.reply(200, monitors())
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
        if not self.allowed():
            return self.reply(403, {'error': 'only pages from localhost may use this'})
        if self.path != '/input':
            return self.reply(404, {'error': 'not found'})
        length = int(self.headers.get('Content-Length') or 0)
        if length > 4096:
            return self.reply(413, {'error': 'too big'})
        try:
            handle(json.loads(self.rfile.read(length)))
        except (ValueError, KeyError, TypeError) as e:
            return self.reply(400, {'error': str(e)})
        self.reply(204)

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    print(f'VR Desktop mouse control on http://127.0.0.1:{PORT} (Ctrl+C to stop)')
    for n, m in enumerate(monitors(), 1):
        print(f"  screen {n}: {m['w']}x{m['h']} at {m['x']},{m['y']}{' (main)' if m['primary'] else ''}")
    try:
        http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
