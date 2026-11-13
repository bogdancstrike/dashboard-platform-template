"""The wiki (§48): spaces of pages built from blocks, with history, record links, search and meeting notes.
See docs/architecture/backend/docs.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "blocks": (
        "VIEW", "EDIT", "COALESCE_MINUTES", "MAX_BLOCKS", "MAX_TEXT", "MAX_TITLE", "BLOCK_KINDS",
        "TONES", "MEETINGS_SPACE", "_text", "_clean_block", "clean_blocks", "_MARKS", "plain_text",
        "_title",
    ),
    "page_view": ("_page", "_person", "_breadcrumbs", "_links", "_tasks", "_event_summary", "page"),
    "page_writes": ("_next_position", "create_page", "_revise", "update_page"),
    "history": ("revisions", "_revision", "revision", "restore"),
    "links": ("_record_label", "add_link", "remove_link", "_sync_mentions", "backlinks"),
    "meetings": ("meetings_space", "meeting_notes", "take_notes", "create_task", "summarise"),
    "page_search": ("_snippet", "search", "recent"),
    "wiki_spaces": (
        "_space", "_space_dict", "spaces", "_space_key", "create_space", "update_space",
        "delete_space", "tree",
    ),
    "page_templates": ("_b", "_template_blocks", "TEMPLATES", "templates", "meeting_blocks"),
    "reorganise": ("_descendants", "delete_page", "move_page"),
})
