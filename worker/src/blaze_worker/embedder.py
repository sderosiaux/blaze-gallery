"""Embeds search queries for the app, whose serverless functions cannot run a model.

An HTTPS endpoint on the worker machine holding the text tower:

  GET  /health  -> {"ok": true, "model": ...}                    (no token)
  POST /embed   {"text": "..."} -> {"model": ..., "embedding": [...]}
                Authorization: Bearer <token>

TLS with a self-signed certificate the app pins (it trusts that certificate
only, not the system's CAs). The token is compared in constant time. Bodies
over MAX_BODY bytes, texts over MAX_TEXT characters and more than RATE
requests per second (BURST at once) are refused before the model runs.

It never touches the database: the app keeps the answers in
search_query_embeddings, so a query asked again costs no request, and the
embedder never wakes the Neon compute.
"""

from __future__ import annotations

import hmac
import json
import logging
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Protocol

import numpy as np

from .siglip import MODEL

log = logging.getLogger("blaze_worker")

MAX_BODY = 1024
MAX_TEXT = 200
RATE = 5.0
BURST = 20
# A client that sends its request slower than this is dropped
SOCKET_TIMEOUT = 5.0


class Tower(Protocol):
    def embed(self, text: str) -> np.ndarray: ...


class TokenBucket:
    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.at = time.monotonic()
        self.lock = threading.Lock()

    def take(self) -> bool:
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.at) * self.rate)
            self.at = now
            if self.tokens < 1:
                return False
            self.tokens -= 1
            return True


class EmbedderServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], tower: Tower, token: str) -> None:
        super().__init__(address, Handler)
        self.tower = tower
        self.token = token.encode()
        self.bucket = TokenBucket(RATE, BURST)
        # One query at a time on the tower: its threads are already parallel
        self.model_lock = threading.Lock()

    def authorized(self, header: str | None) -> bool:
        scheme, _, given = (header or "").partition(" ")
        # compare_digest on bytes: the time does not depend on where they differ
        return scheme == "Bearer" and hmac.compare_digest(given.strip().encode(), self.token)

    def embed(self, text: str) -> list[float]:
        with self.model_lock:
            return [round(float(v), 6) for v in self.tower.embed(text)]


class Handler(BaseHTTPRequestHandler):
    server: EmbedderServer
    protocol_version = "HTTP/1.1"
    timeout = SOCKET_TIMEOUT

    def log_message(self, format: str, *args: Any) -> None:
        # Request lines only: never the query text, never the token
        log.info("%s %s", self.address_string(), format % args)

    def reply(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.reply(200, {"ok": True, "model": MODEL})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/embed":
            self.reply(404, {"error": "not found"})
            return
        if not self.server.authorized(self.headers.get("Authorization")):
            self.reply(401, {"error": "unauthorized"})
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdigit():
            self.reply(411, {"error": "Content-Length required"})
            return
        if int(length) > MAX_BODY:
            self.reply(413, {"error": f"body over {MAX_BODY} bytes"})
            self.close_connection = True
            return
        if not self.server.bucket.take():
            self.reply(429, {"error": "too many requests"})
            return
        try:
            text = json.loads(self.rfile.read(int(length)))["text"]
        except (ValueError, KeyError, TypeError):
            self.reply(400, {"error": 'expected {"text": "..."}'})
            return
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            self.reply(400, {"error": f"text must be 1 to {MAX_TEXT} characters"})
            return
        began = time.perf_counter()
        embedding = self.server.embed(text)
        log.info("embedded %d chars in %.0f ms", len(text), (time.perf_counter() - began) * 1000)
        self.reply(200, {"model": MODEL, "embedding": embedding})


def serve(
    tower: Tower,
    token: str,
    port: int,
    cert: str | None,
    key: str | None,
    stopping: threading.Event,
    # In a container: Docker publishes the one port
    host: str = "0.0.0.0",
) -> None:
    server = EmbedderServer((host, port), tower, token)
    if cert and key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cert, key)
        # The handshake runs on the request's thread, under its timeout, not
        # in the accept loop where one slow client would hold up the others
        server.socket = context.wrap_socket(
            server.socket, server_side=True, do_handshake_on_connect=False
        )
    worker = threading.Thread(target=server.serve_forever, name="https", daemon=True)
    worker.start()
    log.info("serving %s on %s:%d (tls=%s)", MODEL, host, port, bool(cert))
    stopping.wait()
    server.shutdown()
    server.server_close()
