"""Seed data for catalog: REPORT_NAMES, KANBAN_BOARDS, KANBAN_PIECES."""

from __future__ import annotations

REPORT_NAMES: tuple[tuple[str, str, str], ...] = (
    ("Revenue by region", "order", "bar"),
    ("Ticket volume by category", "ticket", "line"),
    ("Project health overview", "project", "pie"),
    ("Task throughput by team", "task", "bar"),
    ("Customer lifetime value", "customer", "table"),
    ("Orders by channel", "order", "pie"),
    ("SLA compliance trend", "ticket", "line"),
    ("Device uptime by site", "device", "bar"),
    ("Storage growth", "file", "area"),
    ("Sign-in activity", "user", "line"),
)


#: Kanban boards, and the epics on each (§18).
#:
#: `(board name, key, [(epic, [story, ...]), ...])`. Written out because a
#: board is a *plan*: an epic called "Epic 3" with a story called "Story 7"
#: under it demonstrates a hierarchy and nothing about why anybody would use
#: one. These read like work somebody is actually doing.
KANBAN_BOARDS: tuple[tuple[str, str, tuple[tuple[str, tuple[str, ...]], ...]], ...] = (
    (
        "Platform delivery", "PLAT",
        (
            (
                "Self-service reporting",
                (
                    "Save a chart from the builder",
                    "Share a report with named colleagues",
                    "Schedule a report to arrive on Monday",
                ),
            ),
            (
                "Single sign-on rollout",
                (
                    "Map Keycloak groups to platform roles",
                    "Retire password sign-in for service accounts",
                    "Document the break-glass procedure",
                ),
            ),
            (
                "Performance of the record pages",
                (
                    "Index the activity feed's resource lookup",
                    "Stream exports instead of buffering them",
                ),
            ),
        ),
    ),
    (
        "Support improvements", "SUP",
        (
            (
                "First-response time",
                (
                    "Route tickets by category on arrival",
                    "Alert on a ticket nobody has answered in an hour",
                ),
            ),
            (
                "Customer self-service",
                (
                    "Publish the status page",
                    "Let a customer reopen their own ticket",
                ),
            ),
        ),
    ),
    (
        "Field operations", "FIELD",
        (
            (
                "Device fleet visibility",
                (
                    "Report battery health per site",
                    "Flag a gateway that has not checked in",
                ),
            ),
            (
                "Installer handbook",
                ("Photograph every cabinet layout", "Write the commissioning checklist"),
            ),
        ),
    ),
    (
        "Onboarding", "ONB",
        (
            (
                "First week that works",
                (
                    "Pre-create the accounts a new starter needs",
                    "One page that says where everything is",
                ),
            ),
        ),
    ),
)


#: The tasks and bugs a story is broken into. Generic on purpose — these are
#: the small pieces, and their titles are the same shape whatever the story.
KANBAN_PIECES: tuple[tuple[str, str], ...] = (
    ("TASK", "Design the change"),
    ("TASK", "Write it"),
    ("TASK", "Cover it with tests"),
    ("TASK", "Update the documentation"),
    ("BUG", "Fix the edge case found in review"),
    ("TASK", "Roll it out behind a flag"),
)


KANBAN_LABELS: tuple[str, ...] = (
    "backend", "frontend", "infrastructure", "documentation",
    "customer-request", "tech-debt", "security", "accessibility",
)


#: Saved searches of the kind a *list's filter bar* saves: a name, its dataset,
#: and the one plain field filter it keeps (§46).
#:
#: Separate from `SAVED_SEARCH_NAMES` above, whose rows carry a condition tree
#: because they are the Data Explorer's. The distinction is load-bearing rather
#: than decorative: a tree cannot be shown as a row of facet selects, so a
#: dataset whose only saved searches came from the rule builder has a views
#: menu that can offer nothing but links back to the explorer. One of these per
#: dataset is what makes "open the list the way I saved it" demonstrable.
#:
#: Every field named here is one its page offers as a facet, and every value is
#: `core.vocabulary`'s own — so applying one shows the chip that produced it.
LIST_VIEWS: tuple[tuple[str, str, str, str], ...] = (
    ("High-priority tasks", "task", "priority", "HIGH"),
    ("Critical tickets", "ticket", "severity", "CRITICAL"),
    ("Churned customers", "customer", "lifecycle_stage", "CHURNED"),
    ("Off-track projects", "project", "health", "OFF_TRACK"),
    ("Unpaid orders", "order", "payment_status", "UNPAID"),
    ("Offline devices", "device", "status", "OFFLINE"),
)


SAVED_SEARCH_NAMES: tuple[tuple[str, str], ...] = (
    ("My overdue tasks", "task"),
    ("Critical open tickets", "ticket"),
    ("Enterprise customers at risk", "customer"),
    ("Projects off track", "project"),
    ("Unpaid orders over 30 days", "order"),
    ("Devices offline this week", "device"),
    ("High-value orders this quarter", "order"),
    ("Tickets breaching SLA", "ticket"),
    ("Recently churned customers", "customer"),
    ("Blocked tasks", "task"),
)
