# Roles and the permission matrix (§13)

Roles and the permission matrix (§13).

The matrix is the screen that explains the whole authorization model, so it is
built from the two things that actually decide access rather than from a
description of them:

* the **permission catalogue** in `core/auth.py`, which is the list of things
  the code checks for — so every permission an endpoint can require appears on
  the screen that grants it, and one that does not exist cannot be granted;
* the **`roles` table**, which `permissions_for` reads on every request — so
  an edit here changes what the next request is allowed to do, with no
  re-login and no cache to invalidate.

`/meta/roles` publishes the *defaults* the seed writes. This publishes what is
actually in force. A screen that showed the defaults while the database said
something else would be worse than no screen.
