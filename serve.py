"""
Local static file + share-email server for Ultimate Texas Hold'em.

Serves the trainer on http://127.0.0.1:8765/ and POSTs to /api/send-email
using the same Gmail SMTP pattern as vegas-hotels (config.txt).

CLI: python serve.py
"""

from __future__ import annotations

import json
import logging
import os
import re
import smtplib
import ssl
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.txt"
HOST = os.environ.get("UTH_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("UTH_PORT") or "8765")

EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("uth-serve")


def load_config(path: Path = CONFIG_PATH) -> dict:
    """Same key: value config format as vegas-hotels. Env vars override file."""
    cfg = {}
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                key, value = [part.strip() for part in line.split(":", 1)]
                cfg[key.upper()] = value
    if os.environ.get("GMAIL_ADDRESS"):
        cfg["GMAIL_ADDRESS"] = os.environ["GMAIL_ADDRESS"].strip()
    if os.environ.get("GMAIL_APP_PASSWORD"):
        cfg["GMAIL_APP_PASSWORD"] = os.environ["GMAIL_APP_PASSWORD"].strip()
    return cfg


def send_email(to_email: str, subject: str, body: str, cfg: dict) -> None:
    """Send plain-text mail via Gmail SMTP (same as vegas-hotels)."""
    sender_email = cfg.get("GMAIL_ADDRESS", "")
    app_password = cfg.get("GMAIL_APP_PASSWORD", "")
    if not sender_email or not app_password:
        raise RuntimeError("Gmail credentials not configured in config.txt")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender_email
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls(context=ssl.create_default_context())
        server.login(sender_email, app_password)
        server.sendmail(sender_email, [to_email], msg.as_string())


class UTHHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _cors(self):
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Vary", "Origin")

    def _json(self, status: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.send_response(204)
            self._cors()
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/email-status":
            cfg = load_config()
            configured = bool(cfg.get("GMAIL_ADDRESS") and cfg.get("GMAIL_APP_PASSWORD"))
            self._json(
                200,
                {
                    "ok": True,
                    "configured": configured,
                    "transport": "gmail-smtp",
                },
            )
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/send-email":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 200_000:
            self._json(400, {"ok": False, "error": "Invalid body size."})
            return

        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "Expected JSON body."})
            return

        to_email = str(payload.get("to") or "").strip()
        subject = str(payload.get("subject") or "").strip()
        message = str(payload.get("message") or "").strip()

        if not to_email or not EMAIL_RE.match(to_email):
            self._json(400, {"ok": False, "error": "Invalid recipient email."})
            return
        if not subject:
            self._json(400, {"ok": False, "error": "Missing subject."})
            return
        if not message:
            self._json(400, {"ok": False, "error": "Missing message."})
            return

        cfg = load_config()
        if not cfg.get("GMAIL_ADDRESS") or not cfg.get("GMAIL_APP_PASSWORD"):
            self._json(
                503,
                {
                    "ok": False,
                    "error": "Gmail credentials not configured in config.txt",
                },
            )
            return

        try:
            send_email(to_email, subject, message, cfg)
        except smtplib.SMTPAuthenticationError as exc:
            log.error("SMTP auth failed: %s", exc)
            self._json(
                500,
                {
                    "ok": False,
                    "error": (
                        "Gmail authentication failed. Check GMAIL_ADDRESS / "
                        "GMAIL_APP_PASSWORD in config.txt (use an App Password, "
                        "not your normal password)."
                    ),
                },
            )
            return
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            log.error("Failed to send email: %s", exc)
            self._json(500, {"ok": False, "error": f"SMTP error: {exc}"})
            return
        except Exception as exc:
            log.error("Failed to send email: %s", exc)
            self._json(500, {"ok": False, "error": f"Failed to send email: {exc}"})
            return

        log.info("Share hand emailed to %s", to_email)
        self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)


def main() -> int:
    cfg = load_config()
    configured = bool(cfg.get("GMAIL_ADDRESS") and cfg.get("GMAIL_APP_PASSWORD"))
    try:
        server = ThreadingHTTPServer((HOST, PORT), UTHHandler)
    except OSError as exc:
        log.error(
            "Could not bind http://%s:%s/ (%s). Stop any other process on that port "
            "(e.g. python -m http.server) and run: python serve.py",
            HOST,
            PORT,
            exc,
        )
        return 1
    log.info("Serving Ultimate Texas Hold'em at http://%s:%s/", HOST, PORT)
    if configured:
        log.info("Share email: Gmail SMTP ready (config.txt)")
    else:
        log.warning(
            "Share email: copy config.example.txt to config.txt and add Gmail credentials"
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
