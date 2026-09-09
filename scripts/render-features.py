#!/usr/bin/env python3
"""Regenerate `docs/features.md` and the matrix in `docs/TODO.md`, and check both.

    backend/.venv/bin/python scripts/render-features.py
    backend/.venv/bin/python scripts/render-features.py --check

The §1–§77 catalogue was typed out by hand in `docs/TODO.md` and was wrong in
about a dozen rows by the time anybody looked: features that had shipped months
earlier were still marked open, and two named a route that no longer existed.
That is what a second description of something the system already knows always
becomes.

So the catalogue lives here, once, and two documents are rendered from it — the
reader's `docs/features.md` and the tracker's matrix. Neither can drift from the
other, because there is no other.

**And the routes and endpoints are verified, not merely printed.** A section
marked shipped that names a page the router does not serve, or an endpoint the
map does not mount, fails this script. That is the check the hand-typed table
could not have: `/showcase/table` sat in it for months as §3's home, and no page
of that name was ever built.

Sections still open may name a route that does not exist — that is what "not
built" means — and pattern notation (`/{entity}`, `/errors/*`, `:id`) is exempt
either way, because a catalogue has to be able to say "every entity list".

The generated blocks are delimited by HTML comments; everything outside them is
prose somebody wrote and this script must not touch.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

FEATURES_BEGIN = "<!-- generated:feature-matrix -->"
FEATURES_END = "<!-- /generated:feature-matrix -->"

#: The statuses a row may carry, and what each promises a reader.
#:
#: Three and not five: the useful distinction is "you can use this", "part of
#: it", and "not yet". A fourth grade invites the question of where the line is
#: and gets a different answer from every person who adds a row.
STATUSES = {
    "done": ("[x]", "Shipped"),
    "partial": ("[~]", "Partly there"),
    "open": ("[ ]", "Not built"),
}


def feature(
    number: int,
    title: str,
    where: str,
    api: str,
    status: str,
    note: str = "",
) -> dict[str, object]:
    """One row. `note` is required for anything not `done`.

    Required, because "partly there" with no explanation is the least useful
    thing a catalogue can say: it tells a reader that something is missing and
    not what. Enforced below rather than trusted.
    """
    return {
        "number": number,
        "title": title,
        "where": where,
        "api": api,
        "status": status,
        "note": note,
    }


#: Every section of the specification, its home in the application, the
#: endpoints that answer it, and its state.
#:
#: `—` means the section is a cross-cutting rule rather than a page.
CATALOGUE: list[dict[str, object]] = [
    feature(1, "Application shell, navigation", "all", "`/meta/*`, `/api/me`", "done"),
    feature(
        2, "Overview dashboard, KPIs, charts", "`/`, `/analytics`",
        "`/dashboard/*`, `/api/analysis/*`", "partial",
        "Sixteen panels, KPIs against the previous period, an alert strip and a "
        "feed all ship. The further chart kinds — stacked area, donut with a "
        "centre total, funnel — are listed in the tracker and open.",
    ),
    feature(
        3, "Advanced data table", "every list", "generic list", "partial",
        "Filtering, sorting, paging, facets and column choice all happen in "
        "PostgreSQL on every list, off one `FieldSet` declaration. What is open "
        "is the *showcase* of the table on its own, which `/showcase/components` "
        "does not yet include.",
    ),
    feature(4, "Advanced search (simple + RAQB)", "`/explore`", "`/api/explorer/query`", "done"),
    feature(5, "Saved searches", "`/explore` (panel)", "`/api/saved-searches`", "done"),
    feature(6, "Search results page", "`/search`", "`/api/search/global`", "done"),
    feature(7, "Entity list pages", "`/{entity}`", "generic list", "done"),
    feature(8, "Entity detail pages", "`/{entity}/:id`", "`/api/records/…`", "done"),
    feature(9, "Create / edit / delete", "every list and detail", "`/api/records/…`", "done"),
    feature(
        10, "Multi-step wizard", "`/import`, `/dashboards`", "`/imports`, `/api/dashboards`",
        "partial",
        "Two wizards ship — the import flow and dashboard creation — and both "
        "save between steps. A generic `/{entity}/new/wizard` does not exist and "
        "may never need to: a wizard is right when the decision has parts, "
        "which is a per-entity judgement rather than a default.",
    ),
    feature(11, "User administration", "`/admin/users`", "`/admin/users`", "done"),
    feature(12, "Roles and permissions", "`/admin/roles`", "`/admin/roles`", "done"),
    feature(13, "System settings", "`/admin/settings`", "`/admin/settings`", "done"),
    feature(14, "Groups and teams", "`/admin/groups`", "`/admin/groups`", "done"),
    feature(15, "Mail and threads", "`/mail`", "`/api/mail/threads/:id`", "done"),
    feature(16, "Files and folders", "`/files`", "`/api/files`", "done"),
    feature(17, "Notifications and announcements", "`/notifications`, `/announcements`",
            "`/notifications`, `/api/announcements`", "done"),
    feature(
        18, "Tasks / work queue (kanban)", "`/tasks`, `/kanban`", "`/api/kanban/*`", "partial",
        "Boards, lanes and cards with full CRUD, server-side filters, drag "
        "between lanes reconciled against the server, and a keyboard equivalent "
        "of the drag. Ordering *within* a lane and the comment and checklist "
        "counts on a card's face are open.",
    ),
    feature(19, "Calendar", "`/calendar`", "`/api/calendar/*`", "done"),
    feature(20, "Object storage", "`/files`", "`/api/files/*`", "done"),
    feature(21, "Audit explorer", "`/admin/audit`", "`/admin/audit`", "done"),
    feature(22, "System logs, live tail", "`/admin/logs`", "`/admin/logs`", "done"),
    feature(23, "Background jobs", "`/admin/jobs`", "`/admin/jobs`", "done"),
    feature(24, "System health", "`/admin/health`", "`/health/*`", "done"),
    feature(25, "API clients", "`/admin/api`", "`/admin/api-clients`", "done"),
    feature(26, "Integrations", "`/admin/integrations`", "`/admin/integrations`", "done"),
    feature(27, "Feature flags", "`/admin/flags`", "`/admin/flags`", "done"),
    feature(28, "Reports and analysis", "`/reports`, `/reports/builder`", "`/api/analysis/*`", "done"),
    feature(29, "Import wizard", "`/import`", "`/imports`", "done"),
    feature(30, "Export", "every list, `/exports`", "`/exports`", "done"),
    feature(31, "Command palette (`cmdk`)", "global", "`/api/search/global`", "done"),
    feature(32, "Global search", "header + `/find/global`", "`/api/search/global`", "done"),
    feature(33, "Drawers and modals", "—", "—", "done"),
    feature(34, "Error and empty states", "`/errors/*`", "—", "done"),
    feature(35, "Activity feed", "`/activity`, `/profile`", "`/api/activity`", "done"),
    feature(
        36, "Comments", "`/tasks/:id`, `/tickets/:id`", "`/api/comments`", "partial",
        "Mentions, one level of replies and the audit timeline beside them, on "
        "the two record pages where a conversation actually happens. The other "
        "four entity detail pages do not carry it yet.",
    ),
    feature(37, "Tags and labels", "`/admin/tags`", "`/tags`", "done"),
    feature(38, "Favorites", "`/favorites`", "`/favorites`", "done"),
    feature(39, "Recent items", "`/favorites`", "`/recents`", "done"),
    feature(40, "Personal preferences", "`/settings/preferences`, `/profile`", "`/api/me`", "done"),
    feature(41, "Security settings, sessions", "`/settings/security`", "`/security/*`", "done"),
    feature(42, "Organization settings", "`/admin/organizations`", "`/admin/organizations`", "done"),
    feature(43, "Bulk operations", "every list that is a table",
            "`/api/records/{type}/bulk`", "done"),
    feature(
        44, "Drill-down", "dashboard, analytics, `/admin/quality` → list",
        "`/api/analysis/run`", "partial",
        "Every KPI tile, chart segment and quality finding opens the rows behind "
        "it with the same filters applied. The back-stack that would return a "
        "reader to the picture they came from is open.",
    ),
    feature(
        45, "Dashboard builder", "`/dashboards`", "`/api/dashboards`", "done",
    ),
    feature(
        46, "Saved views", "every list", "`/saved-views`", "open",
        "Not built. A saved *search* keeps the question (§5); a saved view would "
        "keep the presentation — columns, sort, density — against a list.",
    ),
    feature(47, "Data comparison", "`/compare`", "`/api/records/{type}/compare`", "done"),
    feature(
        48, "Timeline view", "detail tabs", "`/admin/audit`", "partial",
        "Every record page carries its own history, read from the audit ledger "
        "so the two cannot disagree. A cross-record timeline — one thread "
        "through several records — is open.",
    ),
    feature(
        50, "Data relationships", "detail tabs + `/find/relationships`",
        "`/api/relationships/*`", "partial",
        "The graph, the weighted relations, hub records and coverage all ship. "
        "Marker clustering and a per-record relationship tab are open.",
    ),
    feature(51, "Query inspector", "`/explore`", "— (`core/rules.py`)", "done"),
    feature(52, "Pagination patterns", "various", "— (`core/pagination.py`)", "done"),
    feature(
        53, "Data refresh, auto-refresh", "data-heavy pages", "`/live`", "partial",
        "Notifications and the log tail arrive over the live channel. A general "
        "auto-refresh a reader can turn on per page is open.",
    ),
    feature(54, "Keyboard navigation", "global", "—", "done"),
    feature(55, "Accessibility", "global", "—", "done"),
    feature(
        56, "Responsive behaviour", "global", "—", "partial",
        "Four breakpoints, a collapsing sidebar, a mobile drawer and tables that "
        "scroll rather than squash. One page is asserted at mobile width end to "
        "end; the rest are not.",
    ),
    feature(57, "Realistic demo data", "—", "`src/seed/`", "done"),
    feature(58, "Demo roles / personas", "—", "— (`core/auth.py`)", "done"),
    feature(
        59, "UX quality bar", "global", "—", "partial",
        "The standing bar rather than a deliverable: it is met on every page "
        "that has shipped and is re-argued on every page that ships next.",
    ),
    feature(60, "Component showcase", "`/showcase/components`", "—", "done"),
    feature(61, "Page template gallery", "`/showcase/templates`", "—", "done"),
    feature(
        62, "Master / detail layout", "`/mail`, `/tickets`, `/explore`", "—", "partial",
        "The layout ships on three pages and the gallery documents when to reach "
        "for it. A dedicated showcase of the shape on its own is open.",
    ),
    feature(
        63, "Split view", "`/mail`, `/tickets`, `/explore`", "—", "done",
    ),
    feature(
        64, "Table row preview drawer", "`/explore`", "`/api/records/…`", "partial",
        "The explorer opens a row without leaving the list, deep-linked and "
        "keyboard-driven. The other lists send a reader to the record page "
        "instead, which for a ledger or a fleet is the better answer — the open "
        "part is the lists where it is not.",
    ),
    feature(65, "Data quality indicators", "lists + `/admin/quality`", "`/admin/quality`", "done"),
    feature(66, "Dashboard alerts", "`/`", "`/dashboard/alerts`", "done"),
    feature(68, "Navigation history", "`/favorites`", "`/recents`", "done"),
    feature(69, "Deep linking", "global", "—", "done"),
    feature(70, "Search within table data", "every list", "generic list", "done"),
    feature(71, "Server-side data model", "—", "— (`core/query.py`)", "done"),
    feature(72, "Query state persistence", "global", "—", "done"),
    feature(
        73, "Optimistic vs confirmed actions", "board, forms", "—", "partial",
        "A dragged card moves at once and is reconciled against the server's "
        "answer, and a stale edit is refused with a 409 naming both moments. "
        "Forms are all confirmed rather than optimistic, which is the right "
        "default and leaves the optimistic half unexercised outside the board.",
    ),
    feature(
        74, "Unsaved changes protection", "every drawer", "—", "partial",
        "The record drawer asks before discarding. The inline controls that "
        "write on change need no guard, and the two builders do not have one.",
    ),
    feature(75, "Preview before bulk execution", "every bulk action",
            "`/api/records/{type}/bulk/preview`", "done"),
    feature(76, "Security-conscious UX", "global", "— (`core/auth.py`)", "done"),
    feature(
        77, "Final goal — coherent template", "everything", "—", "partial",
        "Open while anything above is, by construction: the section is the "
        "conjunction of the rest.",
    ),
]

#: §49 and §67 are declared out of order in the specification's own numbering,
#: so they are inserted rather than left to a sorted list — the catalogue is
#: read against the spec, and a gap would look like an omission.
CATALOGUE.extend(
    [
        feature(49, "Alerts and rules", "`/workflows`", "`/api/automations/rules`", "done"),
        feature(67, "Customisable home page", "`/dashboards`", "`/api/dashboards`", "done"),
    ]
)


def _routes() -> set[str]:
    """Every concrete route the router serves.

    Two syntaxes, because the entity pages are declared as data rather than as
    JSX attributes — the same trap `templates.test.ts` fell into, where a
    completeness check read one form and certified a hole.
    """
    source = (ROOT / "frontend/src/App.tsx").read_text()
    return {match.group(1) for match in re.finditer(r'path="([^"]+)"', source)} | {
        match.group(1) for match in re.finditer(r'path:\s*"([^"]+)"', source)
    }


def _endpoints() -> list[str]:
    payload = json.loads((ROOT / "backend/maps/endpoint.json").read_text())
    return [entry["api_url"] for entry in payload["endpoints"]]


def _is_pattern(token: str) -> bool:
    """Whether a token is notation rather than an address.

    A catalogue has to be able to say "every entity list", so `/{entity}`,
    `/errors/*`, `:id` and `…` are notation and exempt from the checks below.
    """
    return any(character in token for character in "{}*…:")


def problems() -> list[str]:
    """Every way the catalogue disagrees with the code.

    The check the hand-typed table could not have. Sections still open may name
    a route that does not exist — that is what open means — so only the shipped
    ones are held to it.
    """
    found: list[str] = []
    routes = _routes()
    endpoints = _endpoints()
    numbers = [int(row["number"]) for row in CATALOGUE]  # type: ignore[arg-type]

    for missing in sorted(set(range(1, 78)) - set(numbers)):
        found.append(f"§{missing} is missing from the catalogue")
    for number in sorted({n for n in numbers if numbers.count(n) > 1}):
        found.append(f"§{number} appears more than once")

    for row in CATALOGUE:
        number, status = row["number"], row["status"]
        if status not in STATUSES:
            found.append(f"§{number} has an unknown status {status!r}")
            continue
        if status != "done" and not row["note"]:
            found.append(f"§{number} is {status} and says nothing about what is missing")
        if status == "done" and row["note"]:
            found.append(f"§{number} is shipped and still carries a note")
        if not status == "done":
            continue
        for token in re.findall(r"`([^`]+)`", str(row["where"])):
            if not token.startswith("/") or _is_pattern(token) or token == "/":
                continue
            if token.lstrip("/") not in routes:
                found.append(f"§{number} names the route {token} and the router does not serve it")
        for token in re.findall(r"`([^`]+)`", str(row["api"])):
            if not token.startswith("/") or _is_pattern(token):
                continue
            stem = token.rstrip("*").rstrip("/")
            if not any(url.startswith(stem) for url in endpoints):
                found.append(f"§{number} names the endpoint {token} and the map does not mount it")
    return found


def matrix() -> str:
    """The table both documents share."""
    rows = sorted(CATALOGUE, key=lambda row: int(row["number"]))  # type: ignore[arg-type]
    counts = {name: sum(1 for row in rows if row["status"] == name) for name in STATUSES}

    lines = [
        FEATURES_BEGIN,
        "",
        "| § | Feature | Route / where | API | State |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        mark = STATUSES[str(row["status"])][0]
        lines.append(
            f"| {row['number']} | {row['title']} | {row['where']} | {row['api']} | {mark} |"
        )

    lines.extend([
        "",
        f"*{counts['done']} shipped · {counts['partial']} partly there · "
        f"{counts['open']} not built — generated from `scripts/render-features.py`, "
        "which also fails if a shipped section names a route the router does not "
        "serve or an endpoint the map does not mount.*",
        "",
    ])

    outstanding = [row for row in rows if row["status"] != "done"]
    if outstanding:
        lines.extend([
            "### What is not finished, and what is missing from it",
            "",
            "Every section above that is not shipped, with the part that is open."
            " A catalogue that grades something \"partly there\" and stops has told"
            " a reader that something is missing and not what.",
            "",
        ])
        for row in outstanding:
            mark = STATUSES[str(row["status"])][1]
            lines.append(f"**§{row['number']} {row['title']}** — {mark}. {row['note']}")
            lines.append("")

    lines.append(FEATURES_END)
    return "\n".join(lines)


def rewrite(document: str, block: str, *, name: str) -> str:
    start = document.find(FEATURES_BEGIN)
    finish = document.find(FEATURES_END)
    if start < 0 or finish < 0:
        raise SystemExit(
            f"{name} has no generated block. Add {FEATURES_BEGIN} and {FEATURES_END}."
        )
    return document[:start] + block + document[finish + len(FEATURES_END):]


TARGETS = ("docs/features.md", "docs/TODO.md")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="render-features")
    parser.add_argument("--check", action="store_true", help="fail if anything is stale")
    args = parser.parse_args(argv)

    found = problems()
    if found:
        print("The feature catalogue disagrees with the code:")
        for problem in found:
            print(f"  {problem}")
        return 1

    block = matrix()
    stale = []
    for name in TARGETS:
        target = ROOT / name
        current = target.read_text()
        wanted = rewrite(current, block, name=name)
        if args.check:
            if current != wanted:
                stale.append(name)
        else:
            target.write_text(wanted)

    if args.check:
        if stale:
            print(f"{', '.join(stale)} behind the feature catalogue; run this without --check.")
            return 1
        print(f"{' and '.join(TARGETS)} match the feature catalogue")
        return 0

    print(f"{' and '.join(TARGETS)}: matrix regenerated from the catalogue")
    return 0


if __name__ == "__main__":
    sys.exit(main())
