"""Nucleus load test — realistic journeys for up to 1000 concurrent users.

Run it with `make loadtest` (headless, ramp to 1000, HTML + CSV under
`loadtest/reports/`) or interactively with `loadtest/.venv/bin/locust -f
loadtest/locustfile.py`. See loadtest/README.md.

Design rules, each one a promise to the people sharing the stack:

* **No login storm.** Each seeded persona signs in once (tokens.py, cached and
  refreshed); every simulated user reuses its persona's bearer.
* **Same paths as the browser.** Everything goes to `/platform/...` on the API
  with the payload shapes `frontend/src/api/*.ts` sends.
* **Writes only on throwaway data.** Kanban moves happen on boards this run
  creates (`LT load-test …`) and deletes at the end; exports queued here are
  deleted. `cleanup.py` hard-deletes whatever the soft deletes leave and the
  audit/log rows the run wrote — every request carries an `X-Correlation-ID`
  starting `lt-`, which is the handle the cleanup uses.
* **No real AI spend.** AI journeys are off unless `LOADTEST_AI=fake`, and even
  then every AI request carries `X-Nucleus-LLM: fake` and the journey switches
  itself off unless the server confirms it is answering with the fake model.
"""

from __future__ import annotations

import json
import logging
import os
import random
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import gevent
from locust import HttpUser, User, between, events, task
from locust.exception import StopUser

sys.path.insert(0, str(Path(__file__).parent))
import tokens  # noqa: E402

PREFIX = os.getenv("LOADTEST_PREFIX", "/platform")
RUN_ID = os.getenv("LOADTEST_RUN_ID") or datetime.now(UTC).strftime("%Y%m%d%H%M%S")
AI_MODE = os.getenv("LOADTEST_AI", "off").lower()  # off | fake
WRITES = os.getenv("LOADTEST_WRITES", "on").lower() != "off"
WEBSOCKETS = os.getenv("LOADTEST_WS", "on").lower() != "off"
STATE_FILE = Path(__file__).with_name("reports") / f".state-{RUN_ID}.json"

#: How the population divides between personas — mostly ordinary users.
PERSONA_WEIGHTS = {"user": 40, "operator": 20, "manager": 15, "analyst": 15, "admin": 10}

DATASETS = ("task", "ticket", "project", "customer", "order", "device")
SEARCH_TERMS = ("acme", "audit", "review", "invoice", "sensor", "migration", "renewal", "bug", "q4",
                "berlin", "network", "backup", "onboarding", "café", "批量", "ordr")
PERIODS = ("last_30_days", "last_90_days", "current_year", "last_7_days")

log = logging.getLogger("nucleus.loadtest")

# ── Shared state, filled once in test_start ──────────────────────────────

SHARED: dict = {"catalog": {}, "ids": {}, "boards": {}, "exports": [], "ai": False, "users": []}


def _correlation() -> str:
    return f"lt-{RUN_ID}-{uuid.uuid4().hex[:12]}"


def _persona_headers(persona: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens.bearer(persona)}", "Content-Type": "application/json"}


def _api(method: str, path: str, persona: str = "admin", **kwargs):
    """A plain-requests call for setup and teardown (not counted in stats)."""
    import requests

    headers = {**_persona_headers(persona), "X-Correlation-ID": _correlation(), **kwargs.pop("headers", {})}
    return requests.request(method, f"{_host()}{PREFIX}{path}", headers=headers, timeout=30, **kwargs)


def _host() -> str:
    return os.getenv("LOADTEST_HOST", "http://localhost:5101").rstrip("/")


def _sample_ids() -> None:
    for dataset in DATASETS:
        response = _api("POST", "/api/explorer/query", "admin", json={
            "resource_type": dataset, "page": 1, "page_size": 100, "columns": ["id"]})
        if response.ok:
            SHARED["ids"][dataset] = [row["id"] for row in response.json().get("items", [])]
    response = _api("GET", "/api/explorer/catalog", "admin")
    if response.ok:
        for item in response.json().get("items", []):
            SHARED["catalog"][item["key"]] = {
                f["name"]: f["choices"] for f in item["fields"] if f.get("facet") and f.get("choices")
            }
            SHARED["catalog"][item["key"]]["__sort__"] = [f["name"] for f in item["fields"] if f.get("sortable")]
    response = _api("GET", "/admin/users?page_size=50", "admin")
    if response.ok:
        SHARED["users"] = [u["id"] for u in response.json().get("items", [])]


