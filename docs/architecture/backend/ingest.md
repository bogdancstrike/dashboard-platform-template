# Reading a document into passages a question can find (§44)

Reading a document into passages a question can find (§44).

The pipeline, per document, off the request (`core/background`):

1. **parse** — the bytes come back from object storage and go to the isolated
   Docling service (`deploy/docling`), which answers with sections that keep
   their page numbers and the boxes they were read from. Plain text, Markdown,
   CSV and JSON are read here instead: there is nothing to lay out.
2. **chunk** — consecutive sections under the same heading *on the same page*
   are joined up to ~1 400 characters. A passage never crosses a page, so a
   citation can always say exactly which page to open and where to mark it.
   Tables are passages of their own, split on rows with the header repeated.
3. **embed** — through the gateway (`nucleus-embed`), in batches. A model that
   is unavailable does not fail the document: it is stored without vectors,
   still found by full-text search, and says so in its warnings.
4. **store** — the old passages are replaced in one transaction.

Each document has a `BackgroundJob` (kind INGEST) so it appears in the jobs
console like any other work, and its own status on the document row for the
collection page to show.
