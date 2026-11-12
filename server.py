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
  GET/POST/DELETE /api/data      shared documents: calendar, songs, countdown; admin only: sessions, photos
  POST /api/admin/login, GET /api/admin/live   admin console (needs ADMIN_PASSWORD)
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
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import admin
import push
import saathi
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
MAX_FAILS = 4            # wrong passwords in a row from one address ...
LOCK_SECONDS = 30 * 60   # ... locks that address out for half an hour
fails = {}               # address -> times of recent wrong passwords
fails_lock = threading.Lock()


def auth_token():
    # the admin's "sign out everyone" bumps the epoch, which changes every token
    epoch = ADMIN.config.get("epoch", 0) if "ADMIN" in globals() else 0
    return hmac.new(PASSWORD.encode(), b"du-meet-login" + (f":{epoch}".encode() if epoch else b""), hashlib.sha256).hexdigest()


def lock_left(address, add=False):
    """Seconds this address is still locked out for (0 = may try). add=True records a wrong try."""
    now = time.monotonic()
    with fails_lock:
        recent = [t for t in fails.get(address, []) if now - t < LOCK_SECONDS]
        if add:
            recent.append(now)
        fails[address] = recent
        if len(recent) >= MAX_FAILS:
            return int(LOCK_SECONDS - (now - recent[-1])) + 1
        return 0


def tries_left(address):
    with fails_lock:
        return max(0, MAX_FAILS - len(fails.get(address, [])))


def clear_fails(address):
    with fails_lock:
        fails.pop(address, None)


def locked_addresses():
    now = time.monotonic()
    with fails_lock:
        return [{"address": a, "tries": len(t), "wait": int(LOCK_SECONDS - (now - t[-1])) + 1}
                for a, t in fails.items() if t and now - t[-1] < LOCK_SECONDS]


def device_name(agent):
    agent = agent or ""
    os_name = next((n for k, n in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"),
                                   ("Mac OS", "Mac"), ("Windows", "Windows"), ("Linux", "Linux")) if k in agent), "Device")
    browser = next((n for k, n in (("Edg/", "Edge"), ("CriOS", "Chrome"), ("Chrome/", "Chrome"),
                                   ("FxiOS", "Firefox"), ("Firefox/", "Firefox"), ("Safari/", "Safari")) if k in agent), "")
    return f"{os_name} · {browser}" if browser else os_name


def log_login(kind, ok, address, agent):
    """Every password attempt, for the admin console's Security tab."""
    try:
        STORE.put("logins", storage.new_id(), {"at": time.time(), "kind": kind, "ok": ok,
                                               "address": address, "device": device_name(agent)})
        ADMIN.audit("security", f"{'Opened' if ok else 'Wrong password'} ({kind}) · {device_name(agent)} · {address}")
    except Exception as error:  # noqa: BLE001 - logging must never block a login
        print(f"Could not log the login: {error}")


# ---- Admin console --------------------------------------------------------------
# A second password (ADMIN_PASSWORD) opens the admin console: meeting sessions with
# their chat, call stats and the photos taken with the camera button. Nobody else can
# read those, even with the site password.
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
ADMIN_COLLECTIONS = {"meetings", "snaps", "logins"}   # readable only with the admin token
CLIENT_WRITE_BLOCKED = {"meetings", "logins"}         # written only by the server


def admin_token():
    return hmac.new(ADMIN_PASSWORD.encode(), b"du-meet-admin", hashlib.sha256).hexdigest()


# ---- Shared data: calendar, saved songs, meeting history ----------------------------
STORE = storage.open_store()
ADMIN = admin.Admin(STORE)
RINGER = push.Ringer(STORE)
SAATHI = saathi.Saathi(STORE, TLS)
ALL_COLLECTIONS = ("meetings", "snaps", "logins", "calendar", "songs", "settings", "ai", "push", "admin")


def apply_limits():
    saathi.TOKENS.count = ADMIN.config["liveHourly"]
    saathi.TEXTS.count = ADMIN.config["textHourly"]


