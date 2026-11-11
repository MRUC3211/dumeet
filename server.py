"""DU Meet signaling server.

Serves the frontend in public/ and relays WebRTC signaling messages between the
people in a meeting. Only the Python standard library is used:

  GET  /api/poll?room=..&id=..   messages *to* a browser (long polling: waits up
                                 to 20 s for a message, the browser then asks again)
  POST /api/send                 JSON message *from* a browser, relayed to others
  GET  /api/room?room=..         who is already in a meeting (shown in the lobby)
  GET  /api/ice                  STUN/TURN servers for the browsers' RTCPeerConnection
  GET  /healthz                  "I'm alive" for the cloud host (no password needed)
  POST /login                    password form; sets a login cookie (DU_MEET_PASSWORD)

Long polling is used instead of a streaming connection because tunnels such as
Cloudflare's (used to share DU Meet over the internet) hold streamed responses
back, while ordinary request/response pairs always get through.

Audio and video never pass through this server. Browsers send media directly to
each other (peer-to-peer); the server only helps them find each other. When two
networks block a direct link (common on mobile data), media goes through a TURN
relay instead: set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (in the
environment or in a turn.env file next to this one) and /api/ice hands the
browsers short-lived Cloudflare TURN credentials. The API token stays here.
"""

import hashlib
import hmac
import html
import json
import os
import queue
import ssl
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

# 127.0.0.1 = only this laptop. A cloud host (Render) sets HOST=0.0.0.0 so outside requests reach it.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
PUBLIC_DIR = (Path(__file__).parent / "public").resolve()
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}
POLL_SECONDS = 20     # how long one poll waits for a message
GONE_SECONDS = 15     # a tab that hasn't polled for this long has left
MAX_BODY = 4 * 1024 * 1024  # whiteboard sync for late joiners can be large

STUN_ONLY = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]}]
TURN_TTL = 24 * 3600  # seconds a set of TURN credentials stays valid


def load_turn_env():
    """KEY=VALUE lines from turn.env, without overriding real environment variables."""
    file = Path(__file__).parent / "turn.env"
    if file.is_file():
        for line in file.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.strip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"'))


load_turn_env()
PASSWORD = os.environ.get("DU_MEET_PASSWORD", "")
# Any TURN provider with a fixed username/password (e.g. ExpressTURN's free plan).
# TURN_URLS may hold several URLs separated by commas or spaces.
TURN_URLS = os.environ.get("TURN_URLS", "").replace(",", " ").split()
TURN_USERNAME = os.environ.get("TURN_USERNAME", "")
TURN_CREDENTIAL = os.environ.get("TURN_CREDENTIAL", "")
TURN_KEY_ID = os.environ.get("CLOUDFLARE_TURN_KEY_ID", "")
TURN_API_TOKEN = os.environ.get("CLOUDFLARE_TURN_API_TOKEN", "")
ice_cache = {"servers": None, "expires": 0.0}

# The python.org installer on macOS ships without root certificates; the system's
# own bundle lets HTTPS to Cloudflare work without running "Install Certificates".
TLS = ssl.create_default_context()
if Path("/etc/ssl/cert.pem").is_file():
    TLS.load_verify_locations("/etc/ssl/cert.pem")
ice_lock = threading.Lock()