def _make_boards() -> None:
    """One throwaway board per writing persona, with cards to move around."""
    for persona in ("manager", "operator", "admin"):
        response = _api("POST", "/api/kanban/boards", persona, json={
            "name": f"LT load-test {RUN_ID} {persona}", "description": "Throwaway board — deleted by the load test."})
        if not response.ok:
            log.warning("could not create a board for %s: %s", persona, response.status_code)
            continue
        board = response.json()
        detail = _api("GET", f"/api/kanban/boards/{board['id']}", persona).json()
        lanes = [lane["id"] for lane in detail["lanes"]]
        cards = []
        for i in range(12):
            card = _api("POST", f"/api/kanban/boards/{board['id']}/cards", persona, json={
                "title": f"LT card {i}", "lane_id": lanes[i % len(lanes)], "kind": "TASK"})
            if card.ok:
                cards.append(card.json()["id"])
        SHARED["boards"][persona] = {"id": board["id"], "lanes": lanes, "cards": cards}


def _check_ai() -> bool:
    """Only run AI journeys if the server *confirms* it answers them with the fake model."""
    if AI_MODE != "fake":
        return False
    response = _api("GET", "/api/assistant/usage", "user", headers={"X-Nucleus-LLM": "fake"})
    if not response.ok:
        log.warning("AI journeys disabled: /api/assistant/usage answered %s", response.status_code)
        return False
    body = response.json()
    if body.get("real") is not False:
        log.error("AI journeys DISABLED: the server did not confirm fake mode for X-Nucleus-LLM: fake (%s)", body)
        return False
    return True


@events.test_start.add_listener
def _on_start(environment, **_):
    from locust.runners import MasterRunner

    if isinstance(environment.runner, MasterRunner):
        return  # the master runs no users; each worker (or the local runner) sets up its own
    tokens.ensure()
    _sample_ids()
    if WRITES:
        _make_boards()
    SHARED["ai"] = _check_ai()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"run_id": RUN_ID, "boards": SHARED["boards"],
                                      "started": datetime.now(UTC).isoformat()}))
    log.info("load test %s: %s ids sampled, %s boards, AI journeys %s", RUN_ID,
             {k: len(v) for k, v in SHARED["ids"].items()}, len(SHARED["boards"]),
             "on (fake)" if SHARED["ai"] else "off")
    gevent.spawn(_keep_tokens_fresh)
    gevent.spawn(_circuit_breaker, environment)


def _keep_tokens_fresh() -> None:
    while True:
        gevent.sleep(300)
        try:
            tokens.ensure()
        except Exception as exc:  # noqa: BLE001
            log.warning("token refresh failed: %s", exc)


#: Stop the run rather than flatten a shared stack: if, over the last window,
#: more than this share of requests fail or the median exceeds the ceiling,
#: the runner quits and says why.
ABORT_FAIL_RATIO = float(os.getenv("LOADTEST_ABORT_FAIL_RATIO", "0.25"))
ABORT_MEDIAN_MS = float(os.getenv("LOADTEST_ABORT_MEDIAN_MS", "15000"))


def _circuit_breaker(environment) -> None:
    gevent.sleep(30)
    strikes = 0
    while environment.runner and environment.runner.state not in ("stopped", "quitting"):
        gevent.sleep(10)
        total = environment.stats.total
        current_rps = total.current_rps or 0
        fail_rps = total.current_fail_per_sec or 0
        median = total.get_current_response_time_percentile(0.5) or 0
        bad = (current_rps and fail_rps / current_rps > ABORT_FAIL_RATIO) or median > ABORT_MEDIAN_MS
        strikes = strikes + 1 if bad else 0
        if strikes >= 3:
            log.error("circuit breaker: fail %.1f/s of %.1f/s, median %.0f ms for 30 s — stopping the run",
                      fail_rps, current_rps, median)
            environment.process_exit_code = 3
            environment.runner.quit()
            return


