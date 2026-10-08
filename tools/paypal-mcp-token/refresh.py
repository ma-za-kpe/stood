#!/usr/bin/env python3
"""Mint a PayPal SANDBOX access token for the PayPal AI Toolkit MCP server and store it in
~/.claude/settings.json (env.PAYPAL_SANDBOX_ACCESS_TOKEN). Never prints the token.
Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from ~/.config/stood/.env. See docs/SETUP.md (section 8); install with tools/paypal-mcp-token/README.md."""

import base64
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ENV = os.path.expanduser("~/.config/stood/.env")
SETTINGS = os.path.expanduser("~/.claude/settings.json")
LOG = os.path.expanduser("~/.config/stood/paypal-mcp-token.log")


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")


values = {}
with open(ENV) as env_file:
    for raw in env_file:
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if v or k not in values:  # a later empty duplicate never erases a value
                values[k] = v
base = values.get("PAYPAL_BASE_URL") or "https://api-m.sandbox.paypal.com"
# Exactly the sandbox API host: not the live API, and not the sandbox website (sandbox.paypal.com).
if base.rstrip("/") != "https://api-m.sandbox.paypal.com":
    log("refused: PAYPAL_BASE_URL must be https://api-m.sandbox.paypal.com")
    sys.exit(2)
base = "https://api-m.sandbox.paypal.com"
cid, secret = values.get("PAYPAL_CLIENT_ID"), values.get("PAYPAL_CLIENT_SECRET")
if not cid or not secret:
    log("missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET")
    sys.exit(2)
req = urllib.request.Request(
    base + "/v1/oauth2/token",
    data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
    headers={
        "Authorization": "Basic "
        + base64.b64encode(f"{cid}:{secret}".encode()).decode(),
        "Content-Type": "application/x-www-form-urlencoded",
    },
)
# Minting a token moves no money, so retrying is safe. The sandbox token endpoint
# sometimes answers 401 to valid credentials and succeeds seconds later (seen 2026-10-08).
body = None
for attempt, pause in enumerate((5, 15, 0), start=1):
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = json.load(response)
        break
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        debug = (
            e.headers.get("paypal-debug-id")
            if isinstance(e, urllib.error.HTTPError)
            else None
        )
        log(
            f"attempt {attempt} failed: {getattr(e, 'code', type(e).__name__)} (debug id {debug})"
        )
        time.sleep(pause)
if body is None:
    sys.exit(1)
token = body["access_token"]
settings = {}
if os.path.exists(SETTINGS):
    with open(SETTINGS) as settings_file:
        settings = json.load(settings_file)
settings.setdefault("env", {})["PAYPAL_SANDBOX_ACCESS_TOKEN"] = token
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(SETTINGS))
with os.fdopen(fd, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
os.chmod(tmp, 0o600)
os.replace(tmp, SETTINGS)
log(
    f"refreshed; expires in {body.get('expires_in')} s. Restart Claude Code (or /paypal:setup refresh) to load it."
)
