# Report documents

Report documents: a page somebody composed, exported as PDF or DOCX (§28).

**This is the thing `/reports/builder` was missing, and the reason it and the
chart builder used to be the same screen wearing two names.** A *report* is a
saved question — a dataset, a grouping, a measure and a picture — and running
one answers it. A *document* is a page: a cover, headings, paragraphs somebody
wrote, and the answers to several questions arranged between them, on paper of
a stated size with a running header and a page number. Nothing in the analysis
stack had anywhere to put a footer, which is why "customise a report" had no
home until this existed.

Four rules hold, and each is the same rule a dashboard widget follows.

**A block that shows data names a question; it does not restate one.** A
`REPORT` block carries a report id and runs the stored definition through the
same compiler the chart builder previews with. Copying the definition into the
document would be a second copy that drifts the first time either is edited.

**The document stores no answers.** Rendering runs the questions again, so a
document exported in March and again in June is the same layout over June's
data — which is what "a monthly report" means. A document that cached its
numbers would be a screenshot with a file extension.

**Every block is resolved under the reader's own permissions.** A document
shared with somebody who may not read the dataset behind block four renders
with a line saying so rather than with the rows: sharing a layout has never
been sharing data, and it is not here either.

**A block that cannot be resolved renders as a note, not as an exception.** A
report that was deleted, a dataset a role cannot read, a table with no rows —
each is a sentence in the document. The person exporting is usually about to
send the file to somebody, and one honest gap beats a 500.

Sharing is `core/sharing`, the same mechanism saved searches, reports and
dashboards use.