@events.test_stop.add_listener
def _on_stop(environment, **_):
    for persona, board in SHARED["boards"].items():
        try:
            _api("DELETE", f"/api/kanban/boards/{board['id']}", persona)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not delete board %s: %s", board["id"], exc)
    for persona, export_id in list(SHARED["exports"]):
        try:
            _api("DELETE", f"/exports/{export_id}", persona)
        except Exception:  # noqa: BLE001
            pass
    log.info("load test %s finished; run `make loadtest-cleanup RUN=%s` to hard-delete leftovers", RUN_ID, RUN_ID)


# ── The simulated person ─────────────────────────────────────────────────


class NucleusUser(HttpUser):
    """A person with the app open: reads a lot, polls counts, writes a little."""

    host = _host()
    wait_time = between(float(os.getenv("LOADTEST_WAIT_MIN", "2")), float(os.getenv("LOADTEST_WAIT_MAX", "8")))
    weight = 20

    def on_start(self):
        self.persona = random.choices(list(PERSONA_WEIGHTS), weights=list(PERSONA_WEIGHTS.values()))[0]

    # -- plumbing
    def _headers(self, extra: dict | None = None) -> dict[str, str]:
        headers = _persona_headers(self.persona)
        headers["X-Correlation-ID"] = _correlation()
        if extra:
            headers.update(extra)
        return headers

    def get(self, path: str, name: str | None = None, **kwargs):
        with self.client.get(f"{PREFIX}{path}", headers=self._headers(kwargs.pop("headers", None)),
                             name=name or path, catch_response=True, **kwargs) as response:
            return self._judge(response)

    def send(self, method: str, path: str, body, name: str | None = None, ok=(200, 201), headers=None):
        with self.client.request(method, f"{PREFIX}{path}", data=json.dumps(body), headers=self._headers(headers),
                                 name=name or path, catch_response=True) as response:
            return self._judge(response, ok)

    @staticmethod
    def _judge(response, ok=(200,)):
        if response.status_code in ok:
            response.success()
        elif response.status_code == 403:
            # A persona without the permission: the product working as designed.
            response.success()
        else:
            response.failure(f"HTTP {response.status_code}")
        return response

    def _json(self, response):
        try:
            return response.json()
        except Exception:  # noqa: BLE001
            return {}

    # -- journeys
    @task(14)
    def poll_counts(self):
        """The header bell polls; the most frequent request of any open tab."""
        self.get("/notifications/counts")

    @task(8)
    def home(self):
        self.get("/api/me")
        self.get("/api/announcements", name="/api/announcements")
        self.get("/api/activity?page_size=10", name="/api/activity")
        self.get("/favorites")
        self.get("/recents")

    @task(6)
    def dashboard(self):
        period = random.choice(PERIODS)
        self.get(f"/dashboard/summary?period={period}", name="/dashboard/summary")
        self.get("/dashboard/alerts")

    @task(16)
    def browse_list(self):
        dataset = random.choice(DATASETS)
        catalog = SHARED["catalog"].get(dataset, {})
        filters = {}
        facet_fields = [k for k in catalog if k != "__sort__"]
        if facet_fields and random.random() < 0.6:
            field = random.choice(facet_fields)
            filters[field] = random.sample(catalog[field], k=min(len(catalog[field]), random.randint(1, 2)))
        sort = random.choice(catalog.get("__sort__") or ["updated_at"])
        body = {"resource_type": dataset, "filters": filters, "page": 1, "page_size": random.choice((25, 25, 50)),
                "sort": sort, "order": random.choice(("asc", "desc")), "facets": True}
        if random.random() < 0.25:
            body["query_text"] = random.choice(SEARCH_TERMS)
        response = self.send("POST", "/api/explorer/query", body, name="/api/explorer/query [list]", ok=(200,))
        pages = self._json(response).get("pages", 1) or 1
        if pages > 1 and random.random() < 0.4:
            body.update(page=random.randint(2, min(pages, 10)), facets=False)
            self.send("POST", "/api/explorer/query", body, name="/api/explorer/query [page]", ok=(200,))

    @task(4)
    def insights(self):
        self.send("POST", "/api/explorer/insights", {"resource_type": random.choice(DATASETS)}, ok=(200,))

    @task(4)
    def advanced_query(self):
        """The advanced builder: a nested AND/OR tree, the way the UI serialises it."""
        dataset = random.choice(("ticket", "task", "order", "customer"))
        catalog = SHARED["catalog"].get(dataset, {})
        fields = [k for k in catalog if k != "__sort__"] or ["status"]
        def rule(field):
            return {"type": "rule", "properties": {
                "field": field, "operator": "select_any_in",
                "value": [random.sample(catalog.get(field, ["X"]), k=1)]}}
        tree = {"type": "group", "id": "root", "properties": {"conjunction": "AND"}, "children1": {
            "r1": rule(random.choice(fields)),
            "g1": {"type": "group", "properties": {"conjunction": "OR"}, "children1": {
                "r2": rule(random.choice(fields)), "r3": rule(random.choice(fields))}},
        }}
        self.send("POST", "/api/explorer/query", {"resource_type": dataset, "condition_tree": tree, "page": 1,
                                                  "page_size": 25, "facets": False},
                  name="/api/explorer/query [advanced]", ok=(200,))

    @task(10)
    def record_detail(self):
        dataset = random.choice(DATASETS)
        ids = SHARED["ids"].get(dataset)
        if not ids:
            return
        record_id = random.choice(ids)
        self.get(f"/api/records/{dataset}/{record_id}", name="/api/records/[type]/[id]")
        self.get(f"/api/audit/timeline?resource_type={dataset}&resource_id={record_id}", name="/api/audit/timeline")
        self.get(f"/api/comments?resource_type={dataset}&resource_id={record_id}", name="/api/comments")
        self.get(f"/api/records/{dataset}/{record_id}/tags", name="/api/records/[type]/[id]/tags")
        if random.random() < 0.3:
            self.get(f"/api/relationships/{dataset}/{record_id}", name="/api/relationships/[type]/[id]")

    @task(8)
    def global_search(self):
        term = random.choice(SEARCH_TERMS)
        # The palette searches as somebody types: two prefixes, then the word.
        for size in sorted({min(3, len(term)), len(term)}):
            self.get(f"/api/search/global?q={term[:size]}", name="/api/search/global")

    @task(3)
    def notifications(self):
        self.get("/notifications?page=1&page_size=20", name="/notifications")

    @task(4)
    def kanban_read(self):
        response = self.get("/api/kanban/boards")
        boards = self._json(response).get("items") or []
        if boards:
            board = random.choice(boards)
            self.get(f"/api/kanban/boards/{board['id']}", name="/api/kanban/boards/[id]")

    @task(3)
    def kanban_move(self):
        if not WRITES or self.persona not in SHARED["boards"]:
            return
        board = SHARED["boards"][self.persona]
        if not board["cards"]:
            return
        with self.client.get(f"{PREFIX}/api/kanban/boards/{board['id']}", headers=self._headers(),
                             name="/api/kanban/boards/[id]", catch_response=True) as response:
            if response.status_code == 404:
                # Somebody else removed our throwaway board — on a shared
                # database, another suite's age-based cleanup can. Not the
                # API's failure; stop writing to it.
                response.success()
                SHARED["boards"].pop(self.persona, None)
                log.warning("throwaway board for %s vanished; kanban writes for it stop", self.persona)
                return
            self._judge(response)
        card = random.choice(board["cards"])
        with self.client.request("POST", f"{PREFIX}/api/kanban/cards/{card}/move", headers=self._headers(),
                                 data=json.dumps({"lane_id": random.choice(board["lanes"]),
                                                  "position": random.randint(0, 4)}),
                                 name="/api/kanban/cards/[id]/move", catch_response=True) as response:
            if response.status_code == 404:
                # Removed by somebody else (see the board case above).
                response.success()
                if card in board["cards"]:
                    board["cards"].remove(card)
                return
            self._judge(response)

    @task(3)
    def files(self):
        self.get("/api/files/tree")
        self.get("/api/files?page=1&page_size=25", name="/api/files")

    @task(2)
    def exports(self):
        self.get("/exports?page=1&page_size=25", name="/exports")
        dataset = random.choice(DATASETS)
        self.send("POST", "/exports/estimate", {"resource_type": dataset, "format": "csv"}, ok=(200,))
        if WRITES and random.random() < 0.05:
            response = self.send("POST", "/exports", {"resource_type": dataset, "format": "csv",
                                                      "filters": {}}, ok=(200, 201, 202))
            export_id = self._json(response).get("id")
            if export_id:
                SHARED["exports"].append((self.persona, export_id))

    @task(3)
    def calendar(self):
        start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=35)
        self.get(f"/api/calendar/events?from={start:%Y-%m-%dT%H:%M:%SZ}&to={end:%Y-%m-%dT%H:%M:%SZ}",
                 name="/api/calendar/events")

    @task(3)
    def mail(self):
        self.get("/api/mail/threads?page=1&page_size=25", name="/api/mail/threads")

    @task(2)
    def reports_and_dashboards(self):
        self.get("/api/dashboards")
        self.get("/api/reports")

    @task(1)
    def directory(self):
        if SHARED["users"]:
            self.get(f"/api/profile/{random.choice(SHARED['users'])}", name="/api/profile/[id]")

    @task(3)
    def admin_pages(self):
        if self.persona != "admin":
            return
        page = random.choice(("audit", "users", "logs", "jobs", "health", "quality", "security"))
        path = {
            "audit": "/admin/audit?page=1&page_size=50", "users": "/admin/users?page=1&page_size=25",
            "logs": "/admin/logs?page=1&page_size=50", "jobs": "/admin/jobs?page=1&page_size=25",
            "health": "/health/status", "quality": "/admin/quality", "security": "/security/overview",
        }[page]
        self.get(path, name=path.split("?")[0])

    @task(2)
    def ai(self):
        """Only with LOADTEST_AI=fake and the server's confirmation; never the real model."""
        if not SHARED["ai"]:
            return
        fake = {"X-Nucleus-LLM": "fake"}
        self.send("POST", "/api/assistant/filters", {"resource_type": random.choice(DATASETS),
                                                     "question": "open critical items this month"},
                  name="/api/assistant/filters [fake]", ok=(200, 429), headers=fake)
        self.send("POST", "/api/assistant/page-help", {"question": "how do I export this?", "path": "/tickets"},
                  name="/api/assistant/page-help [fake]", ok=(200, 429), headers=fake)


