# `src/seed/support`

Deterministic randomness, and the small helpers every builder needs.

"Deterministic" here means the *graph* is deterministic: the same seed produces
the same organizations, the same people in the same departments, the same
projects owned by the same users, with the same ids. Timestamps are offsets
from an anchor taken once at the start of a run, so a dataset seeded today
looks like it was made today rather than in whatever month this template was
written. Two runs at the same instant are byte-identical; runs a week apart
differ only by the anchor.

Stable ids matter more than they look. A screenshot in the documentation, a
bookmark, a URL pasted into a ticket — all of them survive a reseed only if
`gen_random_uuid()` is not what produced the id.
