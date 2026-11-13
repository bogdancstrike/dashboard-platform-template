# The data catalogue (§65, §71) — what the platform holds, and how good it is

The data catalogue (§65, §71) — what the platform holds, and how good it is.

Every other screen asks a question *of* the data. This one describes the data
itself: which datasets exist, what each field is, which operators it accepts,
how many records carry a value for it, and how recently anything changed.

It is generated from the same `Resource` declarations the explorer, the query
builder and global search read, so a catalogue entry cannot describe a field
that does not exist or omit one that does. That is the property worth having:
a catalogue maintained by hand is a catalogue that is wrong within a month.

Completeness is measured, not asserted. `COUNT(column)` skips NULLs, so one
aggregate query per dataset — every column counted in a single pass — gives
the true fill rate of each field over every row, rather than over a sample.
