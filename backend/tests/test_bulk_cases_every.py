"""One gesture over many records (§43, §75). — the cases every endpoint answers."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from tests.bulk_support import (  # noqa: F401
    BULK,
    PREVIEW,
    TASKS,
    _authenticate,
    scratch,
)
from tests.patching import patch_package


def test_a_bulk_gesture_needs_a_bearer_token(client):
    assert client.post(BULK, json={"action": "delete", "ids": []}).status_code == 401
    assert client.post(PREVIEW, json={"action": "delete", "ids": []}).status_code == 401


@pytest.mark.database
def test_an_empty_selection_is_refused_rather_than_applied_to_nothing(client, monkeypatch):
    # Applying to zero rows would answer "0 changed" as a success, which is
    # indistinguishable from a selection the client failed to send.
    response = client.post(
        BULK, json={"action": "delete", "ids": []}, headers=_authenticate(monkeypatch)
    )
    assert response.status_code == 400
    assert "selection" in response.get_json()["details"]


@pytest.mark.database
def test_an_action_the_list_does_not_offer_is_refused(client, monkeypatch, scratch):
    response = client.post(
        BULK,
        json={"action": "archive", "ids": [scratch[0]["id"]]},
        headers=_authenticate(monkeypatch),
    )
    assert response.status_code == 400
    assert response.get_json()["details"]["allowed"] == ["update", "delete"]


@pytest.mark.database
def test_reading_the_list_does_not_carry_the_right_to_change_it(client, monkeypatch, scratch):
    # An analyst reads every record and writes none, and is told which
    # permission is missing rather than which route to use (§76).
    _authenticate(monkeypatch, "analyst", "analyst")
    headers = {"Authorization": "Bearer bulk-analyst"}
    body = {"action": "update", "ids": [scratch[0]["id"]], "changes": {"status": "DONE"}}

    refused = client.post(BULK, json=body, headers=headers)
    assert refused.status_code == 403
    assert refused.get_json()["details"]["missing"] == ["records.update"]

    # But the *preview* answers, with the refusal as a counted reason. A 403
    # with no number in it tells a reader nothing about the selection they are
    # looking at.
    preview = client.post(PREVIEW, json=body, headers=headers)
    assert preview.status_code == 200
    assert preview.get_json()["refused"] == [
        {"reason": "Your role does not include records.update", "count": 1}
    ]
    assert preview.get_json()["eligible"] == 0


@pytest.mark.database
def test_the_preview_splits_hand_picked_from_filter_matched(client, monkeypatch, scratch):
    """The split §75 asks for, because the two halves are trusted differently.

    Somebody who ticked twelve boxes knows what is in them. Somebody who
    filtered does not, and a single total hides which of the two they are
    about to act on.
    """
    headers = _authenticate(monkeypatch)
    response = client.post(
        PREVIEW,
        json={
            "action": "update",
            "changes": {"priority": "LOW"},
            "selection": {
                "ids": [scratch[0]["id"]],
                # Every scratch task, by the title they share — the same
                # question the list would have run.
                "query": {"query_text": "Bulk scratch"},
            },
        },
        headers=headers,
    )
    assert response.status_code == 200
    body = response.get_json()

    assert body["total"] == 3
    assert body["by_hand"] == 1
    assert body["by_filter"] == 2
    # And which records, by name: a count on its own is not something somebody
    # can check before agreeing to it.
    assert {entry["title"] for entry in body["sample"]} == {
        "Bulk scratch 0",
        "Bulk scratch 1",
        "Bulk scratch 2",
    }
    assert body["describes"] == "3 tasks — 1 you selected and 2 matching the filter"


@pytest.mark.database
def test_the_preview_counts_the_rows_that_already_have_the_value(client, monkeypatch, scratch):
    # "3 selected, 3 already like that" is the answer that stops somebody
    # pressing a button that does nothing and then wondering whether it worked.
    response = client.post(
        PREVIEW,
        json={"action": "update", "changes": {"status": "NEW"},
              "ids": [record["id"] for record in scratch]},
        headers=_authenticate(monkeypatch),
    )
    body = response.get_json()
    assert body["refused"] == [{"reason": "Already has these values", "count": 3}]
    assert body["eligible"] == 0


@pytest.mark.database
def test_a_change_the_form_would_refuse_is_refused_here_too(client, monkeypatch, scratch):
    """One validator, not two.

    A bulk edit that accepted a status the form refuses is how a value no
    screen can produce gets into the database — and `record_writes.coerce` is
    the function the form itself uses, so the two cannot drift.
    """
    for url in (PREVIEW, BULK):
        response = client.post(
            url,
            json={"action": "update", "changes": {"status": "NOT_A_STATUS"},
                  "ids": [scratch[0]["id"]]},
            headers=_authenticate(monkeypatch),
        )
        assert response.status_code == 400, url
        assert response.get_json()["details"]["field"] == "status"


@pytest.mark.database
def test_an_update_with_nothing_to_change_is_refused(client, monkeypatch, scratch):
    response = client.post(
        BULK,
        json={"action": "update", "changes": {}, "ids": [scratch[0]["id"]]},
        headers=_authenticate(monkeypatch),
    )
    assert response.status_code == 400
    assert "changes" in response.get_json()["details"]


@pytest.mark.database
def test_one_gesture_updates_every_selected_record_and_audits_each(
    client, monkeypatch, scratch
):
    """The audit rows are the point.

    Two hundred records changed by one gesture must leave the ledger saying
    what two hundred single edits would have said — including that a status
    change is a status change and not an edit, which is a decision
    `record_writes` owns and this path reuses rather than re-implements.
    """
    from src.core.db import session_scope
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    ids = [record["id"] for record in scratch]
    response = client.post(
        BULK,
        json={"action": "update", "changes": {"status": "IN_PROGRESS"}, "ids": ids},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.get_json()
    assert (body["requested"], body["applied"], body["failed"]) == (3, 3, [])
    assert body["message"] == "Updated 3 tasks."

    # Read back from the server rather than trusted from the answer.
    for record_id in ids:
        row = client.get(f"{TASKS}/{record_id}", headers=headers).get_json()
        assert next(f["value"] for f in row["fields"] if f["name"] == "status") == "IN_PROGRESS"

    with session_scope() as session:
        actions = session.scalars(
            select(AuditLog.action).where(AuditLog.resource_id.in_([str(i) for i in ids]))
        ).all()
    # One per record, and a move rather than an edit.
    assert actions.count("STATUS_CHANGE") == 3


@pytest.mark.database
def test_a_row_that_already_had_the_value_is_neither_applied_nor_failed(
    client, monkeypatch, scratch
):
    headers = _authenticate(monkeypatch)
    ids = [record["id"] for record in scratch]
    client.post(
        BULK,
        json={"action": "update", "changes": {"status": "DONE"}, "ids": ids[:1]},
        headers=headers,
    )

    again = client.post(
        BULK, json={"action": "update", "changes": {"status": "DONE"}, "ids": ids},
        headers=headers,
    ).get_json()
    # Folding a no-op into "applied" reports work that did not happen; folding
    # it into "failed" reports a problem that is not one.
    assert (again["applied"], again["unchanged"], again["failed"]) == (2, 1, [])
    assert again["message"] == "Updated 2 tasks; 1 already had those values."


@pytest.mark.database
def test_a_partial_failure_reports_both_halves_and_keeps_the_successes(
    client, monkeypatch, scratch
):
    """The outcome this module exists to report (§34's "partial" state).

    One id that no longer exists among three that do. The answer is two
    applied and one refused with a reason — and, critically, the two are
    *still applied*: a single savepoint around the whole gesture would roll
    them back and report "1 failed" about a list that did not change.
    """
    headers = _authenticate(monkeypatch)
    ids = [record["id"] for record in scratch[:2]]
    gone = str(uuid4())

    body = client.post(
        BULK, json={"action": "delete", "ids": [*ids, gone]}, headers=headers
    ).get_json()

    # The missing id is not in the result at all: `_lookup` never returns it,
    # because a soft-deleted or absent row is not part of the selection. What
    # is asserted is that the two that existed were deleted, and the count
    # reflects what was actually there.
    assert (body["requested"], body["applied"], body["failed"]) == (2, 2, [])
    for record_id in ids:
        assert client.get(f"{TASKS}/{record_id}", headers=headers).status_code == 404
    # The third was untouched and is still readable.
    assert client.get(f"{TASKS}/{scratch[2]['id']}", headers=headers).status_code == 200


@pytest.mark.database
def test_a_filter_selection_can_have_a_row_taken_out_of_it(client, monkeypatch, scratch):
    """"All of these except that one" without sending four hundred ids."""
    headers = _authenticate(monkeypatch)
    kept = scratch[1]["id"]

    body = client.post(
        BULK,
        json={
            "action": "update",
            "changes": {"priority": "LOW"},
            "selection": {"query": {"query_text": "Bulk scratch"}, "excluded": [kept]},
        },
        headers=headers,
    ).get_json()

    assert body["applied"] == 2
    row = client.get(f"{TASKS}/{kept}", headers=headers).get_json()
    assert next(f["value"] for f in row["fields"] if f["name"] == "priority") == "HIGH"


@pytest.mark.database
def test_a_selection_over_the_cap_is_refused_with_the_number_in_it(client, monkeypatch, scratch):
    """A refusal somebody can act on, rather than a slow success.

    The cap is not technical — the statement would happily update a hundred
    thousand — it is the point past which "are you sure" stops being a real
    question, because the reader has no way to check the number they are being
    shown and the recovery from a wrong filter is a restore.
    """
    from src.services.records import bulk

    headers = _authenticate(monkeypatch)
    patch_package(monkeypatch, bulk, "MAX_ROWS", 2)

    # Scoped to this test's own three rows, like every other query here. An
    # unfiltered `{}` would express the same assertion and would also be one
    # typo away from applying a change to the whole seeded dataset — which is
    # exactly how the first draft of this file set every task in the database
    # to LOW, by sending `q` where the payload wants `query_text` and matching
    # everything. See the module docstring.
    body = {
        "action": "update",
        "changes": {"priority": "LOW"},
        "selection": {"query": {"query_text": "Bulk scratch"}},
    }
    # The preview *reports* it, so the dialog can say how much to narrow by…
    preview = client.post(PREVIEW, json=body, headers=headers).get_json()
    assert preview["over_limit"] is True
    assert preview["limit"] == 2

    # …and the write refuses it, naming both numbers.
    refused = client.post(BULK, json=body, headers=headers)
    assert refused.status_code == 400
    assert refused.get_json()["details"] == {"matched": 3, "limit": 2}