apply_limits()
last_ring = {}  # caller name -> time, so a ring can't be spammed
COLLECTIONS = {"calendar", "songs", "meetings", "snaps", "settings", "logins"}
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
        meeting = meetings.setdefault(room, {"start": now, "empty": None, "people": [], "chat": []})
        meeting["empty"] = None
        meeting["people"].append({"id": peer.id, "name": peer.name, "joined": now, "left": None})
    ADMIN.audit("call", f"{peer.name} joined {room}")


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
    ADMIN.audit("call", f"{peer.name} left {room}")


def meeting_chat(room, peer, data):
    """Keeps the session's chat so the admin console can show it after the call."""
    if not isinstance(data, dict):
        return
    text = str(data.get("text") or "")[:2000]
    media = [{"url": str(m.get("url", ""))[:200], "type": str(m.get("type", ""))[:80], "name": str(m.get("name", ""))[:120]}
             for m in (data.get("media") or [])[:10] if isinstance(m, dict)]
    if not text and not media:
        return
    with meetings_lock:
        meeting = meetings.get(room)
        if meeting and len(meeting["chat"]) < 3000:
            meeting["chat"].append({"name": peer.name, "text": text, "media": media, "at": time.time()})


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
                                                      "secs": secs, "people": people,
                                                      "chat": meeting.get("chat", [])})
        except Exception as error:  # noqa: BLE001 - history must never break a call
            print(f"Could not save meeting history: {error}")


