"""Intake forms: a designed form, answered in public, becomes a real ticket.

The public door gets the most attention: closed unless published, a challenge
an anonymous caller has to answer, a honeypot that a bot fills and is thanked
for, a rate limit per address — and a submission that is kept even when the
dataset refuses it, with the reason.
"""

from __future__ import annotations

import base64
import re

import pytest
from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
FORMS = f"{PREFIX}/api/forms"
PUBLIC = f"{PREFIX}/public/forms"

FIELDS = [
    {"id": "intro", "type": "heading", "label": "About you"},
    {"id": "email", "type": "email", "label": "Your email", "required": True},
    {"id": "subject", "type": "text", "label": "What is wrong?", "required": True, "map_to": "subject"},
    {"id": "details", "type": "textarea", "label": "Details", "map_to": "description"},
    {"id": "area", "type": "select", "label": "Area", "options": ["Billing", "Access", "Other"]},
    {"id": "other", "type": "text", "label": "Which other area?", "required": True,
     "visible_when": {"field": "area", "equals": "Other"}},
    {"id": "tags", "type": "multiselect", "label": "Affected", "options": ["Web", "Mobile"]},
    {"id": "when", "type": "date", "label": "Since when"},
    {"id": "users", "type": "number", "label": "People affected"},
    {"id": "mood", "type": "rating", "label": "How bad is it?", "max": 5},
    {"id": "shot", "type": "file", "label": "Screenshot"},
]


@pytest.fixture()
def as_(monkeypatch):
    roles = {"admin": "administrator", "manager": "manager", "operator": "operator", "user": "user"}

    def claims(token):
        name = token.split("-", 1)[1]
        return persona_claims(name, roles[name], sid=f"form-{name}")

    monkeypatch.setattr("src.core.auth.tokens.verify_token", claims)
    return lambda name: {"Authorization": f"Bearer form-{name}"}


def _make(client, headers, **overrides):
    body = {"name": "Test support request", "target": "ticket", "fields": FIELDS,
            "settings": {"visibility": "PUBLIC", "captcha": True, "rate_limit_per_hour": 3,
                         "defaults": {"priority": "HIGH"}, "confirmation": "Got it."},
            **overrides}
    return client.post(FORMS, json=body, headers=headers)


def _answer(challenge):
    a, b = (int(n) for n in re.findall(r"\d+", challenge["question"]))
    return a + b


def test_a_public_answer_becomes_a_ticket(client, as_):
    made = _make(client, as_("manager"), slug="test-support-request")
    assert made.status_code == 201, made.json
    form_id = made.json["id"]
    assert made.json["status"] == "DRAFT" and made.json["public_path"] == "/f/test-support-request"

    # A draft is not there for anybody without the right to design it.
    assert client.get(f"{PUBLIC}/test-support-request").status_code == 404
    assert client.get(f"{PUBLIC}/test-support-request", headers=as_("manager")).status_code == 200

    published = client.put(f"{FORMS}/{form_id}", json={"status": "PUBLISHED"}, headers=as_("manager"))
    assert published.status_code == 200, published.json

    page = client.get(f"{PUBLIC}/test-support-request")
    assert page.status_code == 200
    assert page.json["open"] is True and page.json["challenge"]
    assert all("map_to" not in field for field in page.json["fields"])

    png = base64.b64encode(b"\x89PNG fake bytes").decode()
    answers = {"email": "dana@example.com", "subject": "Cannot download invoices",
               "details": "Every PDF is empty.", "area": "Billing", "tags": ["Web"], "when": "2026-11-10",
               "users": "12", "mood": 4, "shot": {"name": "shot.png", "data": f"data:image/png;base64,{png}"}}
    wrong = client.post(f"{PUBLIC}/test-support-request/submit", json={
        "answers": answers, "captcha_token": page.json["challenge"]["token"], "captcha_answer": "1"})
    assert wrong.status_code == 400 and wrong.json["details"]["field"] == "captcha"

    sent = client.post(f"{PUBLIC}/test-support-request/submit", json={
        "answers": answers, "captcha_token": page.json["challenge"]["token"],
        "captcha_answer": _answer(page.json["challenge"])})
    assert sent.status_code == 201, sent.json
    assert sent.json["message"] == "Got it." and sent.json["reference"].startswith("SUB-")
    # An anonymous caller learns nothing about the record.
    assert "record_path" not in sent.json

    listed = client.get(f"{FORMS}/{form_id}/submissions", headers=as_("operator")).json
    item = listed["items"][0]
    assert item["status"] == "CONVERTED" and item["record_type"] == "ticket"
    assert item["record_path"] == f"/tickets/{item['record_id']}"
    assert any(answer["label"] == "Your email" for answer in item["answers"])

    from src.models.business import Ticket

    with session_scope() as session:
        ticket = session.get(Ticket, item["record_id"])
        assert ticket.subject == "Cannot download invoices"
        assert ticket.priority == "HIGH" and ticket.channel == "PORTAL"
        assert "Area: Billing" in ticket.description

    overview = client.get(FORMS, headers=as_("operator")).json
    row = next(entry for entry in overview["items"] if entry["id"] == form_id)
    assert row["submission_count"] == 1 and row["last_week"] == 1
    assert overview["can_manage"] is False and any(t["key"] == "ticket" for t in overview["targets"])


