# `src/core/export`

Exports (§30): CSV, JSON and XLSX of *the current question*.

Three properties this file exists to guarantee, and each of them is a mistake
somebody makes when they write an export by hand:

**It exports the question, not the page.** A reader who filtered 200 000 rows
down to 340 and pressed Export wants 340 rows, not the 25 they can see. The
callers here pass the same statement the list endpoint built, minus its
LIMIT/OFFSET, so the file and the screen can never disagree about what was
asked.

**It streams.** A 50 000-row CSV assembled in memory is 50 000 rows of RAM per
concurrent export, on a gevent worker that is also serving everything else.
Rows are read from PostgreSQL in batches and written out as they arrive, so the
process holds a batch rather than a file. XLSX is the exception the format
forces — a spreadsheet is a zip container and cannot be produced incrementally
— which is why it has a lower row cap of its own.

**It does not hand Excel a formula.** A cell whose text begins with `=`, `+`,
`-` or `@` is *executed* when the file is opened, and the values in it came
from whoever typed them into the application. Prefixing those with a quote is
the standard mitigation, and the reason a CSV export is a security surface at
all (§76).
