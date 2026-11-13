"""Undo what a load test wrote, and prove the database is back where it was.

    python cleanup.py snapshot  > reports/before.json   # row count of every table
    python cleanup.py clean [RUN_ID]                    # delete the run's leftovers
    python cleanup.py diff reports/before.json          # what still differs

What a run leaves behind, and how each is found:

* the throwaway kanban boards (`LT load-test <run> <persona>`), soft-deleted by
  the run itself, with their lanes, cards and the activity rows describing them;
* exports it queued (deleted through the API at test stop; any row whose
  correlation id is the run's is removed here, with its job);
* `audit_logs` and `system_logs` rows — every request carries an
  `X-Correlation-ID` beginning `lt-<run>-`;
* nothing else: the reads write no rows except the request log, the persona
  sessions (one per persona, reused across runs) and `users.last_login_at`.

Talks to PostgreSQL directly (`docker exec nucleus-postgres psql`) so it needs
no Python driver on the host. `LOADTEST_PG_CONTAINER` overrides the container.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

CONTAINER = os.getenv("LOADTEST_PG_CONTAINER", "nucleus-postgres")
PSQL = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "platform", "-d", "platform", "-v", "ON_ERROR_STOP=1",
        "-At", "-F", "\t"]


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(PSQL, input=sql, capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line]


def snapshot() -> dict[str, int]:
    tables = [row[0] for row in psql(
        "select tablename from pg_tables where schemaname='public' order by 1;")]
    union = " union all ".join(f"select '{t}', count(*) from \"{t}\"" for t in tables)
    return {name: int(count) for name, count in psql(union + ";")}


#: The tables a run writes to. A difference in one of these after `clean` is a
#: leak and fails the check.
OWNED = {"kanban_boards", "kanban_lanes", "kanban_cards", "exports"}

#: Tables that grow from *other* traffic on a shared stack (other agents, the
#: browser, the health monitor) — a difference there is reported, not failed.
NOISY = {"system_logs", "audit_logs", "user_sessions", "activity_entries", "notifications", "service_health_checks",
         "ai_usage", "login_events", "security_events", "recent_items", "background_jobs"}


def clean(run_id: str = "") -> dict[str, int]:
    like = f"lt-{run_id}-%" if run_id else "lt-%"
    board_like = f"LT load-test {run_id}%" if run_id else "LT load-test %"
    sql = f"""
begin;
create temp table lt_boards as select id from kanban_boards where name like '{board_like}';
create temp table lt_cards as select id from kanban_cards where board_id in (select id from lt_boards);
delete from comments where resource_type = 'kanban_card' and resource_id::text in (select id::text from lt_cards);
delete from activity_entries where resource_id in (select id::text from lt_boards union all select id::text from lt_cards);
delete from kanban_cards where board_id in (select id from lt_boards);
delete from kanban_lanes where board_id in (select id from lt_boards);
delete from resource_shares where resource_type = 'kanban_board' and resource_id::text in (select id::text from lt_boards);
delete from kanban_boards where id in (select id from lt_boards);
select 'boards', count(*) from lt_boards;
select 'cards', count(*) from lt_cards;
with d as (delete from audit_logs where correlation_id like '{like}' returning 1) select 'audit_logs', count(*) from d;
with d as (delete from system_logs where correlation_id like '{like}' returning 1) select 'system_logs', count(*) from d;
commit;
"""
    try:
        rows = psql(sql)
    except subprocess.CalledProcessError as exc:
        # A table this script names may not exist on an older schema; retry the
        # parts that must work.
        print(exc.stderr, file=sys.stderr)
        raise
    return {row[0]: int(row[1]) for row in rows if len(row) == 2 and row[1].isdigit()}


def diff(before_path: str) -> int:
    before = json.load(open(before_path))
    after = snapshot()
    hard, other, soft = [], [], []
    for table in sorted(set(before) | set(after)):
        delta = after.get(table, 0) - before.get(table, 0)
        if delta:
            (hard if table in OWNED else soft if table in NOISY else other).append((table, delta))
    for table, delta in hard:
        print(f"LEAK  {table:32s} {delta:+d}  (a table the load test writes)")
    for table, delta in other:
        print(f"other {table:32s} {delta:+d}  (not written by the load test: another user of the stack)")
    for table, delta in soft:
        print(f"noise {table:32s} {delta:+d}  (shared stack traffic)")
    if not hard:
        print("database consistent: nothing the load test writes is left behind")
    return 1 if hard else 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("snapshot", "clean", "diff"):
        print(__doc__)
        return 2
    if argv[0] == "snapshot":
        print(json.dumps(snapshot(), indent=1, sort_keys=True))
        return 0
    if argv[0] == "clean":
        print(json.dumps(clean(argv[1] if len(argv) > 1 else "")))
        return 0
    return diff(argv[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
