# Tags — one shared vocabulary, applied to anything (§37)

Tags — one shared vocabulary, applied to anything (§37).

A tag is the only piece of classification a *reader* gets to invent. Every other
way this platform describes a record — status, priority, health, category — is a
closed vocabulary somebody declared in code, because a filter menu built from
free text is a filter menu with four spellings of "urgent" in it. Tags are the
deliberate exception, and the price of the exception is that the vocabulary has
to be *managed*: curated in one place, renamed once rather than per record, and
removable.

Four decisions carry this module.

**`TagLink` is the truth; the entity's `tags` array is a derived cache with one
writer.** Both existed before this module and nothing kept them in step: 44
tasks carried an array and 28 had links, and there was no reason to think the
two sets agreed. That is the same defect the favourites work found — two stores
for one fact, and the one anybody would act on is whichever they had not looked
at. The links win, because they carry who assigned a tag and when, they cascade
when a tag is deleted, and a tag renamed does not leave stale strings on a
thousand records. The array is kept because it is what makes a list filterable
without a join, written *only* by `_resync` here, repaired by
`python -m src.seed --sync-tags` and asserted by `--check` — the same pattern
`Tag.usage_count` and `Project.task_count` already use.

**A record's tags are set as a whole set, never added one at a time.** Two
people editing the same record's tags with add/remove calls interleave into a
set neither of them chose. One gesture, one call, one audit row.

**Applying a tag is an edit; managing the vocabulary is governance.** Putting a
tag on a record needs `records.update` — it is a change to that record and it is
audited as one. Creating, renaming, recolouring or deleting a tag changes what
*every* record carrying it says, so it needs `tags.manage`.

**A system tag can be recoloured and described but not renamed or removed.** Its
name is quoted by automations, saved searches and reports; renaming it would
silently change what those match, and deleting it would silently match nothing.
