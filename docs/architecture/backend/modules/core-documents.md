# `src/core/documents`

Turning a composed document into a file somebody can send (§28, §30).

This module knows about *paper*: page sizes, margins, running headers, page
numbers, where a heading sits and how a table is ruled. It knows nothing about
where the numbers came from — `services/report_documents` resolves every block
into plain content first, and hands this a list of pieces to lay out. The
split is what lets the PDF and the DOCX be two renderings of one document
rather than two documents that happen to agree today.

Three decisions worth stating.

**Charts arrive as images the client already drew.** There is no chart engine
in this process and adding one would be a second implementation of every
picture the product draws — different fonts, different colours, and a legend
that disagrees with the screen. The browser has already rendered the chart
with ECharts; it posts the PNG with the render request, and what lands in the
document is exactly what was previewed. A block whose image did not arrive
falls back to its own data as a table, which is the honest degradation: the
numbers are the point and the picture was the presentation of them.

**A table too wide for the page is narrowed by dropping columns, not by
shrinking type.** Six-point text is not a smaller table, it is an unreadable
one; a document that says "4 more columns" tells the reader what it did.

**Nothing here raises on missing content.** A block pointing at a report that
was deleted renders as a line saying so. A render that fails halfway is worse
than a document with one honest gap in it, because the person exporting it is
usually about to send it to somebody.
