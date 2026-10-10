"""Tests for the no-local-secrets hook (T-0252). Run: python3 -m unittest discover tools/no-local-secrets"""

import os
import subprocess
import sys
import tempfile
import unittest

CHECK = os.path.join(os.path.dirname(__file__), "check.py")


def run(
    env_text: str, files: dict[str, str], key_text: str | None = None
) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as d:
        env = os.path.join(d, ".env")
        if key_text is not None:
            key = os.path.join(d, "app.pem")
            with open(key, "w") as f:
                f.write(key_text)
            env_text += f"\nGITHUB_APP_PRIVATE_KEY_PATH={key}\n"
        with open(env, "w") as f:
            f.write(env_text)
        paths = []
        for name, text in files.items():
            path = os.path.join(d, name)
            with open(path, "w") as f:
                f.write(text)
            paths.append(path)
        return subprocess.run(
            [sys.executable, CHECK, *paths],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "STOOD_SECRET_FILES": env},
        )


SECRET = "fakeSecretValueForTheHookTestOnlyxyz"
# Built at runtime so the repository never holds a literal private-key header (detect-private-key).
KIND = "RSA " + "PRIVATE" + " KEY"


class NoLocalSecrets(unittest.TestCase):
    def test_blocks_a_staged_file_containing_a_local_secret_and_never_prints_it(self):
        result = run(
            f"PAYPAL_CLIENT_SECRET={SECRET}\n", {"leak.ts": f"const s = '{SECRET}';"}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("PAYPAL_CLIENT_SECRET", result.stderr)
        self.assertNotIn(SECRET, result.stdout + result.stderr)

    def test_passes_clean_files_and_ignores_public_or_short_values(self):
        env = f"PAYPAL_CLIENT_SECRET={SECRET}\nSTOOD_SANDBOX_PAYEE_ID=NSBFV7E76WDQL\nAPP_ENV=local\n"
        result = run(env, {"ok.md": "Payee NSBFV7E76WDQL in local mode."})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_blocks_lines_of_the_github_app_private_key(self):
        body = "MIIEpAIBAAKCAQEAfakeprivatekeymaterialthatislongenough1234567890"
        key = f"-----BEGIN {KIND}-----\n{body}\n-----END {KIND}-----\n"
        result = run("", {"key.txt": f"oops {body}"}, key_text=key)
        self.assertEqual(result.returncode, 1)
        self.assertIn("GITHUB_APP_PRIVATE_KEY", result.stderr)

    def test_does_nothing_without_a_local_env_file(self):
        result = subprocess.run(
            [sys.executable, CHECK, CHECK],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "STOOD_SECRET_FILES": "/nonexistent/.env"},
        )
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
