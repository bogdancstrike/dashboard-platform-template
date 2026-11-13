# `src/seed/knowledge`

Seeded document collections for "Ask your documents" (§44).

Real PDFs, drawn here with reportlab, so the preview opens a genuine document
and a citation's page and highlight land on the passage it quotes. Because
this module draws every paragraph it knows exactly where each one sits, so the
passages are stored with exact boxes without running the converter — a fresh
`make reseed` needs no Docling service. Embeddings go through the gateway like
any upload (or the deterministic fake with no key); with neither, the passages
are still found by full-text search.

`--sync-knowledge` adds whatever is missing to a running database and leaves
everything else — including collections somebody made — alone.