class LiveSocketUser(User):
    """An open tab's live channel: connect, hold, reconnect — the LiveProvider's life."""

    weight = int(os.getenv("LOADTEST_WS_WEIGHT", "1"))
    wait_time = between(1, 5)

    def on_start(self):
        if not WEBSOCKETS:
            raise StopUser()
        self.persona = random.choices(list(PERSONA_WEIGHTS), weights=list(PERSONA_WEIGHTS.values()))[0]

    @task
    def hold_socket(self):
        import websocket  # websocket-client; gevent-patched sockets

        url = _host().replace("http", "ws", 1) + f"{PREFIX}/live"
        started = time.perf_counter()
        exc = None
        ws = None
        try:
            ws = websocket.create_connection(url, subprotocols=["bearer", tokens.bearer(self.persona)], timeout=10)
            first = json.loads(ws.recv())
            if first.get("type") != "ready":
                raise RuntimeError(f"unexpected first frame {first.get('type')}")
        except Exception as error:  # noqa: BLE001
            exc = error
        events.request.fire(request_type="WS", name="/live [connect]", response_time=(time.perf_counter() - started) * 1000,
                            response_length=0, exception=exc, context={})
        if ws is None:
            return
        try:
            deadline = time.monotonic() + random.uniform(20, 60)
            ws.settimeout(5)
            while time.monotonic() < deadline:
                try:
                    message = ws.recv()
                    if message and '"ping"' in message:
                        ws.send("pong")
                except websocket.WebSocketTimeoutException:
                    continue
        except Exception as error:  # noqa: BLE001
            events.request.fire(request_type="WS", name="/live [drop]", response_time=0, response_length=0,
                                exception=error, context={})
        finally:
            try:
                ws.close()
            except Exception:  # noqa: BLE001
                pass
