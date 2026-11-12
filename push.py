"""DU Meet · "Call me" ring through Web Push, with only the Python standard library.

The push carries no payload, so nothing has to be encrypted: the phone wakes up, its
service worker asks /api/push/latest who rang, and shows the notification. All that is
needed is a VAPID signature (ES256 on the P-256 curve), done here in plain Python.

Subscriptions live in the store under the server-only collection "push" (the browser
can't list them), together with the VAPID key, so the key survives restarts.
"""

import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

# ---- P-256 ----------------------------------------------------------------------
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def _mul(k, point=G):
    result = None
    while k:
        if k & 1:
            result = _add(result, point)
        point = _add(point, point)
        k >>= 1
    return result


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _sign(d, message):
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = _mul(k)[0] % N
        s = pow(k, -1, N) * (z + r * d) % N
        if r and s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


# ---- push services we are willing to call (no requests to arbitrary hosts) ---------
PUSH_HOSTS = ("fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com")


def allowed_endpoint(endpoint):
    try:
        url = urlparse(endpoint)
    except ValueError:
        return False
    host = url.hostname or ""
    return url.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def sub_id(endpoint):
    return hashlib.sha256(endpoint.encode()).hexdigest()[:32]


class Ringer:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()
        self.rings = {}       # subscription id -> {"from", "at"}
        self.jwts = {}        # audience -> (token, expires)
        self._key = None

    def key(self):
        with self.lock:
            if self._key is None:
                doc = None
                try:
                    doc = self.store.get("push", "vapid")
                except Exception:  # noqa: BLE001
                    pass
                d = int(doc["data"]["d"], 16) if doc and doc.get("data", {}).get("d") else None
                if d is None:
                    d = secrets.randbelow(N - 1) + 1
                    self.store.put("push", "vapid", {"d": format(d, "x")})
                x, y = _mul(d)
                self._key = (d, b"\x04" + x.to_bytes(32, "big") + y.to_bytes(32, "big"))
            return self._key

    def public_key(self):
        return _b64(self.key()[1])

    def _jwt(self, audience, contact):
        token, expires = self.jwts.get(audience, ("", 0))
        if expires - time.time() > 600:
            return token
        expires = int(time.time()) + 12 * 3600
        head = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
        body = _b64(json.dumps({"aud": audience, "exp": expires, "sub": contact}).encode())
        signed = f"{head}.{body}"
        token = f"{signed}.{_b64(_sign(self.key()[0], signed.encode()))}"
        self.jwts[audience] = (token, expires)
        return token

    def subscribe(self, name, endpoint):
        if not allowed_endpoint(endpoint):
            return False
        self.store.put("push", sub_id(endpoint), {"name": name[:40], "endpoint": endpoint, "at": int(time.time())})
        return True

    def unsubscribe(self, endpoint):
        self.store.delete("push", sub_id(endpoint))

    def subscribers(self):
        return [doc for doc in self.store.list("push") if doc["id"] != "vapid" and doc.get("data", {}).get("endpoint")]

    def ring(self, caller, contact):
        """Ring every device of everyone except the caller. Returns how many were sent."""
        targets = [doc for doc in self.subscribers() if doc["data"].get("name", "").lower() != caller.lower()]
        for doc in targets:
            with self.lock:
                self.rings[doc["id"]] = {"from": caller, "at": time.time()}
            threading.Thread(target=self._send, args=(doc, contact), daemon=True).start()
        return len(targets)

    def _send(self, doc, contact):
        endpoint = doc["data"]["endpoint"]
        if not allowed_endpoint(endpoint):
            return
        url = urlparse(endpoint)
        audience = f"{url.scheme}://{url.netloc}"
        request = urllib.request.Request(endpoint, data=b"", method="POST", headers={
            "TTL": "90", "Urgency": "high", "Content-Length": "0",
            "Authorization": f"vapid t={self._jwt(audience, contact)}, k={self.public_key()}",
        })
        try:
            urllib.request.urlopen(request, timeout=10).close()
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):          # the phone dropped this subscription
                self.store.delete("push", doc["id"])
            else:
                print(f"Push failed ({error.code}): {error.read()[:200]!r}")
        except (urllib.error.URLError, OSError) as error:
            print(f"Push failed: {error}")

    def latest(self, endpoint):
        """Who rang this device in the last 2 minutes (asked by the service worker)."""
        with self.lock:
            ring = self.rings.get(sub_id(endpoint))
        if ring and time.time() - ring["at"] < 120:
            return {"from": ring["from"], "at": ring["at"]}
        return {}
