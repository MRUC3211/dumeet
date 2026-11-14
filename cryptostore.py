"""At-rest encryption for the media that goes into the database (photos, recordings).

Goal: whatever lands in Supabase Storage (or the local data/ folder) is unreadable
without the key. Even if the storage bucket leaks, the files are useless ciphertext.
The key lives only on the server (an environment variable), so decryption happens on
the server when the admin (or, for a shared chat photo, either partner) opens the file
through the logged-in /api/media endpoint.

Only the Python standard library is used, so there is no AES primitive available. We
build authenticated encryption the textbook way instead:

  * HKDF-SHA256 turns the master secret into two independent 32-byte keys.
  * A counter-mode keystream from HMAC-SHA256(enc_key, nonce || counter) hides the data
    (a secure PRF used as a stream cipher).
  * encrypt-then-MAC with HMAC-SHA256(mac_key, magic || nonce || ciphertext) makes any
    tampering detectable; decryption refuses a file whose tag doesn't match.

A sealed blob is:  magic(4) | nonce(16) | ciphertext(len) | tag(32).
The content type is encrypted together with the bytes, so even the file kind never
leaks to the storage backend.

Key, in order of preference:
  DU_MEDIA_KEY         a dedicated secret you set on the server (recommended).
  ADMIN_PASSWORD +     fallback so media is still encrypted out of the box; if you ever
  DU_MEET_PASSWORD     change these, old media can no longer be decrypted, so set
                       DU_MEDIA_KEY once and leave it.
If none of these are set the data is stored as-is (no key, nothing to encrypt with).
"""

import hashlib
import hmac
import os
import struct

MAGIC = b"DUE1"          # marks a sealed blob, and is the HKDF salt
_BLOCK = 32              # HMAC-SHA256 output size
_TAG = 32


def _hkdf(secret: bytes, info: bytes, length: int = 32) -> bytes:
    """HKDF-SHA256 (RFC 5869): extract a pseudorandom key, then expand it."""
    prk = hmac.new(MAGIC, secret, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _load_key():
    secret = os.environ.get("DU_MEDIA_KEY", "").strip()
    source = "DU_MEDIA_KEY"
    if not secret:
        admin_pw = os.environ.get("ADMIN_PASSWORD", "")
        site_pw = os.environ.get("DU_MEET_PASSWORD", "")
        if admin_pw or site_pw:
            secret = "du-meet-media::" + admin_pw + "::" + site_pw
            source = "passwords"
    if not secret:
        return None, "off"
    master = secret.encode("utf-8")
    return {
        "enc": _hkdf(master, b"du-meet-media-enc-v1"),
        "mac": _hkdf(master, b"du-meet-media-mac-v1"),
    }, source


_KEYS, KEY_SOURCE = _load_key()


def enabled() -> bool:
    return _KEYS is not None


def _keystream(nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hmac.new(_KEYS["enc"], nonce + struct.pack(">Q", counter), hashlib.sha256).digest()
        counter += 1
    return bytes(out[:length])


def _xor(data: bytes, pad: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, pad))


def encrypt(plaintext: bytes) -> bytes:
    nonce = os.urandom(16)
    ciphertext = _xor(plaintext, _keystream(nonce, len(plaintext)))
    tag = hmac.new(_KEYS["mac"], MAGIC + nonce + ciphertext, hashlib.sha256).digest()
    return MAGIC + nonce + ciphertext + tag


def decrypt(blob: bytes) -> bytes:
    if len(blob) < len(MAGIC) + 16 + _TAG or not blob.startswith(MAGIC):
        raise ValueError("not a sealed blob")
    nonce = blob[4:20]
    ciphertext = blob[20:-_TAG]
    tag = blob[-_TAG:]
    expected = hmac.new(_KEYS["mac"], MAGIC + nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected):
        raise ValueError("media failed its integrity check (wrong key or tampered)")
    return _xor(ciphertext, _keystream(nonce, len(ciphertext)))


def is_sealed(blob) -> bool:
    return isinstance(blob, (bytes, bytearray)) and bytes(blob[:4]) == MAGIC


# ---- what the stores call: the content type travels inside the ciphertext ----

STORE_TYPE = "application/octet-stream"


def seal(content_type: str, body: bytes):
    """Return (bytes_to_store, type_to_store). When encryption is off, passes through."""
    if not enabled():
        return body, content_type
    header = (content_type or STORE_TYPE).encode("utf-8")[:255]
    packed = struct.pack(">H", len(header)) + header + body
    return encrypt(packed), STORE_TYPE


def unseal(stored: bytes, stored_type: str):
    """Return (body, content_type). Plain (pre-encryption) files pass straight through."""
    if not is_sealed(stored):
        return stored, stored_type
    packed = decrypt(stored)
    (hlen,) = struct.unpack(">H", packed[:2])
    content_type = packed[2:2 + hlen].decode("utf-8", "replace") or STORE_TYPE
    return packed[2 + hlen:], content_type
