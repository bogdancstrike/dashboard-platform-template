# `src/seed/blobs`

Real bytes for the seeded files (§20).

Before MinIO existed, a seeded file was a row with a `storage_key` pointing at
nothing — and the comment in `content.py` said as much. A file manager whose
every download fails is not a demonstration of a file manager, so the seed now
writes an actual object for each file it creates.

**Every format here is one this module can genuinely produce.** A `.xlsx` whose
bytes are plain text is not a spreadsheet: it is a file that looks fine in a
list and fails in the application the reader opens it with, which is worse than
not offering it. So the catalogue was narrowed to the formats a generator can
write honestly — text, markdown, CSV, JSON, logs, SVG, and the two binary
formats small enough to emit by hand.

The content is generated from the file's own name and folder, so a downloaded
document is *about* the thing the list said it was.
