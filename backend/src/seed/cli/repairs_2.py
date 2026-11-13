"""Seed repair commands: --sync-favorites … --sync-activity (idempotent, for a database seeded before a feature)."""

from __future__ import annotations

from framework.commons.logger import logger as log  # noqa: F401

from src.core.db import get_engine, session_scope  # noqa: F401
from src.seed import runner  # noqa: F401
from src.seed.world import SCALES  # noqa: F401


def sync_favorites(args, engine) -> int:
    """--sync-favorites."""
    # Two stores for one fact: the per-row `is_favorite` flags move into
    # `favorites` and the columns are cleared. Idempotent.
    with session_scope() as session:
        result = runner.sync_favorites(session)
    print(
        f"{result['moved']} star(s) moved into favourites, "
        f"{result['already_bookmarked']} already there"
    )
    return 0


def sync_tags(args, engine) -> int:
    """--sync-tags."""
    # The array is a *derived* cache of `tag_links` with one writer. This
    # brings a database that predates that rule into line: it rewrites the
    # array wherever there are links and clears it wherever there are not,
    # because a string left behind after its link went is the stale value
    # the single-writer rule exists to prevent. Idempotent.
    with session_scope() as session:
        result = runner.sync_tags(session)
    print(
        f"{result['rewritten']} record(s) rewritten from their links, "
        f"{result['cleared']} stale array(s) cleared, "
        f"{result['recounted']} usage count(s) corrected"
    )
    return 0


def sync_searches(args, engine) -> int:
    """--sync-searches."""
    # A saved search whose filters name a field no dataset declares is a
    # filter that narrows nothing — invisible until the entity lists could
    # apply one (§46). And a dataset whose saved searches all carry
    # condition trees has a views menu that can only link elsewhere, so the
    # six list views are added if they are missing. Additive, idempotent.
    with session_scope() as session:
        result = runner.sync_searches(session)
    print(
        f"{result['cleaned']} saved search(es) had unusable filter keys removed, "
        f"{result['added']} list view(s) added"
    )
    return 0


def sync_sessions(args, engine) -> int:
    """--sync-sessions."""
    # `is_current` is derived from the most recent live sign-in, and the
    # seed used to mark the first five sessions of every user. Idempotent.
    with session_scope() as session:
        result = runner.sync_sessions(session)
    print(
        f"{result['corrected']} session flag(s) corrected across "
        f"{result['people']} people"
    )
    return 0


def sync_roles(args, engine) -> int:
    """--sync-roles."""
    # Not part of a seed run: this is what an *existing* database needs
    # when the permission catalogue grows, and seeding refuses to touch a
    # populated one.
    with session_scope() as session:
        added = runner.sync_roles(session)
    for code, permissions in sorted(added.items()):
        print(f"  {code}: +{', '.join(permissions)}")
    print("roles already match the catalogue" if not added else "roles updated")
    return 0


def sync_reports(args, engine) -> int:
    """--sync-reports."""
    # Every report seeded before the generator derived its columns from
    # the declarations names a column that does not exist, and `--check`
    # reports them. This is the way out that is not a destructive reseed.
    with session_scope() as session:
        result = runner.sync_reports(session)
    print(
        f"{result['repaired']} report(s) repaired"
        + (f", {result['orphaned']} on a dataset that no longer exists" if result["orphaned"] else "")
    )
    return 0


def sync_automations(args, engine) -> int:
    """--sync-automations."""
    # The report repair's sibling (§49). A rule watching a dataset that
    # does not exist is paused rather than left claiming to be live: a
    # monitor that cannot look reports quiet, which is indistinguishable
    # from good news.
    with session_scope() as session:
        result = runner.sync_automations(session)
    print(
        f"{result['repaired']} automation(s) repaired"
        + (f", {result['paused']} paused for want of a dataset" if result["paused"] else "")
    )
    return 0


def sync_mailboxes(args, engine) -> int:
    """--sync-mailboxes."""
    # The mailbox generator's folder draw is random and left the
    # administrator's inbox empty at the small scale — an empty inbox on a
    # demo reads as a broken feature. Additive and idempotent: it counts
    # what is there and only inserts what is missing.
    with session_scope() as session:
        result = runner.sync_mailboxes(session)
    print(
        f"{result['added']} thread(s) added across {result['personas']} persona(s)"
        if result["added"]
        else "every persona already has an inbox"
    )
    return 0


def sync_org(args, engine) -> int:
    """--sync-org."""
    # An *edit*, unlike the other repairs — safe because the column is
    # derived: `users.department_id` is the truth, and this only stops the
    # cached copy contradicting it.
    with session_scope() as session:
        result = runner.sync_org(session)
    print(
        f"{result['corrected']} departments recounted"
        if result["corrected"]
        else "every department already agrees with its people"
    )
    return 0


def sync_flags(args, engine) -> int:
    """--sync-flags, --reset-flags."""
    # A rollout percentage is how a team ships something gradually, and the
    # seed was applying one to finished features — so `/dashboards` was
    # missing from the navigation of every demo persona (§27). Only ever
    # turns one *on*: somebody who switched a flag off made a decision.
    with session_scope() as session:
        result = runner.sync_flags(session, reset=args.reset_flags)
    print(
        f"flags: {result['created']} created, {result['reset']} reset to default, "
        f"{result['relabelled']} relabelled, {result['removed']} retired "
        f"({result['checked']} in the catalogue)"
    )
    return 0


def sync_activity(args, engine) -> int:
    """--sync-activity."""
    # The history was drawn from one flat pool of every record, so a
    # dataset was the subject of an event in proportion to its volume —
    # and once scoped to an organization, the administrator's own project
    # filter matched nothing (§34). Additive: an entry records something
    # that happened, and rewriting one would be a lie about the past.
    with session_scope() as session:
        result = runner.sync_activity(session)
    print(
        f"{result['added']} entries added across {result['organizations']} organizations"
        if result["added"]
        else "every organization can already filter the feed by any dataset"
    )
    return 0
