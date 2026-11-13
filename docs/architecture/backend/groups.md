# Groups (§11): sets of people, and the permissions being in one adds

Groups (§11): sets of people, and the permissions being in one adds.

A group is not a role. A role is the one thing a person *is*, and everybody has
exactly one; a group is something a person is *in*, and they can be in several.
`core/auth/users.permissions_for` unions every group's permissions onto the role's,
which is what makes this screen change real behaviour rather than describe an
org chart.

Four decisions worth stating, and the first is the one that matters most.

**Managing membership and managing grants are different privileges.** Editing
who is in a group needs `users.manage`; editing what a group *grants* needs
`roles.manage`. Without that split, `users.manage` would be a
privilege-escalation path to everything: a manager holds it, does not hold
`roles.manage`, and could otherwise add `roles.manage` to a group they are in
and have it on their next request. The same page therefore has two privilege
levels because two of its fields have very different consequences, and
`test_groups` asserts the escalation is refused rather than merely undocumented.

**A grant is checked against the permission catalogue.** A group that grants
`records.expport` grants nothing at all, and looks in every screen exactly like
one that works — so an unknown code is refused with the near-misses named,
rather than stored.

**Deleting a group is allowed, and says what it costs.** Not refused while
occupied like a role is: a role is somebody's identity and a group is a set, the
model is soft-delete so it is recoverable, and refusing would mean emptying a
group of forty by hand first. What it must not do is take permissions away
silently, so the response names how many people were affected and which
permissions they lose with it.

**A group's own name is the only thing that names it.** The slug is derived,
because two places to write "on-call" is two places for them to disagree — and
the slug is what a URL and an integration hold on to.
