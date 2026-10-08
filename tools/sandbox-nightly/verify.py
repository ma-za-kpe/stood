#!/usr/bin/env python3
"""Check tonight's sandbox runs (T-0234): the newest vault-release must be CAPTURED and the newest
vault-refuse VOIDED, and the independent witness must see the same in PayPal. Exits non-zero otherwise."""

import glob
import json
import os
import subprocess
import sys

EXPECTED = {"vault-release": "CAPTURED", "vault-refuse": "VOIDED"}
WITNESS = os.path.join(os.path.dirname(__file__), "..", "paypal-witness", "witness.py")


def main(directory: str) -> int:
    failures = []
    for scenario, outcome in EXPECTED.items():
        files = sorted(glob.glob(os.path.join(directory, f"sandbox-{scenario}-*.json")))
        if not files:
            failures.append(f"{scenario}: no recording")
            continue
        with open(files[-1]) as f:
            recording = json.load(f)
        if recording.get("outcome") != outcome:
            failures.append(
                f"{scenario}: outcome {recording.get('outcome')}, expected {outcome}"
            )
            continue
        order = recording["steps"][0]["ids"].get("order")
        seen = subprocess.run(
            [sys.executable, WITNESS, "order", order],
            capture_output=True,
            text=True,
            check=False,
        )
        if seen.returncode != 0:
            failures.append(f"{scenario}: witness could not read order {order}")
            continue
        holds = json.loads(seen.stdout)["purchase_units"][0]["authorizations"]
        if [h["status"] for h in holds] != [outcome]:
            failures.append(
                f"{scenario}: PayPal shows {[h['status'] for h in holds]}, expected [{outcome}]"
            )
        else:
            print(f"{scenario}: {outcome} (order {order}), confirmed by the witness")
    for failure in failures:
        print(f"::error::{failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(
        main(
            sys.argv[1] if len(sys.argv) > 1 else "services/api/test/scenarios/sandbox"
        )
    )
