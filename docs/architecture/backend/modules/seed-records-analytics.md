# `src/seed/records_analytics`

Records & analytics demo data (§12, §13, §17, §22, §25).

Runs after the main graph, against the session, because everything here is
*about* records that already exist:

* **Contracts** for most active accounts — end dates spread from four months
  ago to ten months out, in the stage a real pipeline would have them in, with
  a create and a few stage moves in the audit trail each.
* **Customer health** — today's scores computed by the real model, and ninety
  days of daily snapshots behind them: mostly gentle drift, some accounts that
  slid into a worse band in the last weeks (the portfolio's movers and the
  drop alerts), some recovering.
* **Version histories** — a handful of customers, tickets, tasks, orders,
  devices and projects get a chain of edits that ends exactly at their current
  values, so the History panel has something to compare and restore.
* **Metric watches** — six watches over tickets, orders and devices, each
  backfilled by the real detector, so the alert list has history.
* **Public links** — two links to an administrator's dashboard, one open and
  one behind the password `nucleus-demo`.

Dates are relative to now. Idempotent, so the same function is the
`--sync-analytics` repair for a database seeded before these features: each
part only adds what is missing (marked `source: records-analytics-seed`).
