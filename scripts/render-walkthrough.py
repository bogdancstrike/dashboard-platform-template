#!/usr/bin/env python3
"""Render `docs/WALKTHROUGH.md` — the guided tour of the running platform (§77).

    backend/.venv/bin/python scripts/render-walkthrough.py
    backend/.venv/bin/python scripts/render-walkthrough.py --check

§77 asks that a developer who has never seen this repository can open it and
find a working example of each of eighteen capabilities — and that the whole
thing reads as *one application* rather than a gallery of disconnected demos.
Two halves, and neither is served by a feature list: `docs/features.md` already
says what exists and where, in the order the specification numbers things,
which is nobody's reading order.

So this is the tour. Eighteen stops in the order somebody meeting the platform
should walk them, each with the address, the persona to be signed in as, what
to do there, and — the part a feature list cannot carry — **what to notice**,
which is usually a decision rather than a widget.

Three things are verified rather than trusted, because a tour that sends a
reader to a page that does not exist is worse than no tour:

* every stop's route is one the router serves;
* every capability §77 lists is covered by at least one stop;
* every stop names a `proof` — a selector that is on the page when it is
  working — and `e2e/walkthrough.spec.ts` visits all of them as the persona
  named. A stop nobody can complete fails the browser suite.

The last stop is the second half of §77: one thread — a ticket, its customer,
their orders, the export of those, the audit entry for it — walked end to end,
because "reads as one application" is a claim about the links between the pages
rather than about any of them.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGET = ROOT / "docs/WALKTHROUGH.md"

#: The capabilities §77 names, in its own words. Every one must be covered.
CAPABILITIES: tuple[str, ...] = (
    "dashboards",
    "data tables",
    "search",
    "advanced filtering",
    "entity management",
    "administration",
    "reporting",
    "email",
    "task management",
    "monitoring",
    "file management",
    "notifications",
    "security settings",
    "audit logs",
    "background jobs",
    "multi-step forms",
    "master/detail",
    "reusable components",
)

#: The five demo personas, whose passwords are their usernames.
PERSONAS = ("admin", "manager", "operator", "analyst", "user")


def stop(
    title: str,
    route: str,
    persona: str,
    proof: str,
    covers: tuple[str, ...],
    do: str,
    notice: str,
    also: tuple[str, ...] = (),
) -> dict[str, object]:
    """One stop on the tour.

    `notice` is required and is the reason the file exists: "there is a table
    here" is something a reader can see, and "this table's filters are SQL, so
    the count in the header is the whole dataset rather than the page" is what
    they came to find out.
    """
    return {
        "title": title,
        "route": route,
        "persona": persona,
        "proof": proof,
        "covers": covers,
        "do": do,
        "notice": notice,
        "also": also,
    }


TOUR: list[dict[str, object]] = [
    stop(
        "The front page",
        "/dashboard",
        "admin",
        ".nu-chartcard",
        ("dashboards",),
        "Change the period. Click a bar in “Tickets by category”.",
        "Every number is computed in PostgreSQL over the whole dataset, not in the "
        "browser over a page of it — and every chart can be read as a table and "
        "downloaded, because a chart you cannot get the numbers out of is a chart "
        "people screenshot into a spreadsheet. Clicking a bar opens the records "
        "behind it with the filter already applied.",
        also=("/dashboards",),
    ),
    stop(
        "A list built for its subject",
        "/orders",
        "manager",
        "[data-testid='entity-total']",
        ("data tables", "entity management"),
        "Narrow it by status, sort by total, change the page size, then export it.",
        "Six entity pages share a contract and no layout: this one is a ledger with "
        "a running total, the fleet is a grid of health cards, the board is lanes. "
        "Filtering, sorting, paging and faceting all happen in SQL off one field "
        "declaration, the whole state is in the URL so the view can be pasted to a "
        "colleague, and the export writes the *question* rather than the page.",
        also=("/customers", "/devices", "/projects"),
    ),
    stop(
        "The queue somebody works",
        "/tickets",
        "operator",
        "[data-testid='ticket-queue']",
        ("entity management",),
        "Open the top ticket. Re-triage it from the console without opening a form.",
        "A support console rather than a record page: the clock leads, because the "
        "SLA is what decides what happens next, and the breach is the server's "
        "judgement rather than the browser's arithmetic. Every inline write carries "
        "the version it read, so an edit against a record somebody else has moved is "
        "refused and reloaded rather than silently applied over theirs.",
    ),
    stop(
        "Everything, from one box",
        "/find/global?q=migration",
        "analyst",
        "[data-testid='global-total']",
        ("search",),
        "The term is in the address, so the search is shareable. Change it, then "
        "press Ctrl-K anywhere and type it again.",
        "One endpoint searches every dataset the reader may see, ranked, with the "
        "matched words marked in the snippet. The palette is the same search plus "
        "the actions of the page you are on, which is why it is the fastest way to "
        "get anywhere in this application.",
    ),
    stop(
        "A question nobody anticipated",
        "/explore",
        "analyst",
        "[data-testid='explorer-match-count']",
        ("advanced filtering",),
        "Build a nested rule — severity is critical AND (assignee is empty OR the "
        "SLA has breached) — then save it as a view.",
        "The rule tree is compiled to SQL by the server, and the query inspector "
        "shows what it compiled to; the operators offered per field come from the "
        "same declaration that answers the query, so the builder cannot compose "
        "something the compiler rejects. A saved view is a saved search, so the "
        "thing the explorer saves is the thing the six lists reuse.",
        also=("/search/saved", "/compare"),
    ),
    stop(
        "Asking for a number, and drawing it",
        "/reports",
        "analyst",
        "[data-testid='reports']",
        ("reporting",),
        "Open a report, change its period, then open it in the chart builder and "
        "pick a different picture.",
        "A chart is a saved analysis and so is a report — one store, one sharing "
        "model, one lifecycle. The builders refuse a picture the current question "
        "cannot feed *by name* (“Heatmap — needs a second grouping”) rather than "
        "hiding it, and a saved chart goes onto a dashboard as a reference: the "
        "widget names the report and runs its stored definition.",
        also=("/analytics", "/reports/builder", "/charts/builder", "/maps"),
    ),
    stop(
        "A mailbox, as a master/detail page",
        "/mail",
        "manager",
        "[data-testid='mail-list']",
        ("email", "master/detail"),
        "Open a thread, reply, then use the keyboard: j and k move, Enter opens.",
        "Three panes that each own their scroll, the list keyed on the thread rather "
        "than the message, and the reading pane addressable — a thread has a URL. "
        "This is the shape to copy when the work is *working through* a queue rather "
        "than finding one record in it.",
        also=("/tickets", "/explore"),
    ),
    stop(
        "The work itself",
        "/tasks",
        "operator",
        "[data-testid='task-board']",
        ("task management",),
        "Drag a card between lanes, then do the same move from the keyboard. Tick a "
        "checklist item on the detail page.",
        "The drag is optimistic and reconciled against the server's answer, so a "
        "refused move is explained rather than quietly snapped back — and every lane "
        "is counted and paged by the server, so the numbers are the whole dataset. "
        "Everything the mouse can do here the keyboard can do too.",
        also=("/kanban", "/calendar", "/activity"),
    ),
    stop(
        "Files, and where the bytes are",
        "/files",
        "manager",
        "[data-testid='file-list']",
        ("file management",),
        "Drop a file in. Watch the network tab: the bytes do not go through the API.",
        "The browser uploads straight to object storage with a presigned URL and then "
        "tells the API the object is there, so a hundred-megabyte upload never "
        "occupies a worker. Previews are rendered from the same signed links, and a "
        "preview is deliberately not counted as a download.",
    ),
    stop(
        "What the platform wants to tell you",
        "/notifications",
        "admin",
        "[data-testid='notification-row']",
        ("notifications",),
        "Leave the page open and let something arrive. Then read the noticeboard.",
        "Notifications arrive over a WebSocket the server owns, fanned out across "
        "workers through Redis so it works with more than one; the unread count in "
        "the header is the same store. An announcement that needs agreement holds "
        "its band until it is acknowledged, and says who has.",
        also=("/announcements",),
    ),
    stop(
        "Multi-step, because the decision has parts",
        "/import",
        "manager",
        "[data-testid='import-start']",
        ("multi-step forms",),
        "Upload a CSV, map its columns, read the sample check, then run it.",
        "Nothing is written until the last step, and the check step is the point: it "
        "validates rows with the *same* function a form uses, so what the wizard "
        "accepts and what the API accepts cannot disagree. Compare it with the "
        "dashboard wizard, and with the modal that asks for a folder name — three "
        "sizes of decision, three shapes.",
        also=("/dashboards", "/showcase/templates"),
    ),
    stop(
        "Who am I, as the platform sees me",
        "/settings/security",
        "user",
        "[data-testid='security-headline']",
        ("security settings",),
        "Read the sessions. Revoke the others. Change the theme and the date format.",
        "Sessions are the identity provider's, so revoking one really ends it rather "
        "than clearing a row; the security events are the ledger's own. Preferences "
        "are per person and applied by the formatters every rendered date goes "
        "through, so “09/06/2026” means the same thing on every page.",
        also=("/settings/preferences", "/profile"),
    ),
    stop(
        "Running the place",
        "/admin",
        "admin",
        "[data-testid='admin-map']",
        ("administration",),
        "Add a permission to a role and watch a control change for that role.",
        "Roles are permission sets, the permissions are declared in one place in the "
        "backend, and `docs/RBAC.md` is *rendered* from that declaration rather than "
        "typed beside it. Every refusal in the product names the permission it "
        "wants, in the same sentence, and a control the reader may not use is "
        "disabled with the reason rather than hidden.",
        also=("/admin/users", "/admin/roles", "/admin/groups", "/admin/settings", "/admin/tags"),
    ),
    stop(
        "What happened, and who did it",
        "/admin/audit",
        "admin",
        "[data-testid='audit-total']",
        ("audit logs",),
        "Filter by actor, open one entry, and read the before-and-after.",
        "One ledger, written inside the same transaction as the change it records — "
        "so there is no state in which the change exists and the audit entry does "
        "not. Every record page's own history reads from it, which is why the two "
        "cannot disagree.",
    ),
    stop(
        "Work the platform does on its own",
        "/admin/jobs",
        "admin",
        "[data-testid='jobs-table']",
        ("background jobs",),
        "Find a failed job and read its error. Retry it.",
        "An export too large for a response becomes a job, and a job is a row with a "
        "status, an attempt count and its own error — visible rather than a log line "
        "somebody has to be told to grep for.",
    ),
    stop(
        "Whether it is healthy, and whether the data is",
        "/admin/quality",
        "admin",
        "[data-testid='quality-datasets']",
        ("monitoring",),
        "Read the findings, then open the rows behind one. Watch the log tail live.",
        "Data quality is computed from the declarations rather than from a hand-kept "
        "list of rules, so a new field is checked the day it ships. The health page "
        "separates *liveness* from *readiness* and says what degrades to what: a "
        "dashboard that 503s because a cache is down is worse than a slow dashboard.",
        also=("/admin/logs", "/admin/health", "/admin/integrations", "/admin/api"),
    ),
    stop(
        "The parts, and when to reach for each",
        "/showcase/components",
        "admin",
        "[data-testid='missing-table']",
        ("reusable components",),
        "Read what the page says it is *not* showing, and why.",
        "The component inventory and the page-layout gallery are both derived from "
        "the code — a hand-kept gallery is wrong by the third new page and then "
        "misleads everybody who reads it. Both say when each thing is the *wrong* "
        "answer, which is the half a pattern library usually omits.",
        also=("/showcase/templates",),
    ),
    stop(
        "One thread, through five pages",
        "/tickets",
        "manager",
        "[data-testid='ticket-queue']",
        ("entity management", "data tables"),
        "Open a ticket. Follow it to the customer who raised it, from there to their "
        "orders, export those, and find the export in the audit ledger.",
        "This is the half of §77 that a feature list cannot demonstrate. The links "
        "are the application: a ticket knows its account, an account knows its "
        "orders, an export knows the question it answered, and the ledger knows who "
        "asked. Nothing here is a demo of a widget — every page is holding the same "
        "dataset from a different angle.",
        also=("/customers", "/orders", "/exports", "/admin/audit"),
    ),
]


def _routes() -> set[str]:
    """Every concrete route the router serves.

    Both syntaxes, because the entity pages are declared as data rather than as
    JSX attributes — the trap the layout gallery's own completeness test fell
    into, where reading one form certified a hole.
    """
    source = (ROOT / "frontend/src/App.tsx").read_text()
    return {match.group(1) for match in re.finditer(r'path="([^"]+)"', source)} | {
        match.group(1) for match in re.finditer(r'path:\s*"([^"]+)"', source)
    }


def problems() -> list[str]:
    """Every way the tour disagrees with the application."""
    found: list[str] = []
    routes = _routes()

    for entry in TOUR:
        for address in (str(entry["route"]), *[str(item) for item in entry["also"]]):  # type: ignore[misc]
            # A stop may carry a query — "search for migration" is an address
            # with a term in it — and the router matches the path.
            if address.split("?")[0].lstrip("/") not in routes:
                found.append(f"{entry['title']} sends the reader to {address}, which is not a route")
        if str(entry["persona"]) not in PERSONAS:
            found.append(f"{entry['title']} names the persona {entry['persona']!r}, which is not one")
        if len(str(entry["notice"])) < 120:
            found.append(f"{entry['title']} says nothing worth noticing")

    covered = {name for entry in TOUR for name in entry["covers"]}  # type: ignore[misc]
    for capability in CAPABILITIES:
        if capability not in covered:
            found.append(f"§77 asks for {capability} and no stop covers it")
    for name in sorted(covered - set(CAPABILITIES)):
        found.append(f"a stop claims to cover {name!r}, which §77 does not ask for")
    return found


def document() -> str:
    lines = [
        "# Walking through the platform",
        "",
        "*Generated from `scripts/render-walkthrough.py`. Every route is checked",
        "against the router, every capability §77 asks for is covered by a stop, and",
        f"`frontend/e2e/walkthrough.spec.ts` walks all {len(TOUR)} of them in a",
        "browser as the persona named — so a stop nobody can complete fails the",
        "suite rather than the reader.*",
        "",
        "Start the stack with `make up` and sign in at",
        "[localhost:5174](http://localhost:5174). The five demo personas are",
        "`admin`, `manager`, `operator`, `analyst` and `user`; each password is the",
        "username. Sign in as the one each stop names — the platform looks different",
        "to each of them on purpose, and being refused something is part of the tour.",
        "",
        f"The last stop is the point of the other {len(TOUR) - 1}: the same dataset,",
        "held from five angles, with the links between them doing the work.",
        "",
        "| # | Stop | Where | As |",
        "| --- | --- | --- | --- |",
    ]
    for index, entry in enumerate(TOUR, start=1):
        lines.append(
            f"| {index} | [{entry['title']}](#{index}-{_slug(str(entry['title']))}) "
            f"| `{entry['route']}` | `{entry['persona']}` |"
        )
    lines.append("")

    for index, entry in enumerate(TOUR, start=1):
        lines.extend([
            f"## {index}. {entry['title']}",
            "",
            f"**Where** `{entry['route']}` · **As** `{entry['persona']}` · "
            f"**Shows** {', '.join(str(name) for name in entry['covers'])}  ",  # type: ignore[misc]
            "",
            f"**Do this.** {entry['do']}",
            "",
            f"**Notice.** {entry['notice']}",
            "",
        ])
        if entry["also"]:
            addresses = ", ".join(f"`{item}`" for item in entry["also"])  # type: ignore[misc]
            lines.extend([f"**Also worth opening.** {addresses}", ""])

    lines.extend([
        "---",
        "",
        "## What this leaves out",
        "",
        "The error pages, deliberately: `/errors/404`, `/errors/403` and the rest are",
        "reachable and worth two minutes, but a tour that ends on a 500 reads oddly.",
        "The same goes for `/favorites` and `/find/relationships`, which are better",
        "found by using the platform for an hour than by being pointed at.",
        "",
        "For what exists rather than what to look at, `docs/features.md` maps every",
        "section of the specification to its route and its endpoints. For why things",
        "are built the way they are, the README's *decisions worth knowing* and the",
        "notes at the top of each module.",
        "",
    ])
    return "\n".join(lines)


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="render-walkthrough")
    parser.add_argument("--check", action="store_true", help="fail if the tour is stale")
    args = parser.parse_args(argv)

    found = problems()
    if found:
        print("The walkthrough disagrees with the application:")
        for problem in found:
            print(f"  {problem}")
        return 1

    wanted = document()
    current = TARGET.read_text() if TARGET.exists() else ""
    if args.check:
        if current != wanted:
            print("docs/WALKTHROUGH.md is behind the tour; run this without --check.")
            return 1
        print(f"docs/WALKTHROUGH.md matches the tour ({len(TOUR)} stops)")
        return 0

    TARGET.write_text(wanted)
    print(f"docs/WALKTHROUGH.md: {len(TOUR)} stops rendered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