def test_conditional_and_required_fields_are_enforced(client, as_):
    form_id = _make(client, as_("manager"), slug="test-conditions", status="PUBLISHED").json["id"]
    page = client.get(f"{PUBLIC}/test-conditions").json
    base = {"captcha_token": page["challenge"]["token"], "captcha_answer": _answer(page["challenge"])}
    problems = client.post(f"{PUBLIC}/test-conditions/submit", json={
        **base, "answers": {"email": "not-an-email", "subject": "x", "area": "Other", "users": "many",
                            "mood": 9, "tags": ["Fax"], "shot": {"name": "a.png", "data": "!!!"}}})
    assert problems.status_code == 400
    fields = problems.json["details"]["fields"]
    assert set(fields) >= {"email", "other", "users", "mood", "tags", "shot"}
    assert client.post(f"{PUBLIC}/test-conditions/submit", json={**base, "answers": {"area": "Space"}}).status_code == 400
    assert form_id


def test_bots_are_thanked_and_ignored_and_floods_are_limited(client, as_):
    form_id = _make(client, as_("manager"), slug="test-flood", status="PUBLISHED").json["id"]
    bot = client.post(f"{PUBLIC}/test-flood/submit", json={"answers": {"subject": "buy"}, "website": "spam.example"})
    assert bot.status_code == 201 and bot.json["reference"] is None
    counts = client.get(f"{FORMS}/{form_id}/submissions", headers=as_("manager")).json["counts"]
    assert counts == {"SPAM": 1}
    for _ in range(2):
        page = client.get(f"{PUBLIC}/test-flood").json
        client.post(f"{PUBLIC}/test-flood/submit", json={
            "answers": {"email": "a@b.co", "subject": "Hello"}, "captcha_token": page["challenge"]["token"],
            "captcha_answer": _answer(page["challenge"])})
    page = client.get(f"{PUBLIC}/test-flood").json
    limited = client.post(f"{PUBLIC}/test-flood/submit", json={
        "answers": {"email": "a@b.co", "subject": "Hello"}, "captcha_token": page["challenge"]["token"],
        "captcha_answer": _answer(page["challenge"])})
    assert limited.status_code == 429


def test_an_internal_form_needs_a_person_and_credits_them(client, as_):
    _make(client, as_("manager"), slug="test-internal", status="PUBLISHED",
          settings={"visibility": "INTERNAL", "captcha": True})
    assert client.get(f"{PUBLIC}/test-internal").status_code == 401
    page = client.get(f"{PUBLIC}/test-internal", headers=as_("user")).json
    assert page["challenge"] is None and page["visibility"] == "INTERNAL"
    sent = client.post(f"{PUBLIC}/test-internal/submit", headers=as_("user"),
                       json={"answers": {"email": "uma@nucleus.example", "subject": "Laptop is slow"}})
    assert sent.status_code == 201, sent.json
    # A viewer cannot create tickets themselves; the form does it for them.
    assert sent.json["status"] == "CONVERTED" and sent.json["record_path"].startswith("/tickets/")


