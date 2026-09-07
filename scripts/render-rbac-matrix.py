#!/usr/bin/env python3
"""Regenerate the permission matrix in `docs/RBAC.md` from the code.

    backend/.venv/bin/python scripts/render-rbac-matrix.py
    backend/.venv/bin/python scripts/render-rbac-matrix.py --check

The matrix used to be typed out by hand, which made it a second description of
something the system already knows — and it was already wrong: `records.comment`
shipped with the task work page and never reached the table. So it is generated
from `core/auth.PERMISSION_GROUPS` and `ROLE_DEFAULTS`, the same two structures
the admin screen renders and `core/auth._permissions_for` enforces.

`--check` regenerates into memory and exits non-zero if the file on disk
differs, so CI can fail on a stale document instead of leaving somebody to
discover it six months later.

The generated block is delimited by HTML comments; everything outside them is
prose somebody wrote and this script must not touch.
"""

from __future__ import annotations

import argparse
import pathlib
import sys

# The catalogue lives in the backend package, and this script is one directory
# up from it — so the path is added here rather than left to the caller's cwd.
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

BEGIN = "<!-- generated:permission-matrix -->"
END = "<!-- /generated:permission-matrix -->"


def matrix() -> str:
    """The table, in the order the catalogue declares."""
    from src.core.auth import PERMISSION_GROUPS, ROLE_DEFAULTS

    roles = sorted(ROLE_DEFAULTS.items(), key=lambda item: -int(item[1]["rank"]))
    granted = {
        code: set(definition["permissions"]) for code, definition in roles
    }

    lines = [
        BEGIN,
        "",
        "| Permission | " + " | ".join(definition["name"] for _code, definition in roles) + " |",
        "| --- | " + " | ".join("---" for _ in roles) + " |",
    ]
    for area, permissions in PERMISSION_GROUPS.items():
        lines.append(f"| **{area}** | " + " | ".join("" for _ in roles) + " |")
        for code, label in permissions:
            marks = " | ".join(
                "✓" if code in granted[role_code] else "—" for role_code, _ in roles
            )
            lines.append(f"| `{code}` — {label} | {marks} |")
    lines.extend([
        "",
        f"*{sum(len(items) for items in PERMISSION_GROUPS.values())} permissions across "
        f"{len(PERMISSION_GROUPS)} areas, generated from `backend/src/core/auth.py` by "
        "`scripts/render-rbac-matrix.py`.*",
        "",
        END,
    ])
    return "\n".join(lines)


def rewrite(document: str, block: str) -> str:
    start = document.find(BEGIN)
    finish = document.find(END)
    if start < 0 or finish < 0:
        raise SystemExit(
            f"docs/RBAC.md has no generated block. Add {BEGIN} and {END} around the matrix."
        )
    return document[:start] + block + document[finish + len(END):]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="render-rbac-matrix")
    parser.add_argument("--check", action="store_true", help="fail if the file is stale")
    args = parser.parse_args(argv)

    target = pathlib.Path(__file__).resolve().parent.parent / "docs/RBAC.md"
    current = target.read_text()
    wanted = rewrite(current, matrix())

    if args.check:
        if current != wanted:
            print("docs/RBAC.md is behind the permission catalogue; run this without --check.")
            return 1
        print("docs/RBAC.md matches the permission catalogue")
        return 0

    target.write_text(wanted)
    print(f"docs/RBAC.md: matrix regenerated from the catalogue")
    return 0


if __name__ == "__main__":
    sys.exit(main())
