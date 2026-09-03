"""Metadata endpoints, including the one guarantee that matters: no secrets."""

from __future__ import annotations

from src.config import Config
from src.core.auth import ALL_PERMISSIONS, ROLE_DEFAULTS

PREFIX = Config.API_PREFIX


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


def test_permission_catalogue_is_complete(client):
    body = client.get(f"{PREFIX}/meta/permissions").get_json()
    codes = [p["code"] for group in body["groups"] for p in group["permissions"]]
    assert sorted(codes) == sorted(ALL_PERMISSIONS)
    assert body["total"] == len(ALL_PERMISSIONS)
    assert all(p["label"] for group in body["groups"] for p in group["permissions"])


def test_roles_come_back_ranked(client):
    body = client.get(f"{PREFIX}/meta/roles").get_json()
    ranks = [role["rank"] for role in body["items"]]
    assert ranks == sorted(ranks, reverse=True)
    assert body["items"][0]["code"] == "ADMINISTRATOR"
    assert len(body["items"]) == len(ROLE_DEFAULTS)


def test_only_the_administrator_opens_the_admin_area(client):
    """`admin.access` is the single gate the frontend reads (§13)."""
    body = client.get(f"{PREFIX}/meta/roles").get_json()
    holders = [r["code"] for r in body["items"] if "admin.access" in r["permissions"]]
    assert holders == ["ADMINISTRATOR"]


def test_routes_endpoint_describes_the_surface(client):
    body = client.get(f"{PREFIX}/meta/routes").get_json()
    assert body["prefix"] == Config.API_PREFIX
    assert body["total"] == len(body["items"])
    urls = {item["url"] for item in body["items"]}
    assert f"{PREFIX}/health/live" in urls