def test_a_failed_conversion_is_kept_and_can_be_retried(client, as_):
    form = _make(client, as_("manager"), slug="test-retry", status="PUBLISHED",
                 settings={"captcha": False, "defaults": {"priority": "HIGH", "severity": "NOT-A-SEVERITY"}}).json
    sent = client.post(f"{PUBLIC}/test-retry/submit", json={"answers": {"email": "a@b.co", "subject": "Hi"}})
    assert sent.status_code == 201
    item = client.get(f"{FORMS}/{form['id']}/submissions", query_string={"status": "failed"},
                      headers=as_("manager")).json["items"][0]
    assert item["status"] == "FAILED" and item["error"]
    client.put(f"{FORMS}/{form['id']}", json={"settings": {"defaults": {"priority": "HIGH"}}},
               headers=as_("manager"))
    retried = client.post(f"{FORMS}/{form['id']}/submissions/{item['id']}/retry", headers=as_("manager"))
    assert retried.status_code == 200 and retried.json["status"] == "CONVERTED"
    assert client.post(f"{FORMS}/{form['id']}/submissions/{item['id']}/retry",
                       headers=as_("manager")).status_code == 409


def test_publishing_needs_the_records_required_fields_mapped(client, as_):
    response = _make(client, as_("manager"), slug="test-unmapped", status="PUBLISHED",
                     fields=[{"id": "email", "type": "email", "label": "Email"}])
    assert response.status_code == 400 and response.json["details"]["missing"] == ["subject"]


@pytest.mark.parametrize("change", [
    {"name": ""},
    {"target": "invoice"},
    {"slug": "No Spaces!"},
    {"fields": "all"},
    {"fields": [{"id": "a", "type": "hologram", "label": "A"}]},
    {"fields": [{"id": "a", "type": "text", "label": ""}]},
    {"fields": [{"id": "a", "type": "text", "label": "A"}, {"id": "a", "type": "text", "label": "B"}]},
    {"fields": [{"id": "a", "type": "select", "label": "A", "options": []}]},
    {"fields": [{"id": "a", "type": "text", "label": "A", "map_to": "reference"}]},
    {"fields": [{"id": "a", "type": "text", "label": "A", "map_to": "subject"},
                {"id": "b", "type": "text", "label": "B", "map_to": "subject"}]},
    {"fields": [{"id": "a", "type": "text", "label": "A", "visible_when": {"field": "b", "equals": "x"}}]},
    {"settings": {"visibility": "SECRET"}},
    {"settings": {"rate_limit_per_hour": "lots"}},
    {"settings": {"defaults": "none"}},
    {"status": "ARCHIVED"},
    {"fields": [None]},
])
def test_a_form_that_cannot_work_is_refused(client, as_, change):
    assert _make(client, as_("manager"), **change).status_code == 400, change


def test_designing_is_forms_manage_and_slugs_are_unique(client, as_):
    assert _make(client, as_("operator")).status_code == 403
    first = _make(client, as_("manager"), slug="test-unique")
    assert _make(client, as_("manager"), slug="test-unique").status_code == 409
    detail = client.get(f"{FORMS}/{first.json['id']}", headers=as_("operator")).json
    assert detail["settings"]["rate_limit_per_hour"] == 3
    assert client.delete(f"{FORMS}/{first.json['id']}", headers=as_("manager")).json["removed"] is True
    assert client.get(f"{FORMS}/{first.json['id']}", headers=as_("manager")).status_code == 404
    assert client.get(f"{PUBLIC}/nothing-here").status_code == 404


def test_a_closed_form_says_so(client, as_):
    form = _make(client, as_("manager"), slug="test-closed", status="CLOSED").json
    page = client.get(f"{PUBLIC}/test-closed").json
    assert page["open"] is False
    assert client.post(f"{PUBLIC}/test-closed/submit", json={"answers": {}}).status_code == 409
    assert form["status"] == "CLOSED"


def test_expired_and_malformed_challenges_are_refused():
    from src.core.errors import ValidationError
    from src.services import forms

    with pytest.raises(ValidationError):
        forms._check_challenge("x", "garbage", "3")
    with pytest.raises(ValidationError):
        forms._check_challenge("x", "1.abc", "3")
    token = forms.challenge("x")
    with pytest.raises(ValidationError):
        forms._check_challenge("y", token["token"], "0")
