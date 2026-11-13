"""Seed data for collab: Script."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

PERSONAS = ("admin", "manager", "operator", "analyst", "user")


#: (name, topic, visibility, extra members beyond the personas)
CHANNELS: tuple[tuple[str, str, str, int], ...] = (
    ("general", "Company-wide announcements and the things everybody should know", "PUBLIC", 14),
    ("engineering", "Builds, releases, incidents and the occasional architecture argument", "PUBLIC", 8),
    ("support-desk", "Ticket triage, escalations and customer context", "PUBLIC", 6),
    ("sales", "Pipeline, renewals and what customers are asking for", "PUBLIC", 5),
    ("random", "Coffee, cats and weekend plans", "PUBLIC", 10),
    ("leadership", "Planning and people topics for the leadership team", "PRIVATE", 0),
)


# Each script: (minutes ago, author key, body, reactions {emoji: [author keys]}, replies)
# Author keys are persona usernames, or "p<n>" for the nth extra member.
Script = list[tuple[int, str, str, dict[str, list[str]], list[tuple[int, str, str]]]]


SCRIPTS: dict[str, Script] = {
    "general": [
        (60 * 24 * 6, "admin", "Welcome to **#general** — this is where company-wide news lands. "
         "Use threads for follow-ups so the channel stays readable.", {"👍": ["manager", "p1", "p2"], "🎉": ["p3"]}, []),
        (60 * 24 * 5, "manager", "Reminder: quarterly planning starts Monday. Agendas are in the wiki under "
         "*Product → Q4 roadmap*.", {"👀": ["operator", "analyst"]}, [
            (60 * 24 * 5 - 30, "analyst", "Will the capacity numbers be ready by then?"),
            (60 * 24 * 5 - 20, "manager", "@Ana Analyst yes — I'll share the sheet on Friday."),
        ]),
        (60 * 24 * 3, "p2", "The office Wi-Fi maintenance is tonight from 22:00 to 23:00.", {"🙏": ["p4", "user"]}, []),
        (60 * 24 * 1, "operator", "Support queue is back under 40 open tickets for the first time this month 🎉",
         {"🔥": ["admin", "manager", "p1"], "👏": ["analyst"]}, []),
        (60 * 5, "p1", "Lunch & learn on Thursday: `feature flags in practice`. Bring questions!", {"🚀": ["p3"]}, []),
        (95, "manager", "@Ada Administrator can you confirm the board deck is final before 4pm?", {}, []),
        (40, "analyst", "Dashboards for the all-hands are refreshed — the *tickets by priority* chart now "
         "includes last week.", {"✅": ["manager"]}, []),
        (12, "p3", "Has anyone seen the projector remote from room 4?", {"😄": ["p2"]}, []),
    ],
    "engineering": [
        (60 * 24 * 4, "p1", "Release **2.14** is tagged. Changelog: faster explorer queries, the new "
         "calendar drawer, and the export fix.", {"🚀": ["admin", "p2", "p3"]}, [
            (60 * 24 * 4 - 15, "p2", "Smoke tests are green on staging."),
            (60 * 24 * 4 - 10, "admin", "Nice. Ship it after the 14:00 freeze lifts."),
        ]),
        (60 * 24 * 2, "admin", "Heads up: the on-call runbook moved to the wiki — *Engineering → On-call "
         "runbook*. Please read the escalation section.", {"👀": ["p1", "p4"]}, []),
        (60 * 6, "p4", "Seeing elevated p95 on the search endpoint since the morning deploy. Investigating.",
         {"👀": ["admin", "p1"]}, [
            (60 * 6 - 25, "p1", "Probably the new index build — it finishes around noon."),
            (60 * 5, "p4", "Confirmed, back to normal now ✅"),
        ]),
        (180, "p2", "Code review queue: 3 PRs waiting on a second reviewer. @Ada Administrator could you "
         "take the auth one?", {}, []),
        (25, "p3", "Staging database will be refreshed from production snapshots at 18:00.", {"👍": ["p1"]}, []),
    ],
    "support-desk": [
        (60 * 24 * 2, "operator", "Escalating a billing dispute from a key account — details in the ticket "
         "thread.", {"👀": ["manager"]}, []),
        (60 * 20, "p1", "Macro for password resets updated with the new self-service link.", {"🙏": ["operator", "p2"]}, []),
        (60 * 3, "operator", "@Mara Manager two P1 tickets are close to breaching SLA, can we pull someone "
         "from the backlog?", {}, [
            (60 * 3 - 10, "manager", "Yes — moving Priya over for the afternoon."),
        ]),
        (55, "p2", "Customer confirmed the fix on the export issue, closing it out.", {"✅": ["operator"]}, []),
    ],
    "sales": [
        (60 * 24 * 3, "manager", "Renewals due this month are tagged in the customer list — please update "
         "the forecast by Wednesday.", {"👍": ["p1", "p2"]}, []),
        (60 * 7, "p1", "Closed the expansion with the logistics account 🎉", {"🎉": ["manager", "p2", "p3"], "🔥": ["admin"]}, []),
        (60 * 2, "p2", "Prospect asked for a security questionnaire — who owns that now?", {}, [
            (60 * 2 - 15, "manager", "@Ana Analyst has the latest answers."),
        ]),
    ],
    "random": [
        (60 * 24 * 2, "p5", "Weekend photo thread 📷", {"❤️": ["p1", "p2", "user"]}, [
            (60 * 24 * 2 - 40, "p1", "Hiked up the ridge on Saturday, finally clear skies."),
        ]),
        (60 * 9, "user", "Is the coffee machine on the 3rd floor fixed yet?", {"😢": ["p3"]}, []),
        (30, "p3", "It is! New beans too ☕", {"🙏": ["user"], "😄": ["p5"]}, []),
    ],
    "leadership": [
        (60 * 24 * 1, "admin", "Draft headcount plan is in the leadership space — comments welcome before "
         "Friday.", {"👀": ["manager"]}, []),
        (70, "manager", "Added notes on the support team. @Ada Administrator let's review tomorrow at 10.", {}, []),
    ],
}


DIRECTS: tuple[tuple[str, str, list[tuple[int, str, str]]], ...] = (
    ("admin", "manager", [
        (60 * 26, "manager", "Do you have ten minutes before the steering meeting?"),
        (60 * 25, "admin", "Sure, call me after lunch."),
        (18, "manager", "Board deck v3 is in the shared folder — the revenue slide changed."),
    ]),
    ("admin", "operator", [
        (60 * 4, "operator", "The import job failed again overnight, I re-ran it manually."),
        (60 * 3, "admin", "Thanks — I'll look at the retry policy."),
    ]),
    ("manager", "analyst", [
        (60 * 30, "manager", "Can you add churn to the weekly report?"),
        (60 * 29, "analyst", "Yes, it'll be in Monday's run."),
    ]),
)


#: How far the admin persona has read, per channel — so the demo opens with
#: something unread and a mention waiting.
ADMIN_READ_MINUTES_AGO = {"general": 100, "engineering": 200, "support-desk": 0, "sales": 0,
                          "random": 60 * 10, "leadership": 0}


def _people(session) -> tuple[dict[str, Any], list[Any]]:
    from src.models.identity import User

    personas = {
        user.username: user
        for user in session.scalars(select(User).where(User.username.in_(PERSONAS))).all()
    }
    others = session.scalars(
        select(User)
        .where(User.username.notin_(PERSONAS), User.deleted_at.is_(None), User.status == "ACTIVE")
        .order_by(User.created_at, User.username)
        .limit(24)
    ).all()
    return personas, list(others)


def _who(key: str, personas: dict[str, Any], others: list[Any]):
    if key.startswith("p") and key[1:].isdigit():
        index = int(key[1:]) - 1
        return others[index % len(others)] if others else next(iter(personas.values()))
    return personas.get(key) or next(iter(personas.values()))


def _comment(session, *, channel_id: str, author, body: str, at, parent_id=None, reactions=None):
    from src.models.content import Comment
    from src.services.collaboration.comments import _mentioned

    row = Comment(
        resource_type="chat_channel", resource_id=channel_id, parent_id=parent_id,
        author_id=author.id, body=body, mentions=_mentioned(session, body),
        reactions=reactions or None, created_at=at, updated_at=at,
    )
    session.add(row)
    session.flush()
    return row
