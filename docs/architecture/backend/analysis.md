# Grouped aggregation over any declared dataset (§2, §28, §44, §71)

Grouped aggregation over any declared dataset (§2, §28, §44, §71).

Four screens ask the same question in different clothes: the analytics
workspace ("revenue by month"), the report builder ("orders by channel and
status, summed"), the chart builder ("draw that as a treemap") and the map
("by country"). They are one query — *group these rows by these columns and
measure them this way* — so there is one compiler here rather than four
endpoints that will disagree about what "last 30 days" means.

Three properties make it safe to expose that generality:

**Everything comes from the declaration.** A dimension must be a declared
field, a measure must be a declared numeric one, and the filters go through the
same `apply_filters` and `compile_tree` every list uses. A caller cannot name a
column that is not published, and permission is checked on the resource before
anything is compiled.

**It aggregates in PostgreSQL.** Summing the rows a page happened to download
gives "revenue: 41 000" for a dataset holding four million — not a smaller
version of the right answer but a wrong one (§71).

**The tail is collapsed, never dropped.** A breakdown of forty industries is a
colour wheel, so the long tail becomes one named row that still adds up to the
total. A chart whose slices do not reconcile with the list beside it is a chart
nobody believes twice.
