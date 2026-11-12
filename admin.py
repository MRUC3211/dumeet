"""DU Meet · the admin's switches and the server's own notes about itself.

  config     the admin's switches, kept in the store (collection "admin", doc "config"):
             maintenance, couple-only joining, Saathi on/off and hourly limits, hidden features,
             the spiciest card level, a banner for everyone, and a sign-in "epoch" that signs
             everyone out when it changes.
  logs       the last few hundred lines the server printed (errors from Gemini, push, storage…).
  stats      requests per hour and per area, and how many failed.
  audit      a timeline: joins, leaves, admin actions, maintenance, sign-outs.
  usage      per day: features opened (counted by the apps) and Saathi's AI calls.
"""

import collections
import io
import sys
import threading
import time

C = "admin"
DEFAULTS = {
    "maintenance": False, "maintenanceText": "DU Meet is getting an update. Back in a few minutes.",
    "coupleOnly": False, "couple": ["Uday", "Diya"],
    "saathiOn": True, "liveHourly": 40, "textHourly": 150,
    "hidden": [], "maxHeat": 3, "roundSize": 10, "roundBreak": 10,
    "banner": "", "bannerUntil": 0,
    "epoch": 0,
}
STARTED = time.time()


class Admin:
    def __init__(self, store):
        self.store = store
        self.lock = threading.Lock()
        self.config = dict(DEFAULTS)
        try:
            doc = store.get(C, "config")
            if doc and isinstance(doc.get("data"), dict):
                self.config.update({k: v for k, v in doc["data"].items() if k in DEFAULTS})
        except Exception as error:  # noqa: BLE001
            print(f"Admin config not loaded: {error}")
        self.logs = collections.deque(maxlen=400)
        self.audit_log = collections.deque(maxlen=400)
        self.hours = collections.OrderedDict()   # "YYYY-MM-DD HH" -> {"n", "err", "areas": {}}
        self.usage = {}                           # day -> {"features": {}, "ai": {}, "aiFail": {}}
        self.dirty = set()
        self._tee()
        threading.Thread(target=self._flush_loop, daemon=True).start()

    # ---------- switches ----------

    def public(self):
        """What every app needs to know (no secrets)."""
        c = self.config
        return {"maintenance": c["maintenance"], "maintenanceText": c["maintenanceText"], "hidden": c["hidden"],
                "maxHeat": c["maxHeat"], "saathiOn": c["saathiOn"],
                "roundSize": c["roundSize"], "roundBreak": c["roundBreak"],
                "banner": c["banner"] if c["banner"] and (not c["bannerUntil"] or c["bannerUntil"] > time.time()) else "",
                "epoch": c["epoch"]}

    def update(self, changes, who="Admin"):
        clean = {}
        for k, v in (changes or {}).items():
            if k not in DEFAULTS or k == "epoch":
                continue
            base = DEFAULTS[k]
            if isinstance(base, bool):
                clean[k] = bool(v)
            elif isinstance(base, int):
                try:
                    clean[k] = max(0, min(10**10 if k == "bannerUntil" else 100000, int(v)))
                except (TypeError, ValueError):
                    continue
            elif isinstance(base, list):
                clean[k] = [str(x)[:40] for x in (v or []) if str(x).strip()][:80]
            else:
                clean[k] = str(v or "")[:300]
        if "roundSize" in clean:
            clean["roundSize"] = max(3, min(50, clean["roundSize"]))
        if "roundBreak" in clean:
            clean["roundBreak"] = min(240, clean["roundBreak"])
        if "maxHeat" in clean:
            clean["maxHeat"] = max(1, min(3, clean["maxHeat"]))
        with self.lock:
            before = dict(self.config)
            self.config.update(clean)
            self._save()
        for k, v in clean.items():
            if before.get(k) != v:
                self.audit("admin", f"{who} changed {k}: {self._short(before.get(k))} → {self._short(v)}")
        return self.config

    def sign_out_everyone(self):
        with self.lock:
            self.config["epoch"] = int(self.config.get("epoch", 0)) + 1
            self._save()
        self.audit("security", "Everyone was signed out")
        return self.config["epoch"]

    def _save(self):
        try:
            self.store.put(C, "config", self.config)
        except Exception as error:  # noqa: BLE001
            print(f"Admin config not saved: {error}")

    @staticmethod
    def _short(v):
        text = ", ".join(map(str, v)) if isinstance(v, list) else str(v)
        return (text[:40] + "…") if len(text) > 40 else (text or "–")

    # ---------- server log: everything printed, kept in memory too ----------

    def _tee(self):
        admin = self

        class Tee(io.TextIOBase):
            def __init__(self, inner):
                self.inner, self.buf = inner, ""

            def write(self, s):
                self.inner.write(s)
                self.buf += s
                while "\n" in self.buf:
                    line, self.buf = self.buf.split("\n", 1)
                    if line.strip():
                        admin.logs.append({"at": time.time(), "text": line[:500]})
                return len(s)

            def flush(self):
                self.inner.flush()

        sys.stdout = Tee(sys.stdout)
        sys.stderr = Tee(sys.stderr)

    # ---------- request stats ----------

    def request(self, path, code):
        key = time.strftime("%Y-%m-%d %H", time.localtime())
        area = path.split("?")[0]
        area = "/api/ai" if area.startswith("/api/ai/") else "/api/media" if area.startswith("/api/media") else \
            "/api/admin" if area.startswith("/api/admin") else area if area.startswith("/api/") else "files"
        with self.lock:
            hour = self.hours.setdefault(key, {"n": 0, "err": 0, "areas": {}})
            hour["n"] += 1
            if code >= 400 and code != 401:
                hour["err"] += 1
            hour["areas"][area] = hour["areas"].get(area, 0) + 1
            while len(self.hours) > 48:
                self.hours.popitem(last=False)

    def stats(self):
        with self.lock:
            hours = [{"hour": k, **v} for k, v in self.hours.items()]
        areas = {}
        for h in hours:
            for a, n in h["areas"].items():
                areas[a] = areas.get(a, 0) + n
        return {"hours": hours[-24:], "areas": dict(sorted(areas.items(), key=lambda x: -x[1])),
                "total": sum(h["n"] for h in hours), "errors": sum(h["err"] for h in hours)}

    # ---------- activity timeline ----------

    def audit(self, kind, text):
        self.audit_log.append({"at": time.time(), "kind": kind, "text": str(text)[:300]})

    # ---------- usage per day ----------

    def _day(self, day=None):
        day = day or time.strftime("%Y-%m-%d", time.localtime())
        if day not in self.usage:
            data = {}
            try:
                doc = self.store.get(C, f"usage-{day}")
                data = (doc or {}).get("data") or {}
            except Exception:  # noqa: BLE001
                pass
            self.usage[day] = {"features": data.get("features", {}), "ai": data.get("ai", {}),
                               "aiFail": data.get("aiFail", {}), "people": data.get("people", {})}
            for old in sorted(self.usage)[:-3]:
                self.usage.pop(old, None)
        return day, self.usage[day]

    def count_features(self, name, counts):
        with self.lock:
            day, u = self._day()
            for k, n in (counts or {}).items():
                k = str(k)[:40]
                try:
                    n = max(0, min(500, int(n)))
                except (TypeError, ValueError):
                    continue
                if k and n:
                    u["features"][k] = u["features"].get(k, 0) + n
                    if name:
                        u["people"][name[:40]] = u["people"].get(name[:40], 0) + n
            self.dirty.add(day)

    def count_ai(self, action, ok):
        with self.lock:
            day, u = self._day()
            bucket = u["ai"] if ok else u["aiFail"]
            bucket[action] = bucket.get(action, 0) + 1
            self.dirty.add(day)

    def usage_days(self, days=14):
        out = []
        for i in range(days):
            day = time.strftime("%Y-%m-%d", time.localtime(time.time() - i * 86400))
            if day in self.usage:
                out.append({"day": day, **self.usage[day]})
                continue
            try:
                doc = self.store.get(C, f"usage-{day}")
            except Exception:  # noqa: BLE001
                doc = None
            if doc and doc.get("data"):
                out.append({"day": day, **doc["data"]})
        return out

    def _flush_loop(self):
        while True:
            time.sleep(60)
            with self.lock:
                days, self.dirty = self.dirty, set()
                snap = {d: dict(self.usage[d]) for d in days if d in self.usage}
            for day, data in snap.items():
                try:
                    self.store.put(C, f"usage-{day}", data)
                except Exception as error:  # noqa: BLE001
                    print(f"Usage not saved: {error}")
