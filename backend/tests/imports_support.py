"""Shared helpers and fixtures for the imports tests."""

from __future__ import annotations

import csv
import io

import pytest

from src.config import Config
from src.core import background
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


IMPORTS = f"{PREFIX}/imports"


#: The dataset these tests import into. `customer` because its writable set
#: includes an enum with a closed vocabulary, a foreign key, a number with
#: bounds and a date — which is what makes the validation assertions worth
#: making — and because exactly one of its fields is required, so "what is
#: still unmapped" has an unambiguous answer.
TARGET = "customer"


#: The enum whose vocabulary a bad value has to violate. `country` is free
#: text on this dataset, which is why the first version of these tests
#: "passed" a value like `NOT-A-COUNTRY` — it was genuinely valid.
ENUM_FIELD = "segment"


ENUM_BAD = "NOT-A-SEGMENT"


def _authenticate(monkeypatch, username: str = "manager", role: str = "manager"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"imp-{username}"),
    )
    return {"Authorization": f"Bearer imp-{username}"}


def _required(client, headers) -> list[str]:
    """Which fields the target insists on, from the API rather than a guess."""
    catalogue = client.get(f"{IMPORTS}/catalogue", headers=headers).get_json()
    target = next(item for item in catalogue["targets"] if item["key"] == TARGET)
    return target["required"]


def _csv(rows: list[dict[str, str]], *, delimiter: str = ",", bom: bool = False) -> str:
    """A file the way a spreadsheet would have written it."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]), delimiter=delimiter)
    writer.writeheader()
    writer.writerows(rows)
    return ("﻿" if bom else "") + buffer.getvalue()


def _begin(client, headers, content: str, **payload):
    body = {"target_entity": TARGET, "filename": "customers.csv", "content": content, **payload}
    return client.post(IMPORTS, json=body, headers=headers)


def _discard(client, headers, import_id: str) -> None:
    """Let a run go entirely, through the endpoint a person uses.

    Twice, because `discard` takes two presses — the file, then the record —
    and a sweep that pressed once would leave a cancelled run behind for every
    test in this module. The same shape `/exports` and `e2e/api.sweepMailThreads`
    use.
    """
    client.delete(f"{IMPORTS}/{import_id}", headers=headers)
    client.delete(f"{IMPORTS}/{import_id}", headers=headers)


def _rows(count: int = 3, **overrides) -> list[dict[str, str]]:
    """Valid customer rows, named so a test's own records are recognisable."""
    return [
        {
            "name": f"Import Test Customer {index}",
            "email": f"import-test-{index}@example.test",
            "segment": "SMB",
            **overrides,
        }
        for index in range(1, count + 1)
    ]


def _execute(client, headers, import_id: str):
    """Run an import and wait for it by not needing to."""
    with background.synchronous():
        return client.post(f"{IMPORTS}/{import_id}/execute", headers=headers)
