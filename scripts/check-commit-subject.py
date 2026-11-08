#!/usr/bin/env python3
"""Enforce this repo's commit-subject rules (see .gitmessage).

Used as a pre-commit `commit-msg` hook. Checks the subject line only:
Conventional Commits prefix, 72-character limit, imperative mood, and no
trailing period. Comment lines and an empty message are left to git.
"""
from __future__ import annotations

import re
import sys

MAX_LEN = 72
TYPES = (
    "feat", "fix", "docs", "refactor", "test",
    "chore", "perf", "ci", "build", "style", "revert",
)
PATTERN = re.compile(rf"^(?:{'|'.join(TYPES)})(?:\([\w.\-/ ]+\))?!?: .+")

# Past-tense / third-person openers that should be imperative instead.
NON_IMPERATIVE = re.compile(
    r"^(?:added|adds|fixed|fixes|updated|updates|removed|removes|"
    r"changed|changes|created|creates|bumped|bumps|renamed|renames|"
    r"refactored|refactors|documented|documents)\b",
    re.IGNORECASE,
)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-commit-subject.py <commit-msg-file>", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="utf-8") as fh:
        lines = [ln for ln in fh.read().splitlines() if not ln.startswith("#")]

    subject = lines[0].rstrip() if lines else ""
    if not subject:
        return 0  # empty message: git aborts the commit itself

    errors: list[str] = []

    if not PATTERN.match(subject):
        errors.append(
            "must start with a Conventional Commits type, e.g.\n"
            "    feat(chat): stream tokens over SSE\n"
            f"  valid types: {', '.join(TYPES)}"
        )
    if len(subject) > MAX_LEN:
        errors.append(f"is {len(subject)} characters; the limit is {MAX_LEN}")
    if subject.endswith("."):
        errors.append("must not end with a period")

    body = subject.split(": ", 1)[1] if ": " in subject else subject
    if NON_IMPERATIVE.match(body):
        first = body.split()[0]
        errors.append(f"use the imperative mood: {first!r} should be a command")

    if len(lines) > 1 and lines[1].strip():
        errors.append("needs a blank line between the subject and the body")

    if errors:
        print(f"\nInvalid commit subject:\n\n    {subject}\n", file=sys.stderr)
        for err in errors:
            print(f"  - Subject {err}", file=sys.stderr)
        print("\nSee .gitmessage for the full convention.\n", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
