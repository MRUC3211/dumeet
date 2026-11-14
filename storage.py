"""Storage for the couple features: small JSON documents and media files.

Two backends with the same methods:

  SupabaseStore  when SUPABASE_URL and SUPABASE_SERVICE_KEY are set. Permanent: use
                 this on Render, whose own disk is wiped on every restart.
  FileStore      otherwise. Keeps everything in data/ next to server.py (fine on
                 the laptop, lost on Render restarts).

A document is {"id", "data", "created"} inside a collection ("diary", "calendar",
"letters", ...). Only the Python standard library is used.
"""

import json
import os
import secrets
import ssl

import cryptostore
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

TLS = ssl.create_default_context()
if Path("/etc/ssl/cert.pem").is_file():
    TLS.load_verify_locations("/etc/ssl/cert.pem")


def new_id():
    """Sortable by time, unique enough for two people."""
    return f"{int(time.time() * 1000):013d}-{secrets.token_hex(3)}"


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class FileStore:
    name = "local files (data/)"

    def __init__(self):
        self.lock = threading.Lock()
        self.file = DATA_DIR / "store.json"
        self.media = DATA_DIR / "media"
        self.media.mkdir(parents=True, exist_ok=True)
        try:
            self.docs = json.loads(self.file.read_text())
        except (OSError, ValueError):
            self.docs = {}

    def _save(self):
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.docs))
        tmp.replace(self.file)

    def list(self, collection):
        with self.lock:
            items = list(self.docs.get(collection, {}).values())
        return sorted(items, key=lambda doc: doc["id"], reverse=True)

    def get(self, collection, doc_id):
        with self.lock:
            return self.docs.get(collection, {}).get(doc_id)

    def put(self, collection, doc_id, data):
        with self.lock:
            docs = self.docs.setdefault(collection, {})
            old = docs.get(doc_id)
            doc = {"id": doc_id, "data": data, "created": old["created"] if old else now_iso()}
            docs[doc_id] = doc
            self._save()
        return doc

    def delete(self, collection, doc_id):
        with self.lock:
            self.docs.get(collection, {}).pop(doc_id, None)
            self._save()

    def put_media(self, media_id, body, content_type):
        sealed, store_type = cryptostore.seal(content_type, body)
        (self.media / media_id).write_bytes(sealed)
        (self.media / f"{media_id}.type").write_text(store_type)

    def get_media(self, media_id):
        file = self.media / media_id
        if not file.is_file():
            return None, None
        kind = (self.media / f"{media_id}.type")
        store_type = kind.read_text() if kind.is_file() else "application/octet-stream"
        return cryptostore.unseal(file.read_bytes(), store_type)

    def delete_media(self, media_id):
        for file in (self.media / media_id, self.media / f"{media_id}.type"):
            file.unlink(missing_ok=True)


class SupabaseStore:
    """Table "dumeet_docs" (see supabase.sql) and a private Storage bucket "dumeet-media"."""

    name = "Supabase"

    def __init__(self, url, key):
        self.url = url.rstrip("/")
        self.key = key

    def _request(self, method, path, body=None, headers=None, raw=False):
        request = urllib.request.Request(self.url + path, data=body, method=method)
        request.add_header("apikey", self.key)
        if self.key.startswith("eyJ"):  # legacy JWT key; new sb_secret_ keys go in apikey only
            request.add_header("Authorization", f"Bearer {self.key}")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        with urllib.request.urlopen(request, timeout=20, context=TLS) as response:
            data = response.read()
            if raw:
                return data, response.headers.get("Content-Type", "application/octet-stream")
            return json.loads(data) if data else None

    @staticmethod
    def _doc(row):
        return {"id": row["id"], "data": row["data"], "created": row["created_at"]}

    def list(self, collection):
        query = urllib.parse.urlencode({"collection": f"eq.{collection}", "order": "id.desc", "limit": "2000"})
        return [self._doc(row) for row in self._request("GET", f"/rest/v1/dumeet_docs?{query}")]

    def get(self, collection, doc_id):
        query = urllib.parse.urlencode({"collection": f"eq.{collection}", "id": f"eq.{doc_id}"})
        rows = self._request("GET", f"/rest/v1/dumeet_docs?{query}")
        return self._doc(rows[0]) if rows else None

    def put(self, collection, doc_id, data):
        body = json.dumps({"collection": collection, "id": doc_id, "data": data}).encode()
        rows = self._request("POST", "/rest/v1/dumeet_docs?on_conflict=collection,id", body, {
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        })
        return self._doc(rows[0])

    def delete(self, collection, doc_id):
        query = urllib.parse.urlencode({"collection": f"eq.{collection}", "id": f"eq.{doc_id}"})
        self._request("DELETE", f"/rest/v1/dumeet_docs?{query}")

    def put_media(self, media_id, body, content_type):
        sealed, store_type = cryptostore.seal(content_type, body)
        self._request("POST", f"/storage/v1/object/dumeet-media/{media_id}", sealed, {
            "Content-Type": store_type, "x-upsert": "true",
        })

    def get_media(self, media_id):
        try:
            body, store_type = self._request("GET", f"/storage/v1/object/dumeet-media/{media_id}", raw=True)
        except urllib.error.HTTPError:
            return None, None
        return cryptostore.unseal(body, store_type)

    def delete_media(self, media_id):
        try:
            self._request("DELETE", f"/storage/v1/object/dumeet-media/{media_id}")
        except urllib.error.HTTPError:
            pass


def open_store():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if url and key:
        return SupabaseStore(url, key)
    return FileStore()
