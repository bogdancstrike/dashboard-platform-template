"""The analysis compiler's refusals, and the shapes it accepts.

Every chart, report and document block is answered by `analysis.run`, so a
question it cannot answer has to come back as a 400 that names the field — a
chart builder showing "cannot be grouped by: priority, status, …" is something
a reader can fix. Plus the accepted spellings: a measure as a bare field name,
custom period windows, booleans grouped as text.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.core.errors import ValidationError
from src.services import analysis
from tests.personas import PREFIX, as_each

RUN = f"{PREFIX}/api/analysis/run"


@pytest.mark.database
@pytest.mark.parametrize(("body", "says"), [
    ({"resource_type": "task", "dimensions": "status"}, "array of field names"),
    ({"resource_type": "task", "dimensions": ["status", "priority", "project_id"]}, "at most two"),
    ({"resource_type": "task", "dimensions": ["no_such"]}, "cannot be grouped by"),
    ({"resource_type": "task", "dimensions": [{"field": "created_at", "granularity": "fortnight"}]},
     "granularity"),
    ({"resource_type": "task", "dimensions": [{"field": "status", "granularity": "month"}]}, "Only a date"),
    ({"resource_type": "task", "measures": "count"}, "measures must be an array"),
    ({"resource_type": "task", "measures": ["count"] * 5}, "at most four"),
    ({"resource_type": "task", "measures": [7]}, "object or a field name"),
    ({"resource_type": "task", "measures": [{"aggregation": "median", "field": "progress"}]}, "aggregation"),
    ({"resource_type": "task", "measures": ["title"]}, "cannot be measured"),
    ({"resource_type": "task", "filters": ["status"]}, "filters must be an object"),
    ({"resource_type": "task", "period": "the before times"}, "Unknown period"),
    ({"resource_type": "task", "period": 30}, "name or an object"),
    ({"resource_type": "task", "period": {"from": "last spring"}}, "must be a date"),
    ({"resource_type": "task", "limit": "lots"}, "limit must be a number"),
])
def test_a_question_it_cannot_answer_is_a_400_that_says_why(client, monkeypatch, body, says):
    admin = as_each(monkeypatch)("admin")
    response = client.post(RUN, json=body, headers=admin)
    assert response.status_code == 400, response.get_json()
    assert says.lower() in response.get_json()["message"].lower()


@pytest.mark.database
def test_the_accepted_spellings_all_answer(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    assert client.post(RUN, data="[]", headers={**admin, "Content-Type": "application/json"}).status_code == 400

    # A measure named by its field is a sum; "count" is a count; a date bucket defaults to month.
    numeric = next(name for name, field in _task_fields().items() if field.kind == "number")
    answer = client.post(RUN, json={"resource_type": "task", "dimensions": ["created_at"],
                                    "metrics": ["count", numeric], "limit": 0,
                                    "period": {"key": "custom", "from": "2020-01-01", "to": "2030-01-01T00:00:00Z"},
                                    "query_text": "a"}, headers=admin)
    assert answer.status_code == 200, answer.get_json()
    body = answer.get_json()
    assert [m["key"] for m in body["measures"]] == ["count", f"sum:{numeric}"]
    assert body["dimensions"][0]["granularity"] == "month"

    flag = next((name for name, field in _task_fields().items()
                 if field.kind == "bool" and field.filterable), None)
    if flag:
        grouped = client.post(RUN, json={"resource_type": "task", "dimensions": [flag]}, headers=admin)
        assert grouped.status_code == 200, grouped.get_json()


def _task_fields():
    from src.services.explorer import resources

    return resources()["task"].fields.by_name


def test_a_custom_window_reads_dates_and_instants():
    window = analysis.period_window({"from": "2027-01-01", "to": "2027-02-01T12:00:00"})
    assert window.key == "custom"
    assert window.start == datetime(2027, 1, 1, tzinfo=UTC)
    assert window.end == datetime(2027, 2, 1, 12, tzinfo=UTC)
    assert analysis._moment("", "x") is None
    with pytest.raises(ValidationError):
        analysis.period_window(["last_30_days"])
    assert analysis._period_label("all_time") == "All time"
    assert analysis._period_label("custom") == "Custom range"


def test_a_measure_label_does_not_repeat_its_word():
    from types import SimpleNamespace

    assert analysis._measure_label("sum", SimpleNamespace(title="Total amount")) in (
        "total amount", "sum total amount")
    assert analysis._measure_label("avg", SimpleNamespace(title="Progress")).endswith("progress")
