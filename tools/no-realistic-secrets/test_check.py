import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import check

# Built from parts so this file never holds a literal the check (or GitGuardian) would flag.
MIXED = "xai-not-a-real-key-" + "0" * 3 + "7"
ORDER = "5O1901" + "27TN364715T"


def flagged(text: str) -> list[str]:
    return list(check.findings("f.ts", text))


class NoRealisticSecrets(unittest.TestCase):
    def test_flags_the_values_gitguardian_raised_incidents_for(self):
        self.assertEqual(len(flagged(f"GROK_PLANNER_API_KEY: '{MIXED}',")), 1)
        self.assertEqual(
            len(
                flagged(
                    f"const link = 'https://www.sandbox.paypal.com/checkoutnow?token={ORDER}';"
                )
            ),
            1,
        )

    def test_flags_env_lines_docker_flags_and_url_passwords(self):
        value = "runtime_password_" + "0123456789"
        self.assertEqual(len(flagged(f"STOOD_HMAC_SECRET={value}")), 1)
        self.assertEqual(len(flagged(f"  -e YARD_RUNTIME_PASSWORD={value} \\")), 1)
        self.assertEqual(
            len(flagged(f"DATABASE_URL=postgres://user:{value}@db:5432/x")), 1
        )

    def test_passes_values_that_look_fake_to_a_machine(self):
        for line in [
            "secret: 'xai-test-key',",
            "secret: 'sim-stood-webhook-secret',",
            "STOOD_HMAC_SECRET: 'h'.repeat(40)",
            "password: 'runtime_password_xxxxxxxxxx'",
            "YARD_SECRET_KEYS: `k1:${randomBytes(32).toString('base64')}`",
            "'Idempotency-Key': `nudge-${randomUUID()}`",
            "STOOD_API_KEY=${STOOD_API_KEY}",
            f"secret: '{MIXED}', // realistic-secret-ok: documented example",
        ]:
            self.assertEqual(flagged(line), [], line)

    def test_names_the_file_line_and_variable_but_never_the_value(self):
        with tempfile.NamedTemporaryFile("w", suffix=".ts", delete=False) as handle:
            handle.write(f"ok\nconst config = {{ apiKey: '{MIXED}' }};\n")
        try:
            result = subprocess.run(
                [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "check.py"),
                    handle.name,
                ],
                capture_output=True,
                check=False,
                text=True,
            )
        finally:
            os.unlink(handle.name)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f"{handle.name}:2: apiKey", result.stdout)
        self.assertNotIn(MIXED, result.stdout)


if __name__ == "__main__":
    unittest.main()
