"""The mailbox (§14–§16).

Six endpoints. `bulk` is its own rather than a loop of `PUT`s in the browser:
fifty round trips for one gesture, each able to fail on its own, is a bulk
action that leaves the list in a state nobody chose.

Composing is a `POST` to the *messages* collection and not to a thread,
because a new message may start one. A reply carries `thread_id` and joins the
conversation it names — the same endpoint, because a reply is the same thing.

Every one of these needs `mail.access` and nothing more. A mailbox belongs to
exactly one person, so nobody can read somebody else's and nobody can write to
one: the second permission would only ever be checked against itself.
"""

from __future__ import annotations

from typing import Any

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.core.pagination import parse_page
from src.services.collaboration import mail as service


@requires("mail.access")
@endpoint
def threads(call: Call):
    """One folder of this reader's mailbox."""
    principal = me()
    args = call.args
    with session_scope() as session:
        return (
            service.threads(
                session,
                args,
                parse_page(args, default_sort="last_message_at"),
                principal=principal,
            ),
            200,
        )


@requires("mail.access")
@endpoint
def thread(call: Call, thread_id=None):
    """One conversation with its messages, a change to it, or its removal."""
    principal = me()
    with session_scope() as session:
        if call.method == "PUT":
            return (
                service.update_thread(
                    session, thread_id, call.loose_body, principal=principal
                ),
                200,
            )
        if call.method == "DELETE":
            return service.remove_thread(session, thread_id, principal=principal), 200

        args = call.args
        return service.thread(session, thread_id, args, principal=principal), 200


@requires("mail.access")
def bulk(app=None, operation: str = "", request=None, **_: Any):
    """One action, applied to the threads somebody selected."""
    principal = me()
    with session_scope() as session:
        return (
            service.bulk(session, request.get_json(silent=True) if request else None,
                         principal=principal),
            200,
        )


@requires("mail.access")
def messages(app=None, operation: str = "", request=None, **_: Any):
    """A new message: a draft, a reply, or one queued to go."""
    principal = me()
    with session_scope() as session:
        return (
            service.compose(session, request.get_json(silent=True) if request else None,
                            principal=principal),
            201,
        )


@requires("mail.access")
@endpoint
def message(call: Call, message_id=None):
    """Edit a draft, send it, or discard it. Only ever a draft."""
    principal = me()
    with session_scope() as session:
        if call.method == "DELETE":
            return service.remove_message(session, message_id, principal=principal), 200
        return (
            service.update_message(
                session, message_id, call.loose_body, principal=principal
            ),
            200,
        )


@requires("mail.access")
@endpoint
def mail_templates(call: Call):
    """The composer's wording, or one of them filled in.

    A `POST` fills a template's placeholders on the server, because the
    substitution rule is a fact about a template and a second implementation
    in the browser would disagree about `{{ name }}` versus `{{name}}`.
    """
    principal = me()
    with session_scope() as session:
        if call.method == "POST":
            body = call.loose_body or {}
            return (
                service.render_template(
                    session, str(body.get("code") or ""), body.get("variables") or {},
                    principal=principal,
                ),
                200,
            )
        return service.templates(session, principal=principal), 200
