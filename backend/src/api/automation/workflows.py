"""Automations (§49).

Five endpoints, and the shape says what an automation is. A rule is read and
written like any record. `run` is its own endpoint because evaluating a rule is
not a change to the rule — it is an *event*, it can be a rehearsal, and it
returns what happened rather than the thing it happened to. And `runs` is
separate from the rule because the history outlives the rule's current shape:
somebody reading "why did this go quiet on Tuesday" is reading the run, not
the condition as it stands today.

`catalog` publishes the resources and the action kinds from the same
declarations the engine executes, so the editor cannot offer a rule the engine
would refuse (§76).
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.automation import workflows as service


@requires("automations.manage")
def rules(app=None, operation: str = "", request=None, **_: Any):
    """Every automation, or a new one."""
    principal = me()
    if request is not None and request.method == "POST":
        with session_scope() as session:
            return (
                service.create(session, request.get_json(silent=True), principal=principal),
                201,
            )

    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.list_rules(session, args, principal=principal), 200


@requires("automations.manage")
def rule(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """One automation with its recent runs, a change to it, or its withdrawal."""
    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return (
                service.update(
                    session, rule_id, request.get_json(silent=True), principal=principal
                ),
                200,
            )
        if request is not None and request.method == "DELETE":
            return service.remove(session, rule_id, principal=principal), 200
        return service.get(session, rule_id, principal=principal), 200


@requires("automations.manage")
def run(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """Evaluate now — a dry run by default, because that is the safe reading."""
    principal = me()
    with session_scope() as session:
        return (
            service.run_now(
                session, rule_id, request.get_json(silent=True) if request else None,
                principal=principal,
            ),
            200,
        )


@requires("automations.manage")
def runs(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """What this automation has done, most recent first."""
    principal = me()
    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return (
            service.runs(session, rule_id, principal=principal, limit=int(args.get("limit", 25))),
            200,
        )


@requires("automations.manage")
def catalog(app=None, operation: str = "", request=None, **_: Any):
    """What an automation may watch and what it may do."""
    principal = me()
    with session_scope() as session:
        return service.catalogue(session, principal=principal), 200


# ── The canvas (§49): a workflow as a node graph ─────────────────────────


@requires("automations.manage")
def graph(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """The canvas's draft, the published version, versions and run counts — or a saved draft."""
    from src.services.automation import graph as automation_graph

    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return (
                automation_graph.save_draft(
                    session, rule_id, request.get_json(silent=True), principal=principal
                ),
                200,
            )
        return automation_graph.detail(session, rule_id, principal=principal), 200


@requires("automations.manage")
def publish(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """Make the draft the version that runs; refused per node if it cannot run."""
    from src.services.automation import graph as automation_graph

    principal = me()
    with session_scope() as session:
        return (
            automation_graph.publish(
                session, rule_id, request.get_json(silent=True) if request else None,
                principal=principal,
            ),
            200,
        )


@requires("automations.manage")
def restore(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """Copy an earlier published version into the draft."""
    from src.services.automation import graph as automation_graph

    principal = me()
    with session_scope() as session:
        return (
            automation_graph.restore(
                session, rule_id, request.get_json(silent=True) if request else None,
                principal=principal,
            ),
            200,
        )


@requires("automations.manage")
def test(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """Walk one sample record through the draft, writing nothing."""
    from src.services.automation import graph as automation_graph

    principal = me()
    with session_scope() as session:
        return (
            automation_graph.trace(
                session, rule_id, request.get_json(silent=True) if request else None,
                principal=principal,
            ),
            200,
        )


@requires("automations.manage")
def samples(app=None, operation: str = "", request=None, rule_id=None, **_: Any):
    """Records to test with, from the trigger's dataset."""
    from src.services.automation import graph as automation_graph

    principal = me()
    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return automation_graph.samples(session, rule_id, args, principal=principal), 200


@requires("automations.manage")
def scheduler(app=None, operation: str = "", request=None, **_: Any):
    """Run scheduled workflows that are due, and resume delays that are over."""
    from src.services.automation import graph as automation_graph

    principal = me()
    with session_scope() as session:
        return automation_graph.run_scheduler(session, principal=principal), 200


def hook(app=None, operation: str = "", request=None, token=None, **_: Any):
    """A webhook trigger. The token in the address is the credential."""
    from src.services.automation import graph as automation_graph

    with session_scope() as session:
        return (
            automation_graph.fire_webhook(
                session, token, request.get_json(silent=True) if request else None
            ),
            202,
        )
