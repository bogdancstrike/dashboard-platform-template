"""What a document may contain: block kinds, chart kinds, page sizes, formats and limits."""

from __future__ import annotations

from typing import Any

#: The polymorphic key `resource_shares` files a document's audience under.
KIND = "report_document"


MANAGE_PERMISSION = "reports.manage"


VIEW_PERMISSION = "reports.view"


SHARE_PERMISSION = "searches.share"


#: What a document may be made of. Each has a renderer in `core/documents` and
#: a resolver below; a kind with neither would be a block that silently
#: vanishes from the export.
BLOCK_KINDS = frozenset({
    "HEADING",
    "TEXT",
    "REPORT",
    # A chart that composes its *own* question, the way a `TABLE` block does.
    #
    # `REPORT` draws something already saved, which is right when the question
    # exists — and useless when it does not, because it made "put a chart in
    # this report" begin with "go and build a report". A table block was always
    # allowed to name a dataset and a sort; there is no reason a chart may not
    # name a dataset and a grouping, and one compiler answers both.
    "CHART",
    "TABLE",
    "METRICS",
    "DIVIDER",
    "SPACER",
    "PAGE_BREAK",
})


#: Blocks that ask the platform a question, and so need permission checking.
DATA_KINDS = frozenset({"REPORT", "CHART", "TABLE", "METRICS"})


#: Every picture a `CHART` block may ask for — the chart builder's vocabulary,
#: because a block that could draw a shape the product cannot is a block that
#: renders an apology.
CHART_KINDS = frozenset({
    "bar", "hbar", "line", "area", "pie", "multi-line", "stacked-area",
    "stacked-bar", "stacked-hbar", "funnel", "treemap", "scatter", "radar",
    "heatmap",
})


#: A document longer than this is a book, and a JSON column is the wrong home.
MAX_BLOCKS = 80


#: Rows one table block may draw. Past this a document stops being a report and
#: becomes an export — which the platform already does properly (§30).
MAX_TABLE_ROWS = 200


DEFAULT_TABLE_ROWS = 20


PAGE_SIZES = frozenset({"A4", "LETTER"})


ORIENTATIONS = frozenset({"portrait", "landscape"})


SHOW_MODES = frozenset({"chart", "table", "both"})


FORMATS = frozenset({"pdf", "docx"})


#: The paper a document gets when nobody has said. A4 portrait with 20mm
#: margins is what most of the world prints on; the cover is on because a
#: report that arrives with a title page reads as deliberate.
DEFAULT_PAGE: dict[str, Any] = {
    "size": "A4",
    "orientation": "portrait",
    "margin_mm": 20,
    "header": "",
    "footer": "",
    "subtitle": "",
    "page_numbers": True,
    "cover": True,
    "accent": "#5b5bd6",
}


#: What a new document starts as. Not empty: a builder that opens on nothing
#: makes somebody guess what a block even is, and the first two blocks of
#: every report ever written are a heading and a paragraph.
STARTER_BLOCKS: list[dict[str, Any]] = [
    {"id": "b1", "kind": "HEADING", "text": "Summary", "level": 2},
    {
        "id": "b2",
        "kind": "TEXT",
        "text": "What this report covers, and what somebody reading it should take from it.",
    },
]
