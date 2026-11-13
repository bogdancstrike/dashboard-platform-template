# SLA policies: which tickets, what targets, counted in whose hours

SLA policies: which tickets, what targets, counted in whose hours.

**The first active policy that matches wins.** Policies are ordered; each names
conditions on the ticket and its customer (customer, segment, category,
channel) and an empty condition set matches everything — so the last policy is
usually the catch-all.

**Targets are business minutes.** "Four hours" on a Friday at 16:00 in a
09:00–17:00 calendar is Monday at 11:00, not Friday at 20:00. The calendar
carries a time zone, its working spans per weekday and its holidays; a policy
without one counts every minute.

**Waiting on the customer stops the clock.** The statuses a policy names as
pauses accumulate business minutes in `paused_minutes`, and the resolution
deadline moves by exactly that much.

**The ticket still carries the answer.** `tickets.due_at` and `sla_breached`
are written from the computation, so every list, report and dashboard that
already reads them now reads the policy — without knowing it exists.
