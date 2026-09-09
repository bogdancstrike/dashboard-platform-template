"""Metadata endpoints, including the one guarantee that matters: no secrets.

`/meta/app` is public because a sign-in cannot start without it. The other
three describe the shape of the platform's authorisation and need a token —
they were anonymous because they had been written beside `/meta/app`, and
nothing in the SPA calls them at all (§76). `test_endpoint_map.py` pins that
split: exactly four endpoints answer without a credential, and the list is one
somebody has to add to on purpose.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core.auth import ALL_PERMISSIONS, ROLE_DEFAULTS
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


@pytest.fixture()
def headers(monkeypatch):
    """A signed-in reader — any reader: these need a token, not a permission."""
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims("user", "viewer", sid="meta-user"),
    )
    return {"Authorization": "Bearer meta-user"}


def test_application_metadata_carries_the_oidc_coordinates(client):
    body = client.get(f"{PREFIX}/meta/app").get_json()
    assert body["name"] == Config.APP_NAME
    assert body["auth"]["realm"] == Config.KEYCLOAK_REALM
    assert body["auth"]["client_id"] == Config.KEYCLOAK_SPA_CLIENT_ID
    # The browser is redirected to the public URL; the internal one is how the
    # backend reaches Keycloak inside Docker and must never be published.
    assert body["auth"]["url"] == Config.KEYCLOAK_PUBLIC_URL
    assert Config.KEYCLOAK_INTERNAL_URL not in str(body)


def test_application_metadata_publishes_no_secret(client):
    raw = client.get(f"{PREFIX}/meta/app").get_data(as_text=True)
    assert Config.SECRET_KEY not in raw
    assert Config.DATABASE_URL not in raw


@pytest.mark.database
def test_permission_catalogue_is_complete(client, headers):
    body = client.get(f"{PREFIX}/meta/permissions", headers=headers).get_json()
    codes = [p["code"] for group in body["groups"] for p in group["permissions"]]
    assert sorted(codes) == sorted(ALL_PERMISSIONS)
    assert body["total"] == len(ALL_PERMISSIONS)
    assert all(p["label"] for group in body["groups"] for p in group["permissions"])


@pytest.mark.database
def test_roles_come_back_ranked(client, headers):
    body = client.get(f"{PREFIX}/meta/roles", headers=headers).get_json()
    ranks = [role["rank"] for role in body["items"]]
    assert ranks == sorted(ranks, reverse=True)
    assert body["items"][0]["code"] == "ADMINISTRATOR"
    assert len(body["items"]) == len(ROLE_DEFAULTS)


@pytest.mark.database
def test_only_the_administrator_opens_the_admin_area(client, headers):
    """`admin.access` is the single gate the frontend reads (§13)."""
    body = client.get(f"{PREFIX}/meta/roles", headers=headers).get_json()
    holders = [r["code"] for r in body["items"] if "admin.access" in r["permissions"]]
    assert holders == ["ADMINISTRATOR"]


@pytest.mark.database
def test_routes_endpoint_describes_the_surface(client, headers):
    body = client.get(f"{PREFIX}/meta/routes", headers=headers).get_json()
    assert body["prefix"] == Config.API_PREFIX
    assert body["total"] == len(body["items"])
    urls = {item["url"] for item in body["items"]}
    assert f"{PREFIX}/health/live" in urls


@pytest.mark.database
def test_the_introspection_endpoints_refuse_an_anonymous_caller(client):
    """Publishing the exact permission a control checks is free reconnaissance.

    Not a secret, and not something to hand out either — and the same reasoning
    covers the role ranking and the route table. `/meta/app` stays public
    because a login cannot be started without it, which is asserted above.
    """
    for path in ("/meta/permissions", "/meta/roles", "/meta/routes"):
        assert client.get(f"{PREFIX}{path}").status_code == 401, path
