#!/usr/bin/env python3
"""Pre-commit hook: block any staged file that contains one of YOUR real secret values (T-0252).

Pattern scanners (gitleaks, GitGuardian) guess what looks like a secret. This hook knows: it reads the
values in your local env files and the GitHub App private key, and fails if any appears in a staged file.
It never prints a value, only the variable name and the file. Without a local env file (for example in
CI) it does nothing; CI relies on gitleaks and GitGuardian.

Env files: $STOOD_SECRET_FILES (colon-separated) or ./.env and ~/.config/stood/.env.
"""

import os
import sys

# Public or non-sensitive settings: ids shown in docs, URLs of public services, flags and paths.
PUBLIC = {
    "APP_ENV",
    "DEMO_MODE",
    "PROVIDER_PAYPAL",
    "PAYPAL_BASE_URL",
    "STOOD_PLATFORM_ID",
    "STOOD_SANDBOX_PAYEE_ID",
    "RECONCILIATION_OWNER",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY_PATH",
    # T-0188: an installation id and a public repository name grant nothing without the App's private key.
    "GITHUB_APP_INSTALLATION_ID",
    "YARD_SANDBOX_REPOSITORY",
    # T-0159: Vercel team and project ids identify where the runner runs; they grant nothing without VERCEL_TOKEN.
    "VERCEL_TEAM_ID",
    "VERCEL_PROJECT_ID",
    "S3_BUCKET",
    "S3_PREFIX",
    # C4: the evidence bucket's name and endpoint locate it; its scoped key pair stays secret.
    "STOOD_EVIDENCE_S3_BUCKET",
    "STOOD_EVIDENCE_S3_ENDPOINT",
}
MIN_LENGTH = 12


def env_files() -> list[str]:
    configured = os.environ.get("STOOD_SECRET_FILES")
    paths = (
        configured.split(":")
        if configured
        else [".env", os.path.expanduser("~/.config/stood/.env")]
    )
    return [p for p in paths if os.path.isfile(p)]


def secrets() -> dict[str, str]:
    found: dict[str, str] = {}
    key_path = None
    for path in env_files():
        with open(path) as env_file:
            for raw in env_file:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, value = line.split("=", 1)
                value = value.strip().strip('"').strip("'")
                if name == "GITHUB_APP_PRIVATE_KEY_PATH" and value:
                    key_path = os.path.expanduser(value)
                if name not in PUBLIC and len(value) >= MIN_LENGTH:
                    found[value] = name
    if key_path and os.path.isfile(key_path):
        with open(key_path) as key_file:
            for raw in key_file:
                line = raw.strip()
                if len(line) >= 40 and not line.startswith("-----"):
                    found[line] = "GITHUB_APP_PRIVATE_KEY"
    return found


def main(paths: list[str]) -> int:
    values = secrets()
    if not values:
        return 0
    leaks = []
    for path in paths:
        try:
            with open(path, encoding="utf-8", errors="ignore") as staged:
                text = staged.read()
        except OSError:
            continue
        for value, name in values.items():
            if value in text:
                leaks.append(f"{path}: contains the value of {name}")
    for leak in sorted(set(leaks)):
        print(leak, file=sys.stderr)
    if leaks:
        print(
            "Remove the value and keep it in .env only. Values are never printed.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
