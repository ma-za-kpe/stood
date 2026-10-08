#!/usr/bin/env python3
"""Ask the real PayPal SANDBOX how it answers edge cases, so the simulator can match it (T-0222).

Usage: tools/paypal-probe/probe.py [.env]

Needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, STOOD_SANDBOX_PAYEE_ID and PAYPAL_SANDBOX_VAULT_TOKEN_ID
(from `scripts/dev sandbox-run vault-setup`). It places one 1.00 USD hold from the saved test buyer, tries
the edge cases against it, and voids it: no money is captured. It prints HTTP statuses and PayPal's error
names, issues and descriptions only, never keys, tokens or ids. Standard library only.
"""

import base64
import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api-m.sandbox.paypal.com"


def read_env(path):
    values = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if "=" in line and not line.startswith("#"):
                key, value = line.rstrip("\n").split("=", 1)
                values[key] = value.strip().strip('"')
    return values


def call(method, path, body=None, request_id=None, token=None):
    headers = {"Content-Type": "application/json", "Prefer": "return=representation"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if request_id:
        headers["PayPal-Request-Id"] = request_id
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        API + path, method=method, headers=headers, data=data
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as failure:
        raw = failure.read()
        return failure.code, json.loads(raw) if raw else {}


def show(label, status, body):
    issues = [(d.get("issue"), d.get("description")) for d in body.get("details", [])]
    links = [link.get("rel") for link in body.get("links", [])]
    print(
        f"{label}: HTTP {status} name={body.get('name')} status={body.get('status')} issues={issues} links={links}"
    )


def access_token(env):
    pair = f"{env['PAYPAL_CLIENT_ID']}:{env['PAYPAL_CLIENT_SECRET']}".encode()
    headers = {
        "Authorization": "Basic " + base64.b64encode(pair).decode(),
        "Content-Type": "application/x-www-form-urlencoded",
    }
    # The sandbox token endpoint sometimes refuses valid credentials; retrying moves no money.
    for _ in range(5):
        request = urllib.request.Request(
            API + "/v1/oauth2/token",
            data=b"grant_type=client_credentials",
            method="POST",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())["access_token"]
        except urllib.error.HTTPError:
            time.sleep(2)
    sys.exit("The sandbox refused a token five times; try again later.")


def main():
    env = read_env(sys.argv[1] if len(sys.argv) > 1 else ".env")
    if env.get("PAYPAL_BASE_URL", API) != API:
        sys.exit("This probe only runs against the PayPal sandbox API.")
    token = access_token(env)
    run = f"probe-{int(time.time())}"

    def order(key, vault_id):
        unit = {
            "reference_id": key,
            "invoice_id": key,
            "amount": {"currency_code": "USD", "value": "1.00"},
            "payee": {"merchant_id": env["STOOD_SANDBOX_PAYEE_ID"]},
        }
        return {
            "intent": "AUTHORIZE",
            "purchase_units": [unit],
            "payment_source": {"paypal": {"vault_id": vault_id}},
        }

    saved = env["PAYPAL_SANDBOX_VAULT_TOKEN_ID"]
    status, created = call(
        "POST", "/v2/checkout/orders", order(run, saved), f"{run}-create", token
    )
    show("saved-token order create", status, created)
    auth = created["purchase_units"][0]["payments"]["authorizations"][0]["id"]
    status, again = call(
        "POST",
        "/v2/checkout/orders",
        order(run + "-changed", saved),
        f"{run}-create",
        token,
    )
    show("same request id, different body", status, again)
    print("  same order returned:", again.get("id") == created["id"])
    base = f"/v2/payments/authorizations/{auth}"
    show(
        "reauthorize in honor period",
        *call("POST", f"{base}/reauthorize", {}, f"{run}-reauth", token),
    )
    over = {
        "amount": {"currency_code": "USD", "value": "2.00"},
        "final_capture": True,
        "invoice_id": run,
    }
    show(
        "capture more than held",
        *call("POST", f"{base}/capture", over, f"{run}-over", token),
    )
    show("void", *call("POST", f"{base}/void", None, f"{run}-void", token))
    show("void again", *call("POST", f"{base}/void", None, f"{run}-void-2", token))
    capture = {"final_capture": True, "invoice_id": run}
    show(
        "capture after void",
        *call("POST", f"{base}/capture", capture, f"{run}-capture", token),
    )
    show(
        "reauthorize after void",
        *call("POST", f"{base}/reauthorize", {}, f"{run}-reauth-2", token),
    )
    unknown = "/v2/payments/authorizations/NO-SUCH-AUTH/capture"
    show(
        "unknown authorization",
        *call("POST", unknown, capture, f"{run}-unknown", token),
    )
    show(
        "unknown order", *call("GET", "/v2/checkout/orders/NO-SUCH-ORDER", token=token)
    )
    bad = order(run + "-bad", "NO-SUCH-TOKEN")
    show(
        "unknown saved token",
        *call("POST", "/v2/checkout/orders", bad, f"{run}-bad-token", token),
    )
    show("final authorization", *call("GET", base, token=token))


if __name__ == "__main__":
    main()
