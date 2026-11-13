"""Preference defaults, and the choices each preference allows."""

from __future__ import annotations

from typing import Any

from src.core import vocabulary

PREFERENCE_DEFAULTS: dict[str, dict[str, Any]] = {
    "appearance": {
        "theme": "system",
        "density": "middle",
        "sidebar_collapsed": False,
    },
    "formats": {
        "date": "YYYY-MM-DD",
        "time": "24h",
        "number": "1,234.56",
    },
    "defaults": {
        "page_size": 25,
        "landing_page": "home",
    },
    #: How loudly the platform may interrupt (§17, §40).
    #:
    #: Separate from `notification_preferences`, which is per-category *delivery*
    #: — in-app, email, digest. This is about the pop-up: whether one appears at
    #: all, for what, for how long, and whether it makes a noise. The two are
    #: different questions and joining them would make "stop the pop-ups" also
    #: mean "stop the emails".
    "notifications": {
        # `all` · `important` (warnings and criticals) · `none`.
        "popups": "all",
        # Which categories may interrupt. Empty means every one of them —
        # stored as a list because "all but security" is a real answer and a
        # single choice cannot express it.
        "popup_categories": [],
        "sound": False,
        # Seconds a pop-up stays. Short by default: a toast is a nudge, and
        # anything that has to be read belongs in the notification centre.
        "popup_seconds": 4,
        # Which corner, or centred at the top. Bottom-right by default because
        # that is the corner furthest from everything a person is reading, and
        # a pop-up that lands over the toolbar interrupts twice.
        "popup_placement": "bottomRight",
        # `full` carries the body as well as the title; `compact` is the title
        # alone. A burst of five is readable as five lines and unreadable as
        # five paragraphs.
        "popup_style": "full",
    },
    #: How the mailbox opens (§19, §40).
    "mail": {
        "default_folder": "INBOX",
        # Where the reading pane sits, or `off` for a list-then-page mailbox.
        "preview": "right",
        # Whether opening a thread marks it read. Off is a real preference:
        # some people triage by leaving things bold.
        "mark_read_on_open": True,
        "signature": "",
    },
}


_CHOICES: dict[tuple[str, str], set[Any]] = {
    ("appearance", "theme"): {"light", "dark", "system"},
    ("appearance", "density"): {"compact", "middle", "comfortable"},
    ("formats", "date"): {"YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"},
    ("formats", "time"): {"24h", "12h"},
    ("formats", "number"): {"1 234,56", "1,234.56"},
    ("defaults", "page_size"): {10, 25, 50, 100},
    ("defaults", "landing_page"): {
        "home",
        "dashboard",
        "analytics",
        "tasks",
        "inbox",
        "projects",
        "explore",
    },
    ("notifications", "popups"): {"all", "important", "none"},
    ("notifications", "popup_seconds"): {2, 4, 8, 15},
    # AntD's own placement vocabulary, so the stored value needs no
    # translation at the point it is used.
    ("notifications", "popup_placement"): {
        "top", "topLeft", "topRight", "bottom", "bottomLeft", "bottomRight",
    },
    ("notifications", "popup_style"): {"full", "compact"},
    # From the platform's own vocabulary rather than a copy: a folder added
    # there would otherwise be a folder this refuses to open in.
    ("mail", "default_folder"): set(vocabulary.EMAIL_FOLDER),
    ("mail", "preview"): {"right", "bottom", "off"},
}


#: Preferences that are a yes or a no.
#:
#: Listed rather than special-cased, because the first one — `sidebar_collapsed`
#: — was an `if` in the middle of the validator, and the second boolean added
#: would have been a second `if`.
_FLAGS: set[tuple[str, str]] = {
    ("appearance", "sidebar_collapsed"),
    ("notifications", "sound"),
    ("mail", "mark_read_on_open"),
}


#: Preferences that are a *set* of allowed values, and what is allowed.
#:
#: An empty list means "all of them" at every reader of these, which is why
#: none of them is required to be non-empty: "no category may interrupt me" is
#: what `popups: none` says, and a second way to say it would be a second
#: state to reason about.
_SETS: dict[tuple[str, str], set[Any]] = {
    ("notifications", "popup_categories"): set(vocabulary.NOTIFICATION_CATEGORY),
}


#: Free text, and how much of it. Trimmed and truncated rather than refused:
#: a signature two characters over a limit is not a decision worth a round trip.
_TEXT: dict[tuple[str, str], int] = {
    ("mail", "signature"): 500,
}
