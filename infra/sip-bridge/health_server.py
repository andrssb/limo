#!/usr/bin/env python3
import datetime
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


PORT = int(os.environ.get("SIP_HEALTH_PORT", "8080"))


def run_asterisk(command: str) -> str:
    result = subprocess.run(
        ["asterisk", "-rx", command],
        capture_output=True,
        text=True,
        timeout=3,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("asterisk_unavailable")
    return result.stdout


def current_health() -> tuple[dict, int]:
    checked_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        registrations = run_asterisk("pjsip show registrations")
        registered = bool(re.search(r"vono-registration/.*\bRegistered\b", registrations))
        channels = run_asterisk("core show channels count")
        active_match = re.search(r"(\d+) active channel", channels)
        active_channels = int(active_match.group(1)) if active_match else 0
        payload = {
            "ok": registered,
            "registration": "Registered" if registered else "Offline",
            "active_channels": active_channels,
            "checked_at": checked_at,
        }
        return payload, 200 if registered else 503
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return {
            "ok": False,
            "registration": "Unavailable",
            "active_channels": None,
            "checked_at": checked_at,
        }, 503


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.rstrip("/") != "/health":
            self.send_response(404)
            self.end_headers()
            return
        payload, status = current_health()
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), HealthHandler).serve_forever()
