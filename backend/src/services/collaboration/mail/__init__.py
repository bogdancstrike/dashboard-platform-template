"""Mail (§19): folders of threads, composing and templates, all inside the platform.
See docs/architecture/backend/mail.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "rows": (
        "PERMISSION", "MOVABLE", "MAX_SUBJECT", "MAX_BODY", "MAX_RECIPIENTS", "MAX_LABELS",
        "_PLACEHOLDER", "_EMAIL", "_me", "_owned", "_thread_row", "_message_row", "_recount",
    ),
    "serializers": ("_thread", "_message", "_as_html", "_as_text", "_next_ref"),
    "reading": ("threads", "_folder_counts", "_labels", "thread"),
    "threads_writes": ("update_thread", "bulk", "remove_thread"),
    "composing": ("compose", "update_message", "remove_message"),
    "mail_templates": ("templates", "render_template", "_template_row", "_rendered"),
    "validation": (
        "_validated_message", "_validated_recipients", "_validated_labels", "_one_label",
        "_folder", "_movable",
    ),
})
