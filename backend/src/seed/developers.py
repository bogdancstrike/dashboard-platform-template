"""Developer portal demo data (§31): real examples and a fortnight of API usage.

Idempotent, so it is also the `--sync-developers` repair:

* **examples** — for a handful of everyday routes the response is produced by
  calling the very service the endpoint calls, as the seeded administrator, and
  stored with its inferred schema. So the reference shows this deployment's
  real shapes from the first visit, not invented JSON;
* **usage** — when the request log's recent window is thin (a database seeded
  weeks ago has a window that ended weeks ago), it is topped up with two weeks
  of keyed traffic per active client: routes from the endpoint map, weighted to
  reads, with a realistic spread of latency and status codes.
"""

from __future__ import annotations

import random
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import func, select

from src.core.clock import now

#: The window the usage charts read, and the volume that counts as "thin".
WINDOW_DAYS = 14
THIN = 300


def _examples() -> list[tuple[str, str, str, Callable[..., Any]]]:
    from src.services.platform import api_clients
    from src.services.records import explorer
    from src.services.automation import workflows

    return [
        ("GET", "/api/automations/catalog", "/platform/api/automations/catalog",
         lambda s, p: workflows.catalogue(s, principal=p)),
        ("GET", "/api/automations/rules", "/platform/api/automations/rules",
         lambda s, p: workflows.list_rules(s, {}, principal=p)),
        ("GET", "/api/explorer/catalog", "/platform/api/explorer/catalog",
         lambda s, p: explorer.catalogue(s, principal=p)),
        ("GET", "/admin/api-clients", "/platform/admin/api-clients",
         lambda s, p: api_clients.listing(s, {}, principal=p)),
        ("GET", "/admin/api-clients/catalogue", "/platform/admin/api-clients/catalogue",
         lambda s, p: api_clients.catalogue(s, principal=p)),
    ]


def _admin(session):
    from src.core.auth import ALL_PERMISSIONS, Principal
    from src.models.identity import User

    user = session.scalar(select(User).where(User.username == "admin"))
    if user is None:
        return None
    return Principal(user_id=user.id, subject=user.external_id or "", email=user.email, username=user.username,
                     full_name=user.full_name, role_code="ADMINISTRATOR", permissions=frozenset(ALL_PERMISSIONS))


def populate(session) -> dict[str, int]:
    from src.core import endpoint_catalog as endpoint_map
    from src.models.developers import ApiExample
    from src.services.platform.developer_portal import infer_schema, sample

    principal = _admin(session)
    examples = 0
    known = {(m, e["api_url"]) for e in endpoint_map.load()["endpoints"] for m in e.get("request_method") or []}
    if principal is not None:
        for method, route, path, call in _examples():
            if (method, route) not in known:
                continue
            if session.scalar(select(ApiExample.id).where(ApiExample.method == method, ApiExample.route == route)):
                continue
            try:
                with session.begin_nested():
                    response = call(session, principal)
            except Exception:  # noqa: BLE001 - a missing example is not a failed seed
                continue
            session.add(ApiExample(method=method, route=route, status_code=200, path=path,
                                   response_sample=sample(response), response_schema=infer_schema(response),
                                   duration_ms=random.Random(route).randint(18, 140), captured_by_id=principal.user_id,
                                   captured_at=now() - timedelta(days=2)))
            examples += 1
    session.flush()
    return {"examples": examples, "usage_rows": _usage(session)}


def _usage(session) -> int:
    from src.core import endpoint_catalog as endpoint_map
    from src.models.platform import ApiClient, ApiRequestLog

    since = now() - timedelta(days=WINDOW_DAYS)
    recent = session.scalar(select(func.count()).select_from(ApiRequestLog).where(ApiRequestLog.requested_at >= since)) or 0
    if recent >= THIN:
        return 0
    clients = session.scalars(
        select(ApiClient).where(ApiClient.deleted_at.is_(None), ApiClient.status == "ACTIVE").order_by(ApiClient.name)
    ).all()
    if not clients:
        return 0
    routes = [(m, "/platform" + e["api_url"]) for e in endpoint_map.load()["endpoints"]
              for m in e.get("request_method") or [] if e["api_url"].startswith("/api/")]
    reads = [item for item in routes if item[0] == "GET"]
    writes = [item for item in routes if item[0] != "GET"]
    rng = random.Random(31)
    made = 0
    for index, api_client in enumerate(clients):
        # Each client has a few favourite routes, as a real integration does.
        favourites = rng.sample(reads, min(6, len(reads))) + rng.sample(writes, min(2, len(writes)))
        volume = rng.randint(30, 90) if index < 4 else rng.randint(4, 20)
        for day in range(WINDOW_DAYS, -1, -1):
            for _ in range(max(1, int(volume * rng.uniform(0.5, 1.3) * (0.4 if (now() - timedelta(days=day)).weekday() >= 5 else 1)))):
                method, path = rng.choice(favourites) if rng.random() < 0.85 else rng.choice(routes)
                status = rng.choices((200, 201, 400, 401, 403, 404, 429, 500),
                                     weights=(80, 6 if method != "GET" else 0, 4, 2, 2, 3, 1, 1))[0]
                if method == "GET" and status == 201:
                    status = 200
                latency = rng.lognormvariate(4.0, 0.7) * (3 if status >= 500 else 1)
                moment = now() - timedelta(days=day, minutes=rng.randint(0, 24 * 60 - 1))
                if moment > now():
                    continue
                session.add(ApiRequestLog(api_client_id=api_client.id, requested_at=moment, method=method,
                                          path=path[:300], status_code=status, duration_ms=round(latency, 2),
                                          ip_address=f"10.{index}.{rng.randint(0, 255)}.{rng.randint(1, 254)}",
                                          bytes_out=rng.randint(200, 90_000)))
                made += 1
        api_client.last_used_at = now() - timedelta(minutes=rng.randint(2, 300))
    session.flush()
    return made
