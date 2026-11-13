# `src/core/query`

Declarative search, filter, sort and facets for every list endpoint.

Every table in the UI is searchable, filterable and sortable on every column,
and all of it happens in PostgreSQL. A client that filters a page it already
downloaded is filtering 25 of 200,000 rows while presenting the answer as if it
covered all of them (§71).

Rather than hand-writing that per endpoint — which is how one table ends up
case-sensitive and another silently ignores `sort` — each endpoint declares its
columns once:

    FIELDS = FieldSet(
        Field("name", User.full_name, searchable=True),
        Field("status", User.status, kind="enum", facet=True),
        Field("created_at", User.created_at, kind="datetime"),
    )

Parameter shapes, by field kind:

    text      ?name=ana                contains, case-insensitive
              ?name=ana,ben            contains any of them
    enum      ?status=ACTIVE,SUSPENDED exact, any of them
    bool      ?is_admin=true
    number    ?score=5 · ?score_min=1 · ?score_max=9
    datetime  ?created_at_from=2026-01-01 · ?created_at_to=2026-01-31
    uuid      ?org_id=<uuid>,<uuid>
    json      ?metadata=needle         searches the rendered document

Any filter may carry an explicit operator with a `__` suffix, which is what
turns a filter box into a query language and is the same operator vocabulary
the advanced query builder compiles to (§4):

    ?name__eq=Ana Pop           exactly this, case-insensitively
    ?name__not=test             does NOT contain this
    ?title__starts=Q4           begins with
    ?score__between=10,90       inclusive range
    ?owner__empty=true          has no value at all
    ?status__in=NEW,ASSIGNED    one of

Plus `?q=` across every field marked `searchable`, and `?sort=&order=` over any
field marked `sortable`.