def ice_servers():
    """STUN, plus TURN: a fixed username/password provider, or Cloudflare (credentials cached for half their life)."""
    if TURN_URLS and TURN_USERNAME and TURN_CREDENTIAL:
        return STUN_ONLY + [{"urls": TURN_URLS, "username": TURN_USERNAME, "credential": TURN_CREDENTIAL}]
    if not (TURN_KEY_ID and TURN_API_TOKEN):
        return STUN_ONLY
    with ice_lock:
        if ice_cache["servers"] and time.monotonic() < ice_cache["expires"]:
            return ice_cache["servers"]
        request = urllib.request.Request(
            f"https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers",
            data=json.dumps({"ttl": TURN_TTL}).encode(),
            headers={"Authorization": f"Bearer {TURN_API_TOKEN}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=8, context=TLS) as response:
                servers = json.load(response)["iceServers"]
        except (OSError, ValueError, KeyError) as error:
            print(f"TURN credentials failed ({error}); calls between some networks may not connect.")
            return STUN_ONLY
        if isinstance(servers, dict):
            servers = [servers]
        for server in servers:
            # Browsers refuse port 53, so those URLs only cause timeouts.
            urls = server["urls"] if isinstance(server["urls"], list) else [server["urls"]]
            server["urls"] = [url for url in urls if ":53?" not in url and not url.endswith(":53")]
        ice_cache.update(servers=servers, expires=time.monotonic() + TURN_TTL / 2)
        return servers


# ---- Password lock -------------------------------------------------------------
# With DU_MEET_PASSWORD set, every page and API call needs a login cookie. The cookie
# holds an HMAC of the password, so changing the password signs everyone out.
COOKIE = "du_meet_auth"
COOKIE_DAYS = 365
MAX_FAILS = 8            # wrong passwords allowed per address ...
FAIL_WINDOW = 15 * 60    # ... in this many seconds
fails = {}               # address -> times of recent wrong passwords
fails_lock = threading.Lock()


def auth_token():
    return hmac.new(PASSWORD.encode(), b"du-meet-login", hashlib.sha256).hexdigest()


def too_many_fails(address, add=False):
    now = time.monotonic()
    with fails_lock:
        recent = [t for t in fails.get(address, []) if now - t < FAIL_WINDOW]
        if add:
            recent.append(now)
        fails[address] = recent
        return len(recent) >= MAX_FAILS


LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#16181f"><title>DU Meet</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 16px;
  background: #16181f; color: #f3f1ee; font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
form { width: 100%; max-width: 340px; display: grid; gap: 14px; }
h1 { margin: 0 0 4px; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
p { margin: 0; color: #a9adb9; font-size: 0.95rem; }
input { width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid #353946;
  background: #1f222b; color: inherit; font: inherit; }
input:focus { outline: 2px solid #a9b2f0; outline-offset: 1px; }
button { padding: 14px; border: 0; border-radius: 999px; background: #a9b2f0; color: #15182b;
  font: inherit; font-weight: 600; cursor: pointer; }
.error { color: #f29b8f; }
</style></head>
<body><form method="post" action="/login">
<h1>DU Meet</h1><p>This app is private. Enter the password to continue.</p>
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="{next}">
{error}<button type="submit">Continue</button>
</form></body></html>"""


class Peer:
    """One browser tab that is in a meeting."""

    def __init__(self, peer_id, name, mic, cam):
        self.id = peer_id
        self.name = name
        self.mic = mic
        self.cam = cam
        self.hand = False
        self.screen = False
        self.rec = False            # recording the meeting
        self.cc = False             # wants live captions
        self.inbox = queue.Queue()  # messages waiting for this tab's next poll
        self.polls = 0              # polls currently waiting
        self.last_seen = time.monotonic()

    def info(self):
        return {
            "id": self.id,
            "name": self.name,
            "mic": self.mic,
            "cam": self.cam,
            "hand": self.hand,
            "screen": self.screen,
            "rec": self.rec,
            "cc": self.cc,
        }


rooms = {}  # meeting code -> {peer id -> Peer}
lock = threading.Lock()


def members(room):
    with lock:
        return list(rooms.get(room, {}).values())


def find(room, peer_id):
    with lock:
        return rooms.get(room, {}).get(peer_id)


def deliver(room, message, to=None, exclude=None):
    """Queue a message for one peer (to=...) or everyone in the room."""
    for peer in members(room):
        if (to is None or peer.id == to) and peer.id != exclude:
            peer.inbox.put(message)


def remove(room, peer):
    """Take a peer out of its room and tell everyone else it left."""
    with lock:
        people = rooms.get(room, {})
        if people.get(peer.id) is not peer:
            return
        del people[peer.id]
        if not people:
            del rooms[room]
    deliver(room, {"type": "leave", "id": peer.id})


def remove_silent_peers():
    """Background loop: drop tabs that were closed without saying goodbye."""
    while True:
        time.sleep(5)
        now = time.monotonic()
        with lock:
            everyone = [(room, peer) for room, people in rooms.items() for peer in people.values()]
        for room, peer in everyone:
            if peer.polls == 0 and now - peer.last_seen > GONE_SECONDS:
                remove(room, peer)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/healthz":
            return self.send_json({"ok": True})
        if not self.logged_in():
            if url.path.startswith("/api/"):
                return self.send_error(401)
            return self.login_page(self.path)
        params = {key: values[0] for key, values in parse_qs(url.query).items()}
        if url.path == "/api/poll":
            self.poll(params)
        elif url.path == "/api/room":
            names = [peer.name for peer in members(params.get("room", ""))]
            self.send_json({"names": names})
        elif url.path == "/api/ice":
            self.send_json({"iceServers": ice_servers()})
        else:
            self.serve_file(unquote(url.path))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/login":
            return self.login()
        if not self.logged_in():
            return self.send_error(401)
        if path != "/api/send":
            return self.send_error(404)
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.send_error(413)
        try:
            message = json.loads(self.rfile.read(length))
        except ValueError:
            return self.send_error(400)
        room, sender = message.get("room"), message.get("from")
        if not isinstance(room, str) or not isinstance(sender, str):
            return self.send_error(400)
        peer = find(room, sender)
        if peer is None:
            return self.send_error(403)

        kind, data = message.get("type"), message.get("data")
        if kind == "bye":
            remove(room, peer)
        elif kind == "state":
            # Mic, camera, raised hand, presenting, recording and captions: remembered so that
            # people who join later see the right state.
            if isinstance(data, dict):
                for key in ("mic", "cam", "hand", "screen", "rec", "cc"):
                    if isinstance(data.get(key), bool):
                        setattr(peer, key, data[key])
            deliver(room, {"type": "state", "peer": peer.info()}, exclude=peer.id)
        else:
            # offer / answer / ice / chat / reaction / caption / whiteboard / poll /
            # sync / mute-request: passed on unchanged
            relay = {"type": kind, "from": peer.id, "data": data}
            deliver(room, relay, to=message.get("to"), exclude=peer.id)
        self.send_response(204)
        self.end_headers()

    def logged_in(self):
        if not PASSWORD:
            return True
        for part in (self.headers.get("Cookie") or "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE and hmac.compare_digest(value, auth_token()):
                return True
        return False

    def client_address_text(self):
        # Behind Render's proxy the real address is the first X-Forwarded-For entry.
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def login_page(self, next_path, error="", status=200):
        if not next_path.startswith("/") or next_path.startswith("//"):
            next_path = "/"
        message = f'<p class="error">{html.escape(error)}</p>' if error else ""
        body = LOGIN_PAGE.replace("{next}", html.escape(next_path)).replace("{error}", message).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def login(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            return self.send_error(413)
        form = {key: values[0] for key, values in parse_qs(self.rfile.read(length).decode(errors="replace")).items()}
        next_path = form.get("next", "/")
        if not next_path.startswith("/") or next_path.startswith("//"):
            next_path = "/"
        if not PASSWORD:
            return self.redirect(next_path)
        address = self.client_address_text()
        if too_many_fails(address):
            return self.login_page(next_path, "Too many wrong tries. Wait 15 minutes and try again.", 429)
        if not hmac.compare_digest(form.get("password", "").encode(), PASSWORD.encode()):
            too_many_fails(address, add=True)
            time.sleep(1)
            return self.login_page(next_path, "Wrong password. Try again.", 401)
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        cookie = f"{COOKIE}={auth_token()}; Max-Age={COOKIE_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax{secure}"
        self.redirect(next_path, cookie)

    def redirect(self, location, cookie=None):
        self.send_response(303)
        self.send_header("Location", location)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def poll(self, params):
        room, peer_id = params.get("room", ""), params.get("id", "")
        if not room or not peer_id:
            return self.send_error(400)

        peer = find(room, peer_id)
        if peer is None:
            # First poll (or the tab was dropped while offline): join the room.
            name = params.get("name", "").strip()[:40] or "Guest"
            peer = Peer(peer_id, name, params.get("mic") == "1", params.get("cam") == "1")
            with lock:
                people = rooms.setdefault(room, {})
                others = [p.info() for p in people.values()]
                people[peer_id] = peer
            peer.inbox.put({"type": "welcome", "peers": others})
            deliver(room, {"type": "join", "peer": peer.info()}, exclude=peer_id)

        peer.polls += 1
        messages = []
        try:
            try:
                messages.append(peer.inbox.get(timeout=POLL_SECONDS))
                while True:
                    messages.append(peer.inbox.get_nowait())
            except queue.Empty:
                pass
        finally:
            peer.polls -= 1
            peer.last_seen = time.monotonic()
        try:
            self.send_json({"messages": messages})
        except OSError:
            pass  # the tab left while waiting

    def serve_file(self, path):
        if path == "/":
            path = "/index.html"
        file = (PUBLIC_DIR / path.lstrip("/")).resolve()
        if not file.is_relative_to(PUBLIC_DIR) or not file.is_file():
            return self.send_error(404)
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(file.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        if not self.path.startswith(("/api/", "/healthz")):
            super().log_message(format, *args)


def main():
    threading.Thread(target=remove_silent_peers, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"DU Meet is running at http://localhost:{PORT}  (press Ctrl+C to stop)")
    if TURN_URLS and TURN_USERNAME and TURN_CREDENTIAL:
        print(f"TURN relay: {', '.join(TURN_URLS)}. Calls can connect across any two networks.")
    elif TURN_KEY_ID and TURN_API_TOKEN:
        print("TURN relay: key found (Cloudflare). Calls can connect across any two networks.")
    else:
        print("TURN relay: off. Calls between different networks may fail; see README section 1c.")
    print("Password lock: on." if PASSWORD else "Password lock: off (set DU_MEET_PASSWORD to turn it on).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDU Meet stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
