"""Static file server for the VR projects, like `python -m http.server`, but it tells
browsers not to cache anything, so a phone always runs the latest version of the code.

Usage:  python serve.py [port]      (default 8000, serves this folder)
Then:   ngrok http 8000
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f'Serving {root} on http://localhost:{port} (no caching)')
    http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
