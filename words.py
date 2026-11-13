"""Is this a real English word? Used by the Word chain game.

A local list (Webster's 2nd, public domain; words.txt next to this file) answers most words,
with the usual endings taken off (cats → cat, running → run, happier → happy). Anything it
doesn't know (newer words like "selfie") is checked once with the free Dictionary API and
the answer is remembered.
"""

import json
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TLS = ssl.create_default_context()
if Path("/etc/ssl/cert.pem").is_file():  # python.org builds on macOS have no root certificates
    TLS.load_verify_locations("/etc/ssl/cert.pem")

_words = None
_lock = threading.Lock()
_cache = {}


def _load():
    global _words
    with _lock:
        if _words is None:
            try:
                text = (Path(__file__).parent / "words.txt").read_text()
                _words = set(text.split())
            except OSError:
                _words = set()
    return _words


def _stems(w):
    """The word itself and what it could be with a common ending taken off."""
    out = {w}
    def add(stem, *extra):
        if len(stem) >= 2:
            out.add(stem)
            for e in extra:
                out.add(stem + e)
    for end in ("s", "es", "ed", "d", "ing", "er", "est", "ly", "ness", "ment", "ful", "less", "able", "al", "ish", "y", "en"):
        if w.endswith(end) and len(w) > len(end) + 1:
            stem = w[: -len(end)]
            add(stem, "e")
            if len(stem) > 2 and stem[-1] == stem[-2]:  # running → run
                add(stem[:-1])
            if stem.endswith("i"):  # cried → cry, happier → happy
                add(stem[:-1] + "y")
    if w.endswith("ies"):
        add(w[:-3] + "y")
    if w.endswith("ves"):  # wolves → wolf, knives → knife
        add(w[:-3] + "f", "e")
    return out


def _online(w):
    try:
        url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + urllib.parse.quote(w)
        req = urllib.request.Request(url, headers={"User-Agent": "du-meet-word-check"})
        with urllib.request.urlopen(req, timeout=4, context=TLS) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
            return isinstance(data, list) and len(data) > 0
    except urllib.error.HTTPError as e:
        return False if e.code == 404 else None
    except Exception:
        return None  # offline: don't know


def check(word):
    """True / False, or None when it couldn't be decided (no list and no internet)."""
    w = "".join(c for c in str(word).lower() if "a" <= c <= "z")[:30]
    if len(w) < 2:
        return False
    if w in _cache:
        return _cache[w]
    words = _load()
    if any(s in words for s in _stems(w)):
        return True
    ok = _online(w)
    if ok is not None:
        if len(_cache) > 5000:
            _cache.clear()
        _cache[w] = ok
    return ok
