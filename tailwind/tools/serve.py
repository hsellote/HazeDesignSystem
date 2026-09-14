#!/usr/bin/env python3
"""Dev server that never caches — ES modules are cached hard otherwise, and you
end up debugging a stale app.js. Use `npm run serve`."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    print(f"Haze design system → http://localhost:{port}/index.html")
    ThreadingHTTPServer(("", port), NoCache).serve_forever()
