# Customer health (§12): a weighted model from tickets, orders and usage, with trend

Customer health (§12): a weighted model from tickets, orders and usage, with trend.

**The model is four signals and their weights.** Each signal is scored 0–100
on its own — *tickets* (open, escalated and SLA-breached work), *orders*
(recency, and volume and value against the previous window), *usage* (the
share of the customer's devices online, and how recently anybody spoke to
them) and *renewal* (how close the next contract end is, and how likely it is
to renew). The overall score is the weighted mean, and a band comes from two
cut-offs. Weights and every parameter are an administrator's (`health.configure`),
stored in `health_models` and audited.

**Computed in bulk, in PostgreSQL.** One grouped query per signal for every
customer at once, not four queries per customer: three hundred accounts is
four statements, which is what lets "recompute now" be a button rather than a
job somebody waits on.

**The "why" is part of the answer.** Each signal carries its inputs and the
sentences that explain its score ("2 tickets breached their SLA: −24"), so the
customer page shows the breakdown the number came from rather than asking the
reader to trust it.

**Trend is snapshots.** One row per customer per day (`customer_health_snapshots`),
upserted by every recompute; deltas over 7 and 30 days and the portfolio's
movers are read from them.

**A drop in band is news.** When a recompute moves a customer to a worse band,
their account manager (or, with none, every holder of `health.configure`) gets
an in-app notification linking to the customer.
