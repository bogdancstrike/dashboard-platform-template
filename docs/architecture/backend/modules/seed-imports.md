# `src/seed/imports`

Making the seeded import runs describe files that could exist (§29).

The third of these content repairs, after `seed/blobs` for files and
`seed/exports` for export artefacts, and the same argument each time: a demo
row that claims something untrue is worse than no row, because the page built
to read it has to apologise for it.

What the seeded import runs claimed, all of it found by building `/import`:

**Counts that could not all be true.** `valid = total - invalid` was written
beside a separate non-zero `skipped`, so a run reported 24,234 valid, 619
invalid and 1,055 skipped out of 24,853 — three numbers, no two of which
agreed.

**A mapping onto fields the target does not have.** Every run was given the
same five column names whatever it imported into, and four of them were mapped
onto `code`, `country`, `email` and `name` — which `order` and `task` do not
accept. So the wizard could not describe a single seeded run, and an execute
would have been refused by the write rules on every row.

**More rows than an import may carry.** Up to 25,000 against a cap of 5,000.

**An open draft with no rows in it.** The wizard's whole purpose is that a
draft can be resumed and its mapping changed without re-uploading — and every
seeded draft resumed to an empty preview.

**Errors keyed as `row` with no value.** The error report has four columns and
three of them would have been blank.

This module repairs each of those on an existing database. It never invents a
run and never deletes one: what it edits is derived — the columns from the
target's declarations, the counts from the rows, the rows from the columns.
Idempotent, so `--sync-imports` is safe to run on every seed and on a database
that predates any of this.
