"""Work planning endpoints: timeline, sprints, backlog, templates, recurrence (§18).

Thin by design — every decision is in the services (`timeline`, `sprints`,
`task_planning`, `task_templates`). Reads need `tasks.view`; the writes that
change a task's own fields (dates, dependencies) need `records.update`, like
every record write; planning the team's work (sprints, templates, recurrence,
lane limits) needs `tasks.manage`.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import sprints, task_planning, task_templates, timeline as timeline_service


def _method(request) -> str:
    return request.method if request is not None else "GET"


def _args(request) -> dict[str, Any]:
    return request.args.to_dict() if request is not None else {}


def _json(request) -> Any:
    return request.get_json(silent=True) if request is not None else None


def _catch_up() -> None:
    """Start an overdue planning job off this request (see `task_templates`)."""
    with session_scope() as session:
        task_templates.catch_up(session)


# ── tasks ────────────────────────────────────────────────────────────────


@requires("tasks.view")
def task_planning_detail(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    with session_scope() as session:
        return task_planning.planning(session, task_id, principal=me()), 200


@requires("records.view")
def task_schedule(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    with session_scope() as session:
        return timeline_service.schedule(session, task_id, _json(request), principal=me()), 200


@requires("tasks.view")
def task_watchers(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    on = _method(request) != "DELETE"
    with session_scope() as session:
        return task_planning.watch(session, task_id, _json(request), principal=me(), on=on), 200


@requires("tasks.view")
def task_recurrence(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if _method(request) == "PUT":
            return task_templates.set_recurrence(session, task_id, _json(request), principal=principal), 200
        if _method(request) == "DELETE":
            return task_templates.clear_recurrence(session, task_id, principal=principal), 200
        return task_templates.recurrence(session, task_id, principal=principal), 200


@requires("tasks.view")
def task_save_as_template(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    with session_scope() as session:
        return task_templates.save_as_template(session, task_id, _json(request), principal=me()), 201


# ── the plan ─────────────────────────────────────────────────────────────


@requires("tasks.view")
def timeline(app=None, operation: str = "", request=None, **_: Any):
    _catch_up()
    with session_scope() as session:
        return timeline_service.timeline(session, _args(request), principal=me()), 200


@requires("tasks.view")
def dependencies(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return timeline_service.link(session, _json(request), principal=me()), 201


@requires("tasks.view")
def dependency(app=None, operation: str = "", request=None, dependency_id=None, **_: Any):
    with session_scope() as session:
        return timeline_service.unlink(session, dependency_id, principal=me()), 200


@requires("tasks.view")
def backlog(app=None, operation: str = "", request=None, **_: Any):
    _catch_up()
    with session_scope() as session:
        return sprints.backlog(session, _args(request), principal=me()), 200


@requires("tasks.view")
def backlog_place(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return sprints.place(session, _json(request), principal=me()), 200


@requires("tasks.view")
def sprint_collection(app=None, operation: str = "", request=None, **_: Any):
    principal = me()
    if _method(request) == "POST":
        with session_scope() as session:
            return sprints.create(session, _json(request), principal=principal), 201
    _catch_up()
    with session_scope() as session:
        return sprints.listing(session, _args(request), principal=principal), 200


@requires("tasks.view")
def sprint_item(app=None, operation: str = "", request=None, sprint_id=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if _method(request) == "PUT":
            return sprints.update(session, sprint_id, _json(request), principal=principal), 200
        if _method(request) == "DELETE":
            return sprints.remove(session, sprint_id, principal=principal), 200
        return sprints.detail(session, sprint_id, principal=principal), 200


@requires("tasks.view")
def sprint_start(app=None, operation: str = "", request=None, sprint_id=None, **_: Any):
    with session_scope() as session:
        return sprints.start(session, sprint_id, _json(request), principal=me()), 200


@requires("tasks.view")
def sprint_complete(app=None, operation: str = "", request=None, sprint_id=None, **_: Any):
    with session_scope() as session:
        return sprints.complete(session, sprint_id, _json(request), principal=me()), 200


@requires("tasks.view")
def velocity(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return sprints.velocity(session, _args(request), principal=me()), 200


@requires("tasks.view")
def epics(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return task_planning.epics(session, _args(request), principal=me()), 200


@requires("tasks.view")
def lanes(app=None, operation: str = "", request=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if _method(request) == "PUT":
            return task_planning.set_lanes(session, _json(request), principal=principal), 200
        return task_planning.lanes(session, principal=principal), 200


@requires("tasks.view")
def template_collection(app=None, operation: str = "", request=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if _method(request) == "POST":
            return task_templates.create_template(session, _json(request), principal=principal), 201
        return task_templates.templates(session, _args(request), principal=principal), 200


@requires("tasks.view")
def template_item(app=None, operation: str = "", request=None, template_id=None, **_: Any):
    principal = me()
    with session_scope() as session:
        if _method(request) == "PUT":
            return task_templates.update_template(session, template_id, _json(request), principal=principal), 200
        if _method(request) == "DELETE":
            return task_templates.remove_template(session, template_id, principal=principal), 200
        return task_templates.template(session, template_id, principal=principal), 200


@requires("tasks.view")
def template_use(app=None, operation: str = "", request=None, template_id=None, **_: Any):
    with session_scope() as session:
        return task_templates.use_template(session, template_id, _json(request), principal=me()), 201


@requires("tasks.view")
def scheduler_run(app=None, operation: str = "", request=None, **_: Any):
    with session_scope() as session:
        return task_templates.run_now(session, principal=me()), 200
