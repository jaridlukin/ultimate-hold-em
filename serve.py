"""
Local static file + share-email + leaderboard server for Ultimate Texas Hold'em.

Serves the trainer on http://127.0.0.1:8765/, POSTs to /api/send-email
(Gmail SMTP via config.txt), and GET/POST /api/leaderboard (JSON file store).

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
import threading
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.txt"
LEADERBOARD_PATH = BASE_DIR / "data" / "leaderboard.json"
HOST = os.environ.get("UTH_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("UTH_PORT") or "8765")

EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)
# Arcade honor-system names: letters, numbers, spaces, _ - .
USERNAME_RE = re.compile(r"^[\w .'-]{1,24}$", re.UNICODE)
MAX_LEADERBOARD_ENTRIES = 200
LEADERBOARD_SORTS = ("bankroll", "accuracy", "hands")
_leaderboard_lock = threading.Lock()

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


def _empty_leaderboard() -> dict:
    return {"updatedAt": None, "entries": []}


def load_leaderboard() -> dict:
    """Load arcade leaderboard from local JSON (honor system; no auth)."""
    if not LEADERBOARD_PATH.is_file():
        return _empty_leaderboard()
    try:
        with LEADERBOARD_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read leaderboard: %s", exc)
        return _empty_leaderboard()
    if not isinstance(data, dict):
        return _empty_leaderboard()
    entries = data.get("entries")
    if not isinstance(entries, list):
        entries = []
    return {"updatedAt": data.get("updatedAt"), "entries": entries}


def save_leaderboard(data: dict) -> None:
    LEADERBOARD_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = LEADERBOARD_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(LEADERBOARD_PATH)


def sanitize_username(raw: object) -> str | None:
    if raw is None:
        return None
    name = " ".join(str(raw).strip().split())
    if not name or len(name) > 24:
        return None
    if not USERNAME_RE.match(name):
        return None
    return name


def normalize_score_payload(payload: dict) -> dict | None:
    """Clamp types for arcade upsert. Accuracy is 0–100 (same as trainer %)."""
    username = sanitize_username(payload.get("username"))
    if not username:
        return None
    try:
        bankroll = float(payload.get("bankroll"))
        accuracy = float(payload.get("accuracy"))
        hands = float(payload.get("hands"))
    except (TypeError, ValueError):
        return None
    if not all(n == n and abs(n) != float("inf") for n in (bankroll, accuracy, hands)):
        return None
    accuracy = max(0.0, min(100.0, accuracy))
    hands = max(0, int(hands))
    bankroll = max(-1_000_000, min(1_000_000, round(bankroll, 2)))
    return {
        "username": username,
        "bankroll": bankroll,
        "accuracy": round(accuracy, 2),
        "hands": hands,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def sort_entries(entries: list, sort_key: str) -> list:
    key = sort_key if sort_key in LEADERBOARD_SORTS else "bankroll"
    return sorted(
        entries,
        key=lambda e: (
            float(e.get(key) or 0),
            float(e.get("bankroll") or 0),
            float(e.get("hands") or 0),
        ),
        reverse=True,
    )


def upsert_leaderboard_entry(entry: dict) -> dict:
    """Upsert by case-insensitive username. Soft rate-limit: none (arcade)."""
    with _leaderboard_lock:
        data = load_leaderboard()
        entries = [e for e in data["entries"] if isinstance(e, dict)]
        uname_key = entry["username"].casefold()
        replaced = False
        for i, existing in enumerate(entries):
            if str(existing.get("username") or "").casefold() == uname_key:
                entries[i] = entry
                replaced = True
                break
        if not replaced:
            entries.append(entry)
        # Keep board bounded: prefer higher bankroll when trimming.
        entries = sort_entries(entries, "bankroll")[:MAX_LEADERBOARD_ENTRIES]
        data = {
            "updatedAt": entry["updatedAt"],
            "entries": entries,
        }
        save_leaderboard(data)
        return data


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
        parsed = urlparse(self.path)
        path = parsed.path
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
        if path == "/api/leaderboard":
            qs = parse_qs(parsed.query)
            sort_raw = (qs.get("sort") or ["bankroll"])[0].strip().lower()
            sort_key = sort_raw if sort_raw in LEADERBOARD_SORTS else "bankroll"
            limit_raw = (qs.get("limit") or ["10"])[0]
            try:
                limit = max(1, min(50, int(limit_raw)))
            except ValueError:
                limit = 10
            with _leaderboard_lock:
                data = load_leaderboard()
                entries = [e for e in data.get("entries") or [] if isinstance(e, dict)]
            ranked = sort_entries(entries, sort_key)[:limit]
            self._json(
                200,
                {
                    "ok": True,
                    "sort": sort_key,
                    "entries": ranked,
                },
            )
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/leaderboard":
            self._post_leaderboard()
            return
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

    def _post_leaderboard(self):
        # Soft rate-limit: arcade honor system; no auth. Cap body size only.
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > 8_000:
            self._json(400, {"ok": False, "error": "Invalid body size."})
            return
        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "Expected JSON body."})
            return
        if not isinstance(payload, dict):
            self._json(400, {"ok": False, "error": "Expected JSON object."})
            return
        entry = normalize_score_payload(payload)
        if not entry:
            self._json(
                400,
                {
                    "ok": False,
                    "error": (
                        "Invalid score. Need username (1–24 chars), bankroll, "
                        "accuracy 0–100, hands ≥ 0."
                    ),
                },
            )
            return
        try:
            upsert_leaderboard_entry(entry)
        except OSError as exc:
            log.error("Leaderboard write failed: %s", exc)
            self._json(500, {"ok": False, "error": "Could not save leaderboard."})
            return
        log.info(
            "Leaderboard upsert %s bankroll=%s accuracy=%s hands=%s",
            entry["username"],
            entry["bankroll"],
            entry["accuracy"],
            entry["hands"],
        )
        self._json(200, {"ok": True, "entry": entry})

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
    log.info("Leaderboard: GET/POST /api/leaderboard → %s", LEADERBOARD_PATH)
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
