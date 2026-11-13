# Request validation — `core/validation.py`, `core/cleaners.py`

**Status:** adopted (backend refactor, 2026-11).

## Context
Every service hand-rolled its payload check: an object check, an unknown-field
refusal, a `not partial or "x" in payload` guard per field, trimmed and bounded
text, closed vocabularies. Seven of those functions had a cyclomatic complexity
between 31 and 71, and the same idioms were spelled 600 times with small
differences nobody chose.

## Decision
A payload is described by a `Schema`: an ordered list of `Field(name, cleaner)`
entries plus *steps* (`(out, ctx) -> None`) for rules that read or write several
fields at once (an event's start/end pair, a shareable item's scope).

* `Field(..., sparse=True)` — read only when sent, even on a create.
* `Field(..., always=True)` — cleaned on every save (so a stale combination is
  refused) but stored only when the update names it.
* `Field(..., inherit=True)` — an absent field reads the existing row's value.
* `Schema(not_object=..., unknown=...)` — the object check and the unknown-field
  refusal, with the endpoint's own wording; `not_object=None` reads a non-object
  as `{}`.
* `checks=[...]` — cross-field rules run after every field.

Cleaners (`core/cleaners.py`) are small factories — `text`, `bounded_name`,
`choice`, `flag`, `optional_uuid`, `json_object`, `object_or_null`, `whole`,
`number`, `within`, `optional` — that always take the caller's message: the text
of a refusal is part of the HTTP contract and the UI shows it verbatim.

`core/shared_fields.py` holds the two steps every shareable resource repeats
(visibility, members).

## Consequences
A service's validation reads as a table; complexity moved from one function per
service into named, separately testable cleaners. Rules that are genuinely
procedural (an SLA policy's escalation steps, a form's field list) are split
into per-section functions instead of being forced into a schema.
