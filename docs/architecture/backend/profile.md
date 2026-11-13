# A person's own page, and a colleague's (§40, §41)

A person's own page, and a colleague's (§40, §41).

Until this existed there was nowhere in the platform a reader could look at
*themselves*. Their access was visible only to an administrator opening
`/admin/users/:id`, which is the page the person asking cannot open — so the
commonest support question in any platform of this shape, "why can I not
export?", had no self-service answer at all.

Four decisions carry this module.

**Your own page needs no permission.** `/settings/security` already works that
way (§41) and for the same reason: a page about you that has to be granted is a
page most people never see, and its whole value is that the person who needs it
can reach it. Every query here is scoped to one user id, and which id is
decided by the server from the token — never from the request.

**Somebody else's page shows what the directory shows, plus their work.** Name,
role, organisation, department, job title: `/admin/users` is readable by every
persona, so none of that is a new disclosure. Contact details and the
permission breakdown need `users.view`, which is the permission that already
governs them. Their *activity trail* is the audit log by another name and needs
`audit.view` — a per-person list of everything somebody did is exactly what
that permission exists to gate.

**The access explanation is the point of the overview.** Role plus groups, the
effective set, and the part that came from a group rather than the role —
computed by `users.access_of`, the same function the administrator's page uses,
so the two can never disagree about what somebody may do.

**The analytics are aggregates and are cached like the other aggregates.** Four
`GROUP BY`s over the whole dataset per profile, invalidated by the writes that
make them stale rather than by a timer — see `core/cache`. Keyed on the person,
because a profile is a question about one of them.
