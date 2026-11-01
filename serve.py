#!/usr/bin/env python3
"""Demo server. Static files are not cached. Search runs here, not in the browser."""
import json
import os
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 64_000


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/server") or path.startswith("/test") or path.startswith("/api"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/search":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            self.send_error(400)
            return
        if length < 0 or length > MAX_BODY:
            self.send_error(413)
            return
        raw = self.rfile.read(length)
        try:
            json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self.send_error(400)
            return
        try:
            completed = subprocess.run(
                ["node", "--import", "./test/register.mjs", "server/search-cli.js"],
                input=raw or b"{}",
                capture_output=True,
                cwd=ROOT,
                timeout=25,
                env=os.environ.copy(),
            )
        except subprocess.TimeoutExpired:
            self._json(504, {"error": "החיפוש לקח יותר מדי זמן. אין מחיר להציג."})
            return
        if completed.returncode != 0 or not completed.stdout:
            self._json(502, {"error": "החיפוש לא החזיר תוצאה. אין מחיר להציג."})
            return
        self._json(200, body=completed.stdout)

    def _json(self, status, payload=None, body=None):
        data = body if body is not None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 3000), Handler).serve_forever()