def wrapped(month, tz_minutes):
    """One month of calls in numbers (totals only, no chats), for the monthly recap."""
    shift = -tz_minutes * 60  # browser's getTimezoneOffset is minutes behind UTC
    local = lambda t: time.gmtime(t + shift)  # noqa: E731
    calls, chats, per_person = [], 0, {}
    hours, weekdays = [0] * 24, [0] * 7
    days = set()
    for doc in STORE.list("meetings"):
        m = doc.get("data") or {}
        if not m.get("start") or len(m.get("people", [])) < 2:
            continue
        t = local(m["start"])
        if f"{t.tm_year:04d}-{t.tm_mon:02d}" != month:
            continue
        secs = int(m.get("secs", 0))
        calls.append(secs)
        days.add(t.tm_mday)
        hours[t.tm_hour] += secs
        weekdays[t.tm_wday] += secs
        chats += len(m.get("chat", []))
        for p in m.get("people", []):
            per_person[p.get("name", "?")] = per_person.get(p.get("name", "?"), 0) + int(p.get("secs", 0))
    streak = best = 0
    for day in range(1, 32):
        streak = streak + 1 if day in days else 0
        best = max(best, streak)
    photos = 0
    for doc in STORE.list("snaps"):
        at = (doc.get("data") or {}).get("at")
        if isinstance(at, (int, float)):
            t = local(at / 1000)
            photos += f"{t.tm_year:04d}-{t.tm_mon:02d}" == month
    return {"month": month, "secs": sum(calls), "calls": len(calls), "longest": max(calls, default=0),
            "days": sorted(days), "streak": best, "chats": chats, "photos": photos, "people": per_person,
            "topHour": hours.index(max(hours)) if any(hours) else None,
            "topWeekday": weekdays.index(max(weekdays)) if any(weekdays) else None}


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
            return self.send_json({"ok": True, "saathi": SAATHI.health()})
        if path == "/api/auth-info":
            # Lengths let the lock screens unlock as soon as the last character is typed.
            return self.send_json({"required": bool(PASSWORD), "admin": bool(ADMIN_PASSWORD),
                                   "len": len(PASSWORD), "adminLen": len(ADMIN_PASSWORD)})
        if not path.startswith("/api/"):
            return self.serve_file(unquote(path))  # the app's code is public; data is not
        if not self.logged_in():
            return self.send_error(401)
        try:
            if path == "/api/poll":
                self.poll(params)
            elif path == "/api/room":
                self.send_json({"names": [peer.name for peer in members(params.get("room", ""))]})
            elif path == "/api/wrapped":
                month = params.get("m", "")
                if len(month) != 7 or month[4] != "-" or not month.replace("-", "").isdigit():
                    return self.send_error(400)
                self.send_json(wrapped(month, int(params.get("tz", "0") or 0)))
            elif path == "/api/push/key":
                self.send_json({"key": RINGER.public_key()})
            elif path == "/api/ice":
                self.send_json({"iceServers": ice_servers()})
            elif path == "/api/features":
                self.send_json({"search": bool(YOUTUBE_API_KEY), "storage": STORE.name,
                                "persistent": STORE.name == "Supabase"})
            elif path == "/api/config":
                self.send_json(ADMIN.public())
            elif path.startswith("/api/admin/") and path != "/api/admin/live":
                if not self.is_admin():
                    return self.send_error(403)
                self.admin_get(path, params)
            elif path == "/api/admin/live":
                if not self.is_admin():
                    return self.send_error(403)
                with meetings_lock:
                    live = [{"room": room, "start": m["start"], "people": [dict(p) for p in m["people"]],
                             "chat": len(m["chat"])} for room, m in meetings.items()]
                self.send_json({"live": live, "now": time.time(), "locked": locked_addresses()})
            elif path == "/api/data":
                if params.get("c") not in COLLECTIONS:
                    return self.send_error(400)
                if params["c"] in ADMIN_COLLECTIONS and not self.is_admin():
                    return self.send_error(403)
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
                media_id = path.rsplit("/", 1)[1]
                if media_id.startswith("p") and not self.is_admin():
                    return self.send_error(403)
                self.send_media(media_id)
            else:
                self.send_error(404)
        except (urllib.error.URLError, OSError, ValueError) as error:
            print(f"Request failed ({path}): {error}")
            self.send_error(502)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            return self.login()
        if path == "/api/admin/login":
            return self.login(admin=True) if self.logged_in() else self.send_error(401)
        if path == "/api/push/latest":
            # Asked by the service worker, which has no login. It must prove it is a
            # subscribed device by sending its own (secret) push endpoint.
            length = int(self.headers.get("Content-Length") or 0)
            if length > 2000:
                return self.send_error(413)
            try:
                endpoint = str(json.loads(self.rfile.read(length) or b"{}").get("endpoint", ""))
            except ValueError:
                return self.send_error(400)
            return self.send_json(RINGER.latest(endpoint))
        if not self.logged_in():
            return self.send_error(401)
        length = int(self.headers.get("Content-Length") or 0)
        if path.startswith("/api/admin/"):
            return self.admin_action(path, length)
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
            if collection in CLIENT_WRITE_BLOCKED or (collection in ADMIN_COLLECTIONS and message.get("id")
                                                      and not self.is_admin()):
                return self.send_error(403)
            doc_id = str(message.get("id") or storage.new_id())[:64]
            try:
                return self.send_json({"doc": STORE.put(collection, doc_id, data)})
            except Exception as error:  # noqa: BLE001
                print(f"Storage error: {error}")
                return self.send_error(502)
        if path.startswith("/api/push/"):
            return self.push_action(path, message)
        if path == "/api/usage":                 # features opened, counted by the apps
            ADMIN.count_features(str(message.get("name", "")), message.get("counts") if isinstance(message.get("counts"), dict) else {})
            return self.send_json({"ok": True})
        if path.startswith("/api/ai/"):
            return self.ai_action(path, message)
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
            if kind == "chat":
                meeting_chat(room, peer, data)
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
            if params["c"] in ADMIN_COLLECTIONS and not self.is_admin():
                return self.send_error(403)
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
        # Photos from the camera button are private: only the admin can open them.
        media_id = ("p" if self.headers.get("X-Private") == "1" else "") + storage.new_id()
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

    def ai_action(self, path, message):
        """Saathi, the AI friend (see saathi.py). Errors come back as {"error": text}."""
        if path == "/api/ai/forget" and not self.is_admin():
            return self.send_json({"error": "Only Admin can wipe Hey Lord's memory"}, 403)
        action = path.rsplit("/", 1)[1]
        if not ADMIN.config["saathiOn"] and action not in ("state", "about", "consent"):
            return self.send_json({"error": "Hey Lord is switched off by Admin"}, 400)
        message = message if isinstance(message, dict) else {}
        if action == "cards" and "level" in message:   # never hotter than Admin allows
            try:
                message["level"] = max(1, min(int(ADMIN.config["maxHeat"]), int(message["level"])))
            except (TypeError, ValueError):
                message["level"] = 1
        try:
            result = saathi.handle(SAATHI, path, message, lambda name: bool(name.strip()))
            ADMIN.count_ai(action, True)
            return self.send_json(result)
        except ValueError as error:
            ADMIN.count_ai(action, False)
            return self.send_json({"error": str(error)}, 400)
        except (urllib.error.URLError, OSError) as error:
            ADMIN.count_ai(action, False)
            print(f"Saathi failed: {error}")
            return self.send_json({"error": "Couldn't reach Gemini, try again"}, 502)

    def push_action(self, path, message):
        try:
            if path == "/api/push/subscribe":
                name, endpoint = str(message.get("name", "")).strip(), str(message.get("endpoint", ""))
                if not name or not RINGER.subscribe(name, endpoint):
                    return self.send_error(400)
                return self.send_json({"ok": True})
            if path == "/api/push/unsubscribe":
                RINGER.unsubscribe(str(message.get("endpoint", "")))
                return self.send_json({"ok": True})
            if path == "/api/push/ring":
                caller = str(message.get("from", "")).strip()[:40]
                if not caller:
                    return self.send_error(400)
                if time.time() - last_ring.get(caller.lower(), 0) < 15:
                    return self.send_json({"sent": 0, "wait": True})
                last_ring[caller.lower()] = time.time()
                host = self.headers.get("Host", "du-meet.onrender.com")
                return self.send_json({"sent": RINGER.ring(caller, f"https://{host}")})
        except Exception as error:  # noqa: BLE001
            print(f"Push error: {error}")
            return self.send_error(502)
        return self.send_error(404)

    def admin_action(self, path, length):
        if not self.is_admin():
            return self.send_error(403)
        try:
            body = json.loads(self.rfile.read(min(length, 16384)) or b"{}")
        except ValueError:
            return self.send_error(400)
        if path == "/api/admin/unlock":          # forgive wrong passwords (all addresses)
            with fails_lock:
                fails.clear()
            ADMIN.audit("security", "Locked-out devices were let in")
            return self.send_json({"ok": True})
        handled = self.admin_post(path, body)
        if handled is not None:
            return handled
        if path == "/api/admin/end":            # end a live call for everyone in it
            room = str(body.get("room", ""))
            deliver(room, {"type": "end-call", "from": "admin", "data": {}})
            ADMIN.audit("admin", f"Ended the call in {room}")
            return self.send_json({"ok": True})
        if path == "/api/admin/clear":          # delete a whole collection (photos, sessions, log)
            collection = body.get("c")
            if collection not in ADMIN_COLLECTIONS:
                return self.send_error(400)
            try:
                for doc in STORE.list(collection):
                    STORE.delete(collection, doc["id"])
                    if collection == "snaps" and str(doc["data"].get("url", "")).startswith("/api/media/"):
                        STORE.delete_media(doc["data"]["url"].rsplit("/", 1)[1])
            except Exception as error:  # noqa: BLE001
                print(f"Storage error: {error}")
                return self.send_error(502)
            return self.send_json({"ok": True})
        return self.send_error(404)

    # ---- admin: what the console reads ----

    def admin_get(self, path, params):
        if path == "/api/admin/status":
            return self.send_json(self.server_status())
        if path == "/api/admin/config":
            return self.send_json({"config": ADMIN.config})
        if path == "/api/admin/logs":
            return self.send_json({"logs": list(ADMIN.logs)[-300:], "audit": list(ADMIN.audit_log)[-300:]})
        if path == "/api/admin/stats":
            return self.send_json({"requests": ADMIN.stats(), "usage": ADMIN.usage_days(14),
                                   "ai": {"liveUsed": len(saathi.TOKENS.times), "liveLimit": saathi.TOKENS.count,
                                          "textUsed": len(saathi.TEXTS.times), "textLimit": saathi.TEXTS.count}})
        if path == "/api/admin/peers":
            with lock:
                live = [{"room": room, "people": [{**p.info(), "idle": round(time.monotonic() - p.last_seen, 1),
                                                    "waiting": p.polls} for p in people.values()]}
                        for room, people in rooms.items()]
            return self.send_json({"rooms": live})
        if path == "/api/admin/push":
            subs = [{"id": d["id"], "name": d["data"].get("name", ""), "at": d["data"].get("at", 0),
                     "service": urlparse(d["data"].get("endpoint", "")).netloc} for d in RINGER.subscribers()]
            return self.send_json({"devices": subs})
        if path == "/api/admin/data":
            c = params.get("c", "")
            if c not in ALL_COLLECTIONS:
                return self.send_error(400)
            return self.send_json({"docs": [d for d in STORE.list(c) if not (c == "push" and d["id"] == "vapid")][:500]})
        if path == "/api/admin/export":
            out = {}
            for c in ALL_COLLECTIONS:
                try:
                    out[c] = [d for d in STORE.list(c) if not (c == "push" and d["id"] == "vapid")]
                except Exception as error:  # noqa: BLE001
                    out[c] = {"error": str(error)}
            ADMIN.audit("admin", "Exported all data")
            return self.send_json({"exported": time.time(), "data": out})
        return self.send_error(404)

    def server_status(self):
        import platform
        try:
            import resource
            mem = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            mem_mb = round(mem / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)
        except Exception:  # noqa: BLE001
            mem_mb = None
        counts = {}
        for c in ALL_COLLECTIONS:
            try:
                counts[c] = len([d for d in STORE.list(c) if not (c == "push" and d["id"] == "vapid")])
            except Exception:  # noqa: BLE001
                counts[c] = None
        with lock:
            room_count, peer_count = len(rooms), sum(len(p) for p in rooms.values())
        turn = "Cloudflare" if TURN_KEY_ID and TURN_API_TOKEN else "custom" if TURN_URLS and TURN_USERNAME else "off"
        return {
            "started": admin.STARTED, "now": time.time(), "uptime": int(time.time() - admin.STARTED),
            "commit": os.environ.get("RENDER_GIT_COMMIT", "")[:7], "service": os.environ.get("RENDER_SERVICE_NAME", ""),
            "python": platform.python_version(), "memoryMb": mem_mb, "threads": threading.active_count(),
            "storage": STORE.name, "persistent": STORE.name == "Supabase", "counts": counts,
            "turn": turn, "youtube": bool(YOUTUBE_API_KEY), "password": bool(PASSWORD),
            "gemini": SAATHI.health(), "liveModel": saathi.LIVE_MODEL, "textModel": saathi.TEXT_MODEL,
            "pushDevices": len(RINGER.subscribers()), "rooms": room_count, "peers": peer_count,
            "meetingGrace": MEETING_GRACE,
        }

    # ---- admin: what the console changes ----

    def admin_post(self, path, body):
        def peer_of(room, peer_id):
            return find(str(room or ""), str(peer_id or ""))
        if path == "/api/admin/config":
            config = ADMIN.update(body.get("changes") or {})
            apply_limits()
            self.broadcast({"do": "policy"})
            return self.send_json({"config": config})
        if path == "/api/admin/signout":
            ADMIN.sign_out_everyone()
            self.broadcast({"do": "reload"})
            return self.send_json({"ok": True})
        if path == "/api/admin/kick":            # take one person out of the call
            peer = peer_of(body.get("room"), body.get("id"))
            if not peer:
                return self.send_json({"error": "Not in the call any more"}, 404)
            deliver(body["room"], {"type": "end-call", "from": "admin", "data": {}}, to=peer.id)
            ADMIN.audit("admin", f"Took {peer.name} out of {body['room']}")
            return self.send_json({"ok": True})
        if path == "/api/admin/cmd":             # mute / camera off / reload / message, for one or all
            what = str(body.get("do", ""))
            if what not in ("mute", "camoff", "reload", "toast", "policy", "rounds"):
                return self.send_error(400)
            data = {"do": what, "text": str(body.get("text", ""))[:300]}
            if body.get("id"):
                peer = peer_of(body.get("room"), body.get("id"))
                if not peer:
                    return self.send_json({"error": "Not in the call any more"}, 404)
                deliver(body["room"], {"type": "admin-cmd", "from": "admin", "data": data}, to=peer.id)
                ADMIN.audit("admin", f"{what} → {peer.name}" + (f": {data['text']}" if data["text"] else ""))
            else:
                self.broadcast(data)
                ADMIN.audit("admin", f"{what} → everyone" + (f": {data['text']}" if data["text"] else ""))
            return self.send_json({"ok": True})
        if path == "/api/admin/ring":            # ring one person's phones
            name = str(body.get("name", "")).strip().lower()
            targets = [d for d in RINGER.subscribers() if d["data"].get("name", "").lower() == name]
            host = self.headers.get("Host", "du-meet.onrender.com")
            for doc in targets:
                with RINGER.lock:
                    RINGER.rings[doc["id"]] = {"from": "Admin", "at": time.time()}
                threading.Thread(target=RINGER._send, args=(doc, f"https://{host}"), daemon=True).start()
            ADMIN.audit("admin", f"Rang {body.get('name')} ({len(targets)} device{'s' if len(targets) != 1 else ''})")
            return self.send_json({"sent": len(targets)})
        if path == "/api/admin/del":             # delete one document from any collection
            c, doc_id = body.get("c"), str(body.get("id", ""))
            if c not in ALL_COLLECTIONS or not doc_id or (c == "push" and doc_id == "vapid") or (c == "admin" and doc_id == "config"):
                return self.send_error(400)
            try:
                STORE.delete(c, doc_id)
            except Exception as error:  # noqa: BLE001
                print(f"Storage error: {error}")
                return self.send_error(502)
            ADMIN.audit("admin", f"Deleted {c}/{doc_id}")
            return self.send_json({"ok": True})
        return None

    def broadcast(self, data):
        with lock:
            all_rooms = list(rooms)
        for room in all_rooms:
            deliver(room, {"type": "admin-cmd", "from": "admin", "data": data})

    def send_response(self, code, message=None):
        try:
            ADMIN.request(self.path, code)
        except Exception:  # noqa: BLE001 - stats must never break a reply
            pass
        super().send_response(code, message)

    def logged_in(self):
        if not PASSWORD:
            return True
        query = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
        token = self.headers.get("X-Auth") or query.get("k", "")
        return hmac.compare_digest(token.encode(), auth_token().encode())

    def is_admin(self):
        if not ADMIN_PASSWORD:
            return False
        query = {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}
        token = self.headers.get("X-Admin") or query.get("a", "")
        return hmac.compare_digest(token.encode(), admin_token().encode())

    def client_address_text(self):
        # Behind Render's proxy the real address is the first X-Forwarded-For entry.
        forwarded = self.headers.get("X-Forwarded-For", "")
        return forwarded.split(",")[0].strip() or self.client_address[0]

    def login(self, admin=False):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            return self.send_error(413)
        try:
            password = str(json.loads(self.rfile.read(length) or b"{}").get("password", ""))
        except ValueError:
            return self.send_error(400)
        secret = ADMIN_PASSWORD if admin else PASSWORD
        if not secret:
            if admin:
                return self.send_json({"error": "The admin console is off. Set ADMIN_PASSWORD on the server."}, 403)
            return self.send_json({"token": ""})
        address = ("admin:" if admin else "") + self.client_address_text()
        kind, agent = ("admin" if admin else "site"), self.headers.get("User-Agent", "")
        wait = lock_left(address)
        if wait:
            return self.send_json({"error": f"Too many wrong tries. Try again in {max(1, round(wait / 60))} min.",
                                   "wait": wait}, 429)
        if not hmac.compare_digest(password.encode(), secret.encode()):
            wait = lock_left(address, add=True)
            log_login(kind, False, self.client_address_text(), agent)
            time.sleep(1)
            if wait:
                return self.send_json({"error": "Too many wrong tries. Locked for 30 minutes.", "wait": wait}, 429)
            left = tries_left(address)
            return self.send_json({"error": f"Wrong password. {left} {'try' if left == 1 else 'tries'} left."}, 401)
        clear_fails(address)
        log_login(kind, True, self.client_address_text(), agent)
        self.send_json({"token": admin_token() if admin else auth_token()})

    def poll(self, params):
        room, peer_id = params.get("room", ""), params.get("id", "")
        if not room or not peer_id:
            return self.send_error(400)

        peer = find(room, peer_id)
        if peer is None:
            # First poll (or the tab was dropped while offline): join the room.
            name = params.get("name", "").strip()[:40] or "Guest"
            if ADMIN.config["maintenance"] and not self.is_admin():
                return self.send_json({"error": ADMIN.config["maintenanceText"]}, 503)
            if ADMIN.config["coupleOnly"] and name.lower() not in [n.lower() for n in ADMIN.config["couple"]]:
                ADMIN.audit("security", f"Blocked \"{name}\" from joining {room} (couple only)")
                return self.send_json({"error": "Only the two of you can join"}, 403)
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
