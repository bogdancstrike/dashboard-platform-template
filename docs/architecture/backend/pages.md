# Insights (§43): ask a question about the records, get a small page back

Insights (§43): ask a question about the records, get a small page back.

**How a page is made.** The model is given the registry of components (see
`services/insight_spec`), the datasets this reader may read with their
groupable fields and measures, and two read-only tools: `run_analysis` (the
same aggregation the analytics workspace uses) and `list_records` (the
explorer's query). It looks, then answers with a JSON spec whose data-bearing
components carry *queries*. The spec is validated against the registry and
the queries are executed as the reader — so a component can never show a
number the reader could not have queried themselves, and the model never
touches the database or writes a number into a chart.

**Cost is bounded.** At most `MAX_ROUNDS` tool rounds and one final answer
per question, every call through `core/llm` (with its time and concurrency
caps) and the shared per-user rate limit (`services/ai.guard`). Without a
model — no key, `LLM_MODE=fake`, or a model that fails — a deterministic
planner picks the dataset the question names and composes a sensible page, so
the feature degrades to useful rather than to an error.

**Refresh is free.** A saved insight keeps its spec; refreshing re-binds the
queries and stores the new numbers. Pinning, sharing (the platform's one
sharing model) and putting it on a dashboard work from the saved row.
