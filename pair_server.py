import os, subprocess, time, html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "10000"))
KEY = os.environ.get("PAIR_KEY", "")
CODE, STATUS, BACKUP = "/tmp/pair-code.txt", "/tmp/pair-status.txt", "/tmp/pair-backup.b64"
proc = None

def read(p):
    try:
        with open(p) as f:
            return f.read().strip()
    except OSError:
        return ""

def page(key):
    status, code, backup = read(STATUS), read(CODE), read(BACKUP)
    busy = status.startswith(("waiting", "starting", "installing"))
    refresh = '<meta http-equiv="refresh" content="4">' if busy else ""
    body = f"<h2>Legendary Hermes: WhatsApp pairing</h2><p>Status: <b>{html.escape(status or 'idle')}</b></p>"
    if code and not status.startswith("paired"):
        body += f"<p>Pairing code:</p><h1 style='letter-spacing:4px'>{html.escape(code)}</h1>"
        body += "<p>WhatsApp (the new number) > Settings > Linked devices > Link a device > <b>Link with phone number instead</b>, then enter this code.</p>"
    if backup:
        body += ("<p>Paired. Add this as Render env var <b>WA_CREDS_B64</b> (also set <b>WHATSAPP_ALLOWED_USERS</b> "
                 "to your own number). Saving it redeploys and starts the WhatsApp bridge:</p>"
                 f"<textarea rows='8' style='width:100%' readonly>{html.escape(backup)}</textarea>"
                 "<p>Keep it private. It gives full access to this WhatsApp account.</p>")
    body += (f"<form method='POST' action='/pair?key={html.escape(key)}'>"
             "<p>Number with country code, no +:</p>"
             "<input name='number' placeholder='234XXXXXXXXXX' style='padding:8px;width:100%'>"
             "<p><button style='padding:10px 16px'>Get pairing code</button></p></form>")
    return f"<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>{refresh}<body style='font-family:sans-serif;max-width:480px;margin:24px auto;padding:0 12px'>{body}</body>"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, text, headers=None):
        data = text.encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def authed(self):
        q = parse_qs(urlparse(self.path).query)
        k = (q.get("key") or [""])[0]
        return bool(KEY) and k == KEY, k
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/pair":
            ok, k = self.authed()
            return self.send(200, page(k)) if ok else self.send(403, "forbidden")
        self.send(200, "ok")
    def do_POST(self):
        global proc
        if urlparse(self.path).path != "/pair":
            return self.send(404, "not found")
        ok, k = self.authed()
        if not ok:
            return self.send(403, "forbidden")
        n = int(self.headers.get("Content-Length") or 0)
        number = "".join(c for c in parse_qs(self.rfile.read(n).decode()).get("number", [""])[0] if c.isdigit())
        if len(number) < 8:
            return self.send(400, "bad number")
        if proc and proc.poll() is None:
            proc.kill()
        for f in (CODE, STATUS, BACKUP):
            try: os.remove(f)
            except OSError: pass
        with open(STATUS, "w") as f:
            f.write("installing WhatsApp library (first time only)")
        proc = subprocess.Popen(["node", "/app/pair.mjs", number], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # Reply right away and let the page refresh. The pairing code can take a minute on the first run.
        self.send(303, "", {"Location": f"/pair?key={k}"})

ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()