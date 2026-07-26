#!/usr/bin/env python3
"""Dev static server with caching disabled, so live edits always show on reload."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 5188


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Don't trust the Windows registry for these — wasm must be application/wasm,
    # and the emulator core archives / GBA ROM are plain binary downloads.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".data": "application/octet-stream",
        ".gba": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    with ThreadingHTTPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving (no-cache, threaded) on http://localhost:{PORT}")
        httpd.serve_forever()
