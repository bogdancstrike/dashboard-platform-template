"""What a described filter turns into, whatever shape the model's tree arrives in.

The model writes a condition tree; `ai_filters.normalise` is what stops a
plausible-looking but wrong tree from becoming a query. These pin its handling
of the shapes a model actually produces — groups nested past the limit,
conjunction spellings, children as a list, empty groups, "me" as a person,
a literal id, a reference into a dataset the reader may not see, too many
rules — and the endpoint choosing a dataset when asked to, or falling back to
the words when the model's answer is unusable. No real model is called.
"""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from src.core import llm
from src.core.errors import ValidationError
from src.services.ai import filters as f
from src.services.records.explorer import resources
from tests.personas import PREFIX, principal, sign_in

FILTERS = f"{PREFIX}/api/assistant/filters"

pytestmark = pytest.mark.database


@pytest.fixture(autouse=True)
def _fake_model():
    llm.set_client(llm.FakeClient())
    yield
    llm.set_client(None)


def _rule(field, operator, value):
    return {"type": "rule", "properties": {"field": field, "operator": operator, "value": value}}


def _rules(tree) -> list[dict]:
    out = []
    for child in (tree.get("children1") or {}).values():
        out += _rules(child) if child.get("type") == "group" else [child]
    return out


def test_odd_tree_shapes_are_folded_into_one_valid_query(app):
    from src.core.db import session_scope

    admin = principal(app, "admin")
    task = resources()["task"]
    deep = _rule("status", "eq", ["NEW"])
    for _ in range(f.MAX_DEPTH + 2):
        deep = {"type": "group", "children1": [deep]}
    tree = {
        "conjunction": "ANY",                                  # a spelling of OR
        "children": [                                          # a list, not a map
            _rule("assignee_id", "eq", ["@me"]),
            _rule("assignee_id", "in", [str(admin.user_id), "me"]),
            {"type": "group", "conjunction": "XOR", "children1": {}},  # empty: dropped
            {"type": "group", "conjunction": "XOR", "children1": {"x": _rule("priority", "eq", ["HIGH"])}},
            deep,
            "not a node",
        ],
    }
    with session_scope() as session:
        built, notes = f.normalise(tree, task, session=session, principal=admin)
        session.rollback()
    assert built["properties"]["conjunction"] == "OR"
    rules = _rules(built)
    assignees = [r for r in rules if r["properties"]["field"] == "assignee_id"]
    assert all(str(admin.user_id) in json.dumps(r["properties"]["value"]) for r in assignees)
    nested = [c for c in built["children1"].values() if c.get("type") == "group"]
    assert nested and nested[0]["properties"]["conjunction"] == "AND"   # unknown spelling → AND
    assert "Dropped groups nested too deeply." in notes


def test_a_reference_into_a_dataset_the_reader_cannot_see_is_ignored(app):
    from src.core.db import session_scope

    admin = principal(app, "admin")
    task = resources()["task"]
    project_permission = resources()["project"].permission
    narrowed = replace(admin, permissions=frozenset(p for p in admin.permissions if p != project_permission))
    with session_scope() as session:
        assert f.coerce_values(session, task.fields.by_name["project_id"], "eq", ["Anything"],
                               principal=narrowed, today=f.now()) is None
        session.rollback()


def test_a_tree_with_too_many_rules_is_refused(app):
    from src.core.db import session_scope

    admin = principal(app, "admin")
    task = resources()["task"]
    tree = {"type": "group", "children1": {str(i): _rule("status", "eq", ["NEW"]) for i in range(f.MAX_RULES + 1)}}
    with session_scope() as session:
        with pytest.raises(ValidationError, match="at most"):
            f.normalise(tree, task, session=session, principal=admin)
        session.rollback()


def test_the_model_may_choose_the_dataset_and_its_nonsense_falls_back_to_the_words(client, monkeypatch):
    headers = sign_in(monkeypatch, "admin")
    llm.set_client(llm.FakeClient(script=[json.dumps({
        "resource_type": "ticket", "explanation": "Open tickets.",
        "tree": {"type": "group", "children1": {"a": _rule("status", "eq", ["OPEN"])}},
    })]))
    chosen = client.post(FILTERS, json={"resource_type": "auto", "question": "open tickets"}, headers=headers)
    assert chosen.status_code == 200, chosen.get_json()
    body = chosen.get_json()
    assert body["resource_type"] == "ticket" and body["rule_count"] == 1 and body["explanation"] == "Open tickets."

    llm.set_client(llm.FakeClient(script=["this is not json"]))
    fallback = client.post(FILTERS, json={"resource_type": "task", "question": "high priority tasks"},
                           headers=headers)
    assert fallback.status_code == 200 and fallback.get_json()["source"] == "fallback"

    # A refinement sends the current filter along.
    fake = llm.FakeClient()
    llm.set_client(fake)
    current = {"type": "group", "children1": {"a": _rule("status", "select_equals", "NEW")}}
    client.post(FILTERS, json={"resource_type": "task", "question": "and only mine", "current_tree": current},
                headers=headers)
    assert any("currently applied" in str(m.get("content")) for m in fake.calls[0]["messages"])
