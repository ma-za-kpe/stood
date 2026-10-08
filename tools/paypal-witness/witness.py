#!/usr/bin/env python3
"""Read-only second witness for the PayPal SANDBOX (T-0246).

An independent check of what PayPal itself recorded, written separately from Stood's TypeScript SDK
adapter (Python standard library only), so a bug in one path cannot hide in both. It stands in for the
PayPal AI Toolkit MCP server while that server fails (paypal/AI-Toolkit#34). It only reads: it never
creates, captures, voids or refunds anything, and it prints ids, amounts and statuses only, never
names, emails or tokens.

Usage:
  witness.py order ORDER_ID
  witness.py transactions START_ISO END_ISO        (at most 31 days, PayPal's limit)
  witness.py disputes
Credentials: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from $STOOD_ENV_FILE or ~/.config/stood/.env.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api-m.sandbox.paypal.com"


def credentials() -> tuple[str, str]:
    path = os.environ.get("STOOD_ENV_FILE") or os.path.expanduser(
        "~/.config/stood/.env"
    )
    values: dict[str, str] = {}
    with open(path) as env_file:
        for raw in env_file:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if value or key not in values:
                    values[key] = value
    if values.get("PAYPAL_BASE_URL", BASE) != BASE:
        sys.exit("refused: sandbox only")
    if not values.get("PAYPAL_CLIENT_ID") or not values.get("PAYPAL_CLIENT_SECRET"):
        sys.exit("missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET")
    return values["PAYPAL_CLIENT_ID"], values["PAYPAL_CLIENT_SECRET"]


def request(path: str, token: str | None = None, data: bytes | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        cid, secret = credentials()
        headers["Authorization"] = (
            "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()
        )
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    # Reads are safe to retry; the sandbox token endpoint sometimes answers 401 to valid credentials.
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE + path, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as e:
            debug = e.headers.get("paypal-debug-id")
            if attempt == 2 or e.code not in (401, 429, 500, 502, 503):
                sys.exit(
                    f"PayPal HTTP {e.code} on {path.split('?')[0]} (debug id {debug})"
                )
            time.sleep(3 * (attempt + 1))
    raise AssertionError("unreachable")


def token() -> str:
    return request("/v1/oauth2/token", data=b"grant_type=client_credentials")[
        "access_token"
    ]


def money(m: dict | None) -> str | None:
    return f"{m.get('value')} {m.get('currency_code')}" if m else None


def order(order_id: str) -> dict:
    o = request(f"/v2/checkout/orders/{urllib.parse.quote(order_id)}", token())
    units = []
    for unit in o.get("purchase_units", []):
        payments = unit.get("payments", {})
        units.append(
            {
                "custom_id": unit.get("custom_id"),
                "amount": money(unit.get("amount")),
                "authorizations": [
                    {
                        "id": a.get("id"),
                        "status": a.get("status"),
                        "amount": money(a.get("amount")),
                    }
                    for a in payments.get("authorizations", [])
                ],
                "captures": [
                    {
                        "id": c.get("id"),
                        "status": c.get("status"),
                        "amount": money(c.get("amount")),
                        "invoice_id": c.get("invoice_id"),
                    }
                    for c in payments.get("captures", [])
                ],
            }
        )
    return {
        "order": o.get("id"),
        "status": o.get("status"),
        "intent": o.get("intent"),
        "purchase_units": units,
    }


def transactions(start: str, end: str) -> dict:
    t = token()
    found, page = [], 1
    while True:
        query = urllib.parse.urlencode(
            {
                "start_date": start,
                "end_date": end,
                "fields": "transaction_info",
                "page_size": 100,
                "page": page,
            }
        )
        body = request(f"/v1/reporting/transactions?{query}", t)
        for detail in body.get("transaction_details", []):
            info = detail.get("transaction_info", {})
            found.append(
                {
                    "id": info.get("transaction_id"),
                    "invoice_id": info.get("invoice_id"),
                    "amount": money(info.get("transaction_amount")),
                    "status": info.get("transaction_status"),
                    "event_code": info.get("transaction_event_code"),
                }
            )
        if page >= body.get("total_pages", 1) or page >= 100:
            return {"window": [start, end], "count": len(found), "transactions": found}
        page += 1


def disputes() -> dict:
    body = request("/v1/customer/disputes?page_size=50", token())
    items = body.get("items", [])
    return {
        "count": len(items),
        "disputes": [
            {
                "id": d.get("dispute_id"),
                "status": d.get("status"),
                "reason": d.get("reason"),
                "amount": money(d.get("dispute_amount")),
            }
            for d in items
        ],
    }


def main(argv: list[str]) -> None:
    commands = {
        "order": (order, 1),
        "transactions": (transactions, 2),
        "disputes": (disputes, 0),
    }
    if (
        len(argv) < 1
        or argv[0] not in commands
        or len(argv) - 1 != commands[argv[0]][1]
    ):
        sys.exit(__doc__)
    function, _ = commands[argv[0]]
    print(json.dumps(function(*argv[1:]), indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
