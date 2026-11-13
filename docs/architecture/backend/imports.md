# Imports

Loading a spreadsheet somebody exported from something else (§29).

The wizard is four steps because the decision has four parts, and a single
form asking all of them at once gets a worse answer to each: **which dataset**,
**which column is which field**, **what is wrong with which rows**, and only
then **do it**. `core/importer` reads the file; this decides what the rows
mean.

Six decisions worth the reader's attention.

**The rules are the form's rules, not the importer's.** A row is validated by
`record_writes.coerce` — the same function `POST /api/records/<type>` calls,
against the same `Writable` declarations an edit form is rendered from. An
importer that validated CSV itself would eventually accept a status a form
refuses, and the first anybody would hear of it is a 500 halfway through an
execute. `coerce` collects every problem on a row rather than the first,
because a wizard that reports one error per round trip is a wizard somebody
goes round four times.

**Nothing is written until the person has seen what is wrong.** The preview is
the point of the whole flow: per-row, per-column, with the line number from the
file so it can be found in the spreadsheet. Then the execute is
all-or-nothing — half an import is the outcome this module exists to prevent,
because a spreadsheet loaded twice is what happens when nobody can tell how
much of it landed the first time.

**Every count is derived and they add up.** `total = valid + invalid +
skipped`, checked in the tests and by `--check`, because the seeded runs
carried `valid = total - invalid` with a separate non-zero `skipped` — three
numbers that could not all be true. A "skipped" row here means one thing:
after mapping, it has nothing in any mapped column. Neither valid nor wrong,
just not data.

**The staged rows are the file, and they are bounded.** They live in JSONB
between steps so a draft can be resumed and a mapping changed without
re-uploading — which is what the wizard is for. `importer.MAX_ROWS` bounds it,
because rewriting a hundred thousand staged rows on every mapping change is
not something to ask of PostgreSQL, and the refusal says the number.

**The execute happens off the request**, through `core/background`, for the
same reason an export does (§30): five thousand inserts and their audit rows
are not a request somebody's browser holds open. Which mechanism ran it is on
the row.

**The error report is a file, because it has to go back to the spreadsheet.**
Somebody with 200 bad rows is going to fix them in Excel, and a list on a
screen cannot be sorted, filtered or pasted. It carries the line number, the
column, the value as written and the reason.

**Letting one go takes two presses**, the same rule `/exports` and `/mail`
use: the first drops the copy of the file, the second removes the record. Two,
because one takes production data out of storage and the other tidies away a
note — and the audit trail keeps the history of both, where the person who
made the run cannot edit it.
