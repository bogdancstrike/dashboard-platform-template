"""The seeded report documents are documents the builder itself would accept."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.seed import report_documents as seed
from src.services import analysis
from src.services import report_documents as service


def _admin():
    return seed._principal(SimpleNamespace(id=uuid4(), username="admin", email="a@example.com",
                                           full_name="Ada", organization_id=None))


@pytest.mark.parametrize("entry", seed.DOCUMENTS, ids=[entry[1] for entry in seed.DOCUMENTS])
def test_every_seeded_document_passes_the_services_validation(entry):
    _owner, name, description, scope, cadence, entity, _accent, _rendered = entry
    principal = _admin()
    datasets = {d["key"]: d for d in analysis.catalogue(principal=principal)["datasets"]}
    assert entity in datasets
    report_id = str(uuid4())
    blocks = [{**b, "id": f"b{i}"} for i, b in enumerate(seed._blocks(entity, cadence, datasets, [report_id]))]
    fields = service._validated({"name": name, "description": description, "scope": scope, "blocks": blocks},
                                principal=principal, partial=False)
    kinds = [b["kind"] for b in fields["blocks"]]
    assert {"HEADING", "TEXT", "METRICS", "CHART", "TABLE", "REPORT"} <= set(kinds)
    assert len(kinds) <= service.MAX_BLOCKS
    # Every chart asks over the cadence the document is named for.
    periods = {b.get("period") for b in fields["blocks"] if b["kind"] == "CHART"}
    assert periods == {"last_7_days" if cadence == "weekly" else "last_30_days"}


def test_a_dimension_is_chosen_from_what_the_dataset_declares():
    datasets = {"x": {"dimensions": [{"name": "region"}, {"name": "status"}]}}
    assert seed._dimension(datasets, "x", "status") == "status"
    assert seed._dimension(datasets, "x", "nothing") == "region"
    assert seed._dimension(datasets, "missing", "status") is None


def test_the_folder_repair_gives_each_sibling_its_own_name():
    from datetime import UTC, datetime

    from src.seed import content

    parent = uuid4()
    when = datetime(2026, 1, 1, tzinfo=UTC)
    rows = [SimpleNamespace(id=uuid4(), parent_id=parent, name="2024", path="/archive/2024", created_at=when)
            for _ in range(3)] + [SimpleNamespace(id=uuid4(), parent_id=parent, name="2025", path="/archive/2025",
                                                  created_at=when)]

    class Session:
        def scalars(self, _statement):
            return rows

        def flush(self):
            pass

    assert content.dedupe_folders(Session()) == {"renamed": 2}
    names = [row.name for row in rows]
    assert len(set(names)) == 4 and names.count("2024") == 1
    assert all(row.path == f"/archive/{content.slugify(row.name)}" for row in rows)
