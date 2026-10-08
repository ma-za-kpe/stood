#!/usr/bin/env python3
"""Mint a PayPal SANDBOX access token for the PayPal AI Toolkit MCP server and store it in
~/.claude/settings.json (env.PAYPAL_SANDBOX_ACCESS_TOKEN). Never prints the token.
Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from ~/.config/stood/.env. See docs/SETUP.md (section 8); install with tools/paypal-mcp-token/README.md."""
import base64, json, os, sys, tempfile, time, urllib.parse, urllib.request

ENV = os.path.expanduser('~/.config/stood/.env')
SETTINGS = os.path.expanduser('~/.claude/settings.json')
LOG = os.path.expanduser('~/.config/stood/paypal-mcp-token.log')

def log(msg):
    with open(LOG, 'a') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')

values = {}
for line in open(ENV):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        v = v.strip().strip('"').strip("'")
        if v or k not in values: values[k] = v
base = values.get('PAYPAL_BASE_URL') or 'https://api-m.sandbox.paypal.com'
if 'sandbox' not in base:
    log('refused: PAYPAL_BASE_URL is not the sandbox'); sys.exit(2)
cid, secret = values.get('PAYPAL_CLIENT_ID'), values.get('PAYPAL_CLIENT_SECRET')
if not cid or not secret:
    log('missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET'); sys.exit(2)
req = urllib.request.Request(base + '/v1/oauth2/token',
    data=urllib.parse.urlencode({'grant_type': 'client_credentials'}).encode(),
    headers={'Authorization': 'Basic ' + base64.b64encode(f'{cid}:{secret}'.encode()).decode(),
             'Content-Type': 'application/x-www-form-urlencoded'})
try:
    body = json.load(urllib.request.urlopen(req, timeout=30))
except Exception as e:
    log(f'token request failed: {getattr(e, "code", type(e).__name__)}'); sys.exit(1)
token = body['access_token']
settings = json.load(open(SETTINGS)) if os.path.exists(SETTINGS) else {}
settings.setdefault('env', {})['PAYPAL_SANDBOX_ACCESS_TOKEN'] = token
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(SETTINGS))
with os.fdopen(fd, 'w') as f:
    json.dump(settings, f, indent=2); f.write('\n')
os.chmod(tmp, 0o600); os.replace(tmp, SETTINGS)
log(f'refreshed; expires in {body.get("expires_in")} s. Restart Claude Code (or /paypal:setup refresh) to load it.')
