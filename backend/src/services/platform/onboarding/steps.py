"""Onboarding steps per role, and what marks each done."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select

SAMPLE_PERMISSION = "admin.access"


CARD_KEY = "card"


STATES = ("DONE", "SKIPPED")


@dataclass(frozen=True)
class Step:
    key: str
    title: str
    description: str
    to: str
    action: str
    #: Who may see the step at all (beyond the role list).
    permission: str | None = None
    #: How it ticks itself off: (session, user_id) -> bool.
    check: Callable[..., bool] | None = None


def _audited(resource_type: str, *actions: str) -> Callable[..., bool]:
    def check(session, user_id) -> bool:
        from src.models.platform import AuditLog

        statement = select(AuditLog.id).where(AuditLog.actor_id == user_id, AuditLog.resource_type == resource_type)
        if actions:
            statement = statement.where(AuditLog.action.in_(actions))
        return session.scalar(statement.limit(1)) is not None
    return check


def _owns(model_path: str, column: str = "owner_id", **extra: Any) -> Callable[..., bool]:
    def check(session, user_id) -> bool:
        module, name = model_path.rsplit(".", 1)
        model = getattr(__import__(module, fromlist=[name]), name)
        statement = select(model.id).where(getattr(model, column) == user_id)
        for key, value in extra.items():
            statement = statement.where(getattr(model, key) == value)
        return session.scalar(statement.limit(1)) is not None
    return check


def _any(model_path: str, **where: Any) -> Callable[..., bool]:
    def check(session, _user_id) -> bool:
        module, name = model_path.rsplit(".", 1)
        model = getattr(__import__(module, fromlist=[name]), name)
        statement = select(model.id)
        for key, value in where.items():
            statement = statement.where(getattr(model, key) == value)
        return session.scalar(statement.limit(1)) is not None
    return check


def _profile(session, user_id) -> bool:
    from src.models.identity import User

    user = session.get(User, user_id)
    return bool(user and (user.job_title or user.phone) and (user.profile_completeness or 0) >= 80)


def _published_workflow(session, user_id) -> bool:
    from src.models.automation_graphs import AutomationVersion

    return session.scalar(select(AutomationVersion.id).where(AutomationVersion.published_by_id == user_id).limit(1)) is not None


S = {
    "profile": Step("profile", "Complete your profile", "A job title and a phone number help colleagues know who to ask.",
                    "/profile", "Open profile", check=_profile),
    "tour": Step("tour", "Take a page tour", "Press Help & page tour on any page — every stop explains why, not what.",
                 "/home", "Open Home"),
    "favorite": Step("favorite", "Star something you use daily", "Favourites sit on Home and in the palette.",
                     "/favorites", "Open favourites", check=_owns("src.models.personal.Favorite", "user_id")),
    "invite": Step("invite", "Invite your team", "Add the people who will work here; they sign in with their own account.",
                   "/admin/users", "Open users", "users.manage", _audited("user", "CREATE", "INVITE")),
    "roles": Step("roles", "Set roles and permissions", "Decide what each role may see and do — the matrix is the whole policy.",
                  "/admin/roles", "Open roles", "roles.manage", _audited("role")),
    "integration": Step("integration", "Connect an integration", "Mail, storage or an external system — configured once, used everywhere.",
                        "/admin/integrations", "Open integrations", "integrations.manage",
                        _any("src.models.platform.Integration", enabled=True)),
    "sla": Step("sla", "Configure an SLA policy", "Targets per priority with business hours, so tickets show when they are late.",
                "/admin/sla", "Open SLA policies", None, _audited("sla_policy")),
    "api_client": Step("api_client", "Register an API client", "A key for the systems that call this platform; usage is charted per client.",
                       "/admin/api", "Open API clients", "api.manage", _owns("src.models.platform.ApiClient")),
    "workflow": Step("workflow", "Publish a workflow", "Draw one on the canvas: a trigger, a condition, an action — then publish.",
                     "/workflows", "Open workflows", "automations.manage", _published_workflow),
    "dashboard": Step("dashboard", "Create a dashboard", "Pin the numbers your team watches; share it when it is right.",
                      "/dashboards", "Open dashboards", "dashboards.manage", _owns("src.models.personal.Dashboard")),
    "board": Step("board", "Set up a board", "A kanban board for the team's work, lanes and limits your way.",
                  "/kanban", "Open boards", "tasks.view", _owns("src.models.kanban.Board")),
    "sprint": Step("sprint", "Plan a sprint", "Drag backlog work into a sprint and start it.", "/sprints", "Open sprints",
                   "tasks.view", _owns("src.models.planning.Sprint", "created_by_id")),
    "triage": Step("triage", "Triage a ticket", "Pick one from the queue, set its priority and assignee.", "/tickets",
                   "Open tickets", "records.update", _audited("ticket", "UPDATE", "STATUS_CHANGE")),
    "complete_task": Step("complete_task", "Move a task forward", "Change a task's status on the board or its page.",
                          "/tasks", "Open tasks", "records.update", _audited("task", "UPDATE", "STATUS_CHANGE")),
    "log_time": Step("log_time", "Log time", "Start the timer in the header, or add an entry to your timesheet.", "/time",
                     "Open time", "time.track", _owns("src.models.timekeeping.TimeEntry", "user_id")),
    "comment": Step("comment", "Leave a comment", "Mention a colleague on a record; they are notified live.", "/tasks",
                    "Open tasks", "records.comment", _owns("src.models.content.Comment", "author_id")),
    "search": Step("search", "Save a search", "Build a query in the Data Explorer and save it for later.", "/explore",
                   "Open the explorer", "records.view", _owns("src.models.personal.SavedSearch")),
    "report": Step("report", "Build a report", "Group, measure and chart — then save or schedule it.", "/reports/builder",
                   "Open the report builder", "reports.manage", _owns("src.models.personal.Report")),
}


ROLES: dict[str, tuple[str, ...]] = {
    "ADMINISTRATOR": ("profile", "invite", "roles", "integration", "sla", "api_client", "workflow", "tour"),
    "MANAGER": ("profile", "dashboard", "board", "sprint", "workflow", "comment", "tour"),
    "OPERATOR": ("profile", "triage", "complete_task", "log_time", "comment", "favorite"),
    "ANALYST": ("profile", "search", "report", "dashboard", "favorite", "tour"),
    "VIEWER": ("profile", "favorite", "search", "tour"),
}


def _steps_for(principal) -> list[Step]:
    keys = ROLES.get(principal.role_code, ROLES["VIEWER"])
    return [S[key] for key in keys if S[key].permission is None or principal.can(S[key].permission)]
