#!/usr/bin/env python3
"""Pre-commit hook: block secret-looking values, even fake ones, before GitGuardian sees them.

GitGuardian's "Generic High Entropy Secret" detector flags any long, random-looking string given to a name like
key, secret, token or password (including `token=` in a URL), whatever words it contains: `xai-not-a-real-key-0000`
and a PayPal-shaped order token both raised incidents. A finding on a pushed commit stays in history, so it
must be stopped here. Test values must look fake to a machine: short (`'test-key'`), repetitive (`'s'.repeat(40)`)
or generated at run time (`randomBytes(32)`). Prints the file, line and name, never the value.

Opt out for one line only with a trailing `# realistic-secret-ok` / `// realistic-secret-ok` and a reason.
"""

import math
import re
import sys
from collections import Counter

NAME = r"(?:[A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth)[A-Za-z0-9_]*|key)"
# name: 'value' | name = "value" | [-e |export ]NAME_IN_ENV=value | scheme://user:password@ | ?token=value
ASSIGNED = re.compile(
    rf"""(?ix)
    (?:["']?\b(?P<name>{NAME})["']?\s*[:=]\s*["'`](?P<value>[^"'`\s]{{16,}})["'`])
    | (?:(?:^|\s)(?:-e\s+|export\s+)?(?P<env>[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)=(?P<envvalue>[^\s#]{{16,}}))
    | (?:://[^:/\s@]+:(?P<urlpass>[^@\s/]{{16,}})@)
    | (?:[?&](?P<param>token|key|secret|password|access_token)=(?P<paramvalue>[A-Za-z0-9._~%-]{{16,}}))
    """
)
MIN_ENTROPY = 3.0
OPT_OUT = "realistic-secret-ok"


def entropy(value: str) -> float:
    counts = Counter(value)
    return -sum(c / len(value) * math.log2(c / len(value)) for c in counts.values())


def suspicious(value: str) -> bool:
    # What GitGuardian's generic detector has flagged here: letters mixed with digits, and no long single-character
    # runs ('s'.repeat(40) passes), with enough randomness.
    mixed = re.search(r"[A-Za-z]", value) and re.search(r"[0-9]", value)
    return (
        bool(mixed)
        and entropy(value) >= MIN_ENTROPY
        and not re.search(r"(.)\1{7,}", value)
    )


def placeholder(value: str) -> bool:
    # Template references and obvious markers carry no secret: ${VAR}, <set>, {{ var }}, process.env.X.
    return bool(
        re.match(r"^(\$\{|\{\{|<|process\.env|env\.)", value)
    ) or value.startswith("$")


def findings(path: str, text: str):
    for number, line in enumerate(text.splitlines(), 1):
        if OPT_OUT in line:
            continue
        for match in ASSIGNED.finditer(line):
            name = (
                match.group("name")
                or match.group("env")
                or match.group("param")
                or ("URL password" if match.group("urlpass") else "")
            )
            value = (
                match.group("value")
                or match.group("envvalue")
                or match.group("paramvalue")
                or match.group("urlpass")
            )
            if placeholder(value) or "${" in value or not suspicious(value):
                continue
            yield f"{path}:{number}: {name} has a secret-looking value (make it short, repetitive or generated)"


def main(paths: list[str]) -> int:
    failed = False
    for path in paths:
        try:
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
        except (UnicodeDecodeError, OSError):
            continue
        for finding in findings(path, text):
            print(finding)
            failed = True
    if failed:
        print("GitGuardian would flag these. See docs/WAYS_OF_WORKING.md (secrets).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
