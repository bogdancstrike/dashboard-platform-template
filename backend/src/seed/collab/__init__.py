"""Collaboration seed (§47–49): channels with history, record threads, a wiki,
and meeting notes with action items."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "script": (
        "PERSONAS", "CHANNELS", "Script", "SCRIPTS", "DIRECTS", "ADMIN_READ_MINUTES_AGO",
        "_people", "_who", "_comment",
    ),
    "chat": ("seed_chat", "seed_threads", "_t", "_first"),
    "wiki_pages": ("_wiki_pages", "SPACES", "_links_for"),
    "meetings": ("seed_wiki", "ACTIONS", "NOTES", "seed_meetings", "seed"),
})
