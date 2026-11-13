# `src/core/importer`

Reading a spreadsheet somebody exported from something else (§29).

The half of an import that knows nothing about what is being imported: how to
find the delimiter, how to read the rows, and how to guess which column means
which field. `services/imports` supplies the meaning; this supplies the
mechanics, and keeping them apart is what lets the validation be the *same*
validation a form uses rather than a second implementation of it.

Five things this file exists to get right, each of them a way a hand-written
CSV import goes wrong.

**The delimiter is detected, and the detection is explained.** Half the
spreadsheets in Europe are semicolon-separated because Excel follows the
locale, and a parser that assumes a comma reads such a file as one column
whose name is the whole header line. `sniff` picks the separator that yields
the most consistent row width, reports what it found and why, and the wizard
shows it so somebody can override a wrong guess rather than wondering why
their file has one column.

**A BOM is not part of the first column's name.** Excel writes UTF-8 with a
byte-order mark, so the first header comes back as `\ufeffcode` and matches
nothing — which presents as "the first column cannot be mapped" on every file
a Windows user produces. `core/export` writes one deliberately for the same
reason; this strips it.

**A blank line is not a row of empty fields.** Trailing newlines are
universal, and a file with one produces a final row of `None`s that fails
validation on every required field. A row that is entirely empty is dropped
before anybody is told about it.

**A ragged row is a problem about the row, not about the file.** Real exports
have them — an unescaped comma inside a description is the usual cause — and
aborting the whole import means nobody ever finds out which line it was. Short
rows are padded, long rows are reported, and the import carries on.

**Nothing here is unbounded.** A CSV arrives as text in a request because the
API has to parse it anyway — routing it through object storage first would
move the bytes twice through the same worker — so the size and row count are
capped before a single row is staged, and the refusal says the number.
