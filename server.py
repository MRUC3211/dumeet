"""DU Meet signaling server.

Serves the frontend in public/ and relays WebRTC signaling messages between the
people in a meeting. Only the Python standard library is used:

  GET  /api/poll?room=..&id=..   messages *to* a browser (long polling: waits up
                                 to 20 s for a message, the browser then asks again)
  POST /api/send                 JSON message *from* a browser, relayed to others
  GET  /api/room?room=..         who is already in a meeting (shown in the lobby)
  GET  /api/ice                  STUN/TURN servers for the browsers' RTCPeerConnection
  GET  /healthz                  "I'm alive" for the cloud host (no password needed)
  POST /api/login                password -> access token (kept in the page's memory only,
                                 so every page load asks for the password again)
  GET/POST/DELETE /api/data      shared documents: calendar notes, saved songs, meeting history
  POST /api/media, GET /api/media/<id>   files shared in chat
  GET  /api/title, /api/search   YouTube titles and (with YOUTUBE_API_KEY) song search

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
import json
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import storage

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
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
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
# With DU_MEET_PASSWORD set, every API call needs an access token. The token is handed
# out by /api/login and lives only in the page's memory, so reloading the page (or
# opening it again) asks for the password again. Static files (the app's code) are
# public; they hold nothing private.
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


# ---- Shared data: calendar, saved songs, meeting history ----------------------------
STORE = storage.open_store()
COLLECTIONS = {"calendar", "songs", "meetings"}
MAX_DOC = 100 * 1024
MAX_MEDIA = 25 * 1024 * 1024
MEDIA_TYPES = ("image/", "audio/", "video/", "application/pdf", "text/plain")
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")

# ---- Meeting history ("who joined when, for how long") ------------------------------
# A meeting is one room code from its first join until everyone has been gone for
# MEETING_GRACE seconds (so a reload or a network blip doesn't split it in two).
MEETING_GRACE = int(os.environ.get("MEETING_GRACE", "90"))
meetings = {}            # room -> {"start", "empty", "people": [{id, name, joined, left}]}
meetings_lock = threading.Lock()


def meeting_join(room, peer):
    now = time.time()
    with meetings_lock:
        meeting = meetings.setdefault(room, {"start": now, "empty": None, "people": []})
        meeting["empty"] = None
        meeting["people"].append({"id": peer.id, "name": peer.name, "joined": now, "left": None})


def meeting_leave(room, peer):
    now = time.time()
    with meetings_lock:
        meeting = meetings.get(room)
        if not meeting:
            return
        for person in reversed(meeting["people"]):
            if person["id"] == peer.id and person["left"] is None:
                person["left"] = now
                break
        if all(person["left"] is not None for person in meeting["people"]):
            meeting["empty"] = now


def finish_meetings():
    now = time.time()
    done = []
    with meetings_lock:
        for room, meeting in list(meetings.items()):
            if meeting["empty"] and now - meeting["empty"] >= MEETING_GRACE:
                done.append((room, meetings.pop(room)))
    for room, meeting in done:
        end = meeting["empty"]
        secs = int(end - meeting["start"])
        if secs < 15:
            continue
        people = [{"name": p["name"], "joined": p["joined"], "left": p["left"] or end,
                   "secs": int((p["left"] or end) - p["joined"])} for p in meeting["people"]]
        try:
            STORE.put("meetings", storage.new_id(), {"room": room, "start": meeting["start"], "end": end,
                                                      "secs": secs, "people": people})
        except Exception as error:  # noqa: BLE001 - history must never break a call
            print(f"Could not save meeting history: {error}")


def youtube_title(video_id):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}")
    with urllib.request.urlopen(url, timeout=8, context=TLS) as response:
        data = json.load(response)
    return {"id": video_id, "title": data.get("title", ""), "channel": data.get("author_name", "")}


def youtube_search(text):
    query = urllib.parse.urlencode({
        "part": "snippet", "type": "video", "maxResults": 12, "q": text,
        "videoEmbeddable": "true", "key": YOUTUBE_API_KEY,
    })
    with urllib.request.urlopen(f"https://www.googleapis.com/youtube/v3/search?{query}", timeout=8, context=TLS) as response:
        data = json.load(response)
    return [{"id": item["id"]["videoId"], "title": item["snippet"]["title"], "channel": item["snippet"]["channelTitle"]}
            for item in data.get("items", [])]


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
    meeting_leave(room, peer)


def remove_silent_peers():
    """Background loop: drop tabs that were closed without saying goodbye."""
    while True:
        time.sleep(5)
        finish_meetings()
        now = time.monotonic()
        with lock:
            everyone = [(room, peer) for room, people in rooms.items() for peer in people.values()]
        for room, peer in everyone:
            if peer.polls == 0 and now - peer.last_seen > GONE_SECONDS:
                remove(room, peer)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        params = {key: values[0] for key, values in parse_qs(url.query).items()}
        path = url.path
        if path == "/healthz":
            return self.send_json({"ok": True})
        if path == "/api/auth-info":
            return self.send_json({"required": bool(PASSWORD)})
        if not path.startswith("/api/"):
            return self.serve_file(unquote(path))  # the app's code is public; data is not
        if not self.logged_in():
            return self.send_error(401)
        try:
            if path == "/api/poll":
                self.poll(params)
            elif path == "/api/room":
                self.send_json({"names": [peer.name for peer in members(params.get("room", ""))]})
            elif path == "/api/ice":
                self.send_json({"iceServers": ice_servers()})
            elif path == "/api/features":
                self.send_json({"search": bool(YOUTUBE_API_KEY), "storage": STORE.name,
                                "persistent": STORE.name == "Supabase"})
            elif path == "/api/data":
                if params.get("c") not in COLLECTIONS:
                    return self.send_error(400)
                self.send_json({"docs": STORE.list(params["c"])[:300]})
            elif path == "/api/title":
                video_id = params.get("v", "")
                if not video_id.replace("-", "").replace("_", "").isalnum() or len(video_id) != 11:
                    return self.send_error(400)
                self.send_json(youtube_title(video_id))
            elif path == "/api/search":
                if not YOUTUBE_API_KEY:
                    return self.send_json({"enabled": False, "items": []})
                self.send_json({"enabled": True, "items": youtube_search(params.get("q", "")[:100])})
            elif path.startswith("/api/media/"):
                self.send_media(path.rsplit("/", 1)[1])
            else:
                self.send_error(404)
        except (urllib.error.URLError, OSError, ValueError) as error:
            print(f"Request failed ({path}): {error}")
            self.send_error(502)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            return self.login()
        if not self.logged_in():
            return self.send_error(401)
        length = int(self.headers.get("Content-Length") or 0)
        if path == "/api/media":
            return self.upload_media(length)
        if length > (MAX_DOC if path == "/api/data" else MAX_BODY):
            return self.send_error(413)
        try:
            message = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_error(400)
        if path == "/api/data":
            collection, data = message.get("c"), message.get("data")
            if collection not in COLLECTIONS or not isinstance(data, dict):
                return self.send_error(400)
            doc_id = str(message.get("id") or storage.new_id())[:64]
            try:
                return self.send_json({"doc": STORE.put(collection, doc_id, data)})
            except Exception as error:  # noqa: BLE001
                print(f"Storage error: {error}")
                return self.send_error(502)
        if path != "/api/send":
            return self.send_error(404)
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
            # Mic, camera, presenting and recording: remembered so that people who
            # join later see the right state.
            if isinstance(data, dict):
                for key in ("mic", "cam", "hand", "screen", "rec", "cc"):
                    if isinstance(data.get(key), bool):
                        setattr(peer, key, data[key])
            deliver(room, {"type": "state", "peer": peer.info()}, exclude=peer.id)
        else:
            # offer / answer / ice / chat / reaction / whiteboard / poll / sync /
            # heart / music / timer ...: passed on unchanged
            relay = {"type": kind, "from": peer.id, "data": data}
            deliver(room, relay, to=message.get("to"), exclude=peer.id)
        self.send_response(204)
        self.end_headers()

    def do_DELETE(self):
        url = urlparse(self.path)
        params = {key: values[0] for key, values in parse_qs(url.query).items()}
        if not self.logged_in():
            return self.send_error(401)
        if url.path == "/api/data" and params.get("c") in COLLECTIONS and params.get("id"):
            try:
                STORE.delete(params["c"], params["id"])
            except Exception as error:  # noqa: BLE001
                print(f"Storage error: {error}")
                return self.send_error(502)
            return self.send_json({"ok": True})
        self.send_error(404)

    # ---- media shared in chat ----

    def upload_media(self, length):
        kind = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if length > MAX_MEDIA:
            return self.send_error(413)
        if not kind.startswith(MEDIA_TYPES):
            return self.send_error(415)
        media_id = storage.new_id()
        try:
            STORE.put_media(media_id, self.rfile.read(length), kind)
        except Exception as error:  # noqa: BLE001
            print(f"Media upload failed: {error}")
            return self.send_error(502)
        self.send_json({"id": media_id, "url": f"/api/media/{media_id}", "type": kind})

    def send_media(self, media_id):
        if not media_id.replace("-", "").isalnum():
            return self.send_error(404)
        body, kind = STORE.get_media(media_id)
        if body is None:
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=31536000, immutable")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    # ---- password ----

    def logged_in(self):
        if not PASSWORD:
            return True
        query = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
        token = self.headers.get("X-Auth") or query.get("k", "")
        return hmac.compare_digest(token.encode(), auth_token().encode())

    def client_address_text(self):
        # Behind Render's proxy the real address is the first X-Forwarded-For entry.
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def login(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            return self.send_error(413)
        try:
            password = str(json.loads(self.rfile.read(length) or b"{}").get("password", ""))
        except ValueError:
            return self.send_error(400)
        if not PASSWORD:
            return self.send_json({"token": ""})
        address = self.client_address_text()
        if too_many_fails(address):
            return self.send_json({"error": "Too many wrong tries. Wait 15 minutes and try again."}, 429)
        if not hmac.compare_digest(password.encode(), PASSWORD.encode()):
            too_many_fails(address, add=True)
            time.sleep(1)
            return self.send_json({"error": "Wrong password. Try again."}, 401)
        self.send_json({"token": auth_token()})

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
            meeting_join(room, peer)

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
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
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
    print(f"Storage: {STORE.name}")
    print("Password lock: on." if PASSWORD else "Password lock: off (set DU_MEET_PASSWORD to turn it on).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDU Meet stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
