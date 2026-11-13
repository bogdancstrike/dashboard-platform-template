"""Turn a Locust CSV run into the markdown summary that is committed.

    python summarize.py reports/<run>  [--stats-file reports/<run>_docker.txt]

Reads `<run>_stats.csv` (and `<run>_stats_history.csv` for peak RPS) and
writes `<run>_SUMMARY.md` next to them: per-endpoint count, failure rate, p50,
p95, p99 and RPS, sorted by p95 so the slowest thing is the first row.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path


def _f(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def summarize(prefix: str, extra: str = "") -> Path:
    stats = list(csv.DictReader(open(f"{prefix}_stats.csv")))
    rows = [r for r in stats if r["Name"] != "Aggregated"]
    total = next((r for r in stats if r["Name"] == "Aggregated"), None)
    peak_rps, peak_users = 0.0, 0
    history = Path(f"{prefix}_stats_history.csv")
    if history.exists():
        for r in csv.DictReader(open(history)):
            if r.get("Name") == "Aggregated":
                peak_rps = max(peak_rps, _f(r.get("Requests/s")))
                peak_users = max(peak_users, int(_f(r.get("User Count"))))
    rows.sort(key=lambda r: -_f(r["95%"]))
    lines = [f"# Load test summary — `{Path(prefix).name}`", ""]
    if total:
        req, fails = int(_f(total["Request Count"])), int(_f(total["Failure Count"]))
        lines += [
            f"* peak users: **{peak_users}**, peak throughput **{peak_rps:.0f} req/s**, "
            f"mean {_f(total['Requests/s']):.0f} req/s",
            f"* requests: {req:,}, failures: {fails:,} (**{100 * fails / max(req, 1):.2f}%**)",
            f"* latency overall: p50 {total['50%']} ms · p95 {total['95%']} ms · p99 {total['99%']} ms · "
            f"max {int(_f(total['Max Response Time']))} ms",
            "",
        ]
    lines += ["| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |",
              "|---|---:|---:|---:|---:|---:|---:|"]
    for r in rows:
        req = int(_f(r["Request Count"]))
        fail = 100 * _f(r["Failure Count"]) / max(req, 1)
        lines.append(f"| {r['Type']} `{r['Name']}` | {req:,} | {fail:.2f} | {r['50%']} | {r['95%']} | "
                     f"{r['99%']} | {_f(r['Requests/s']):.1f} |")
    failures = Path(f"{prefix}_failures.csv")
    if failures.exists():
        fl = list(csv.DictReader(open(failures)))
        if fl:
            lines += ["", "## Failures", "", "| method | name | error | occurrences |", "|---|---|---|---:|"]
            for r in sorted(fl, key=lambda r: -int(_f(r["Occurrences"])))[:25]:
                lines.append(f"| {r['Method']} | `{r['Name']}` | {r['Error'][:120]} | {r['Occurrences']} |")
    if extra and Path(extra).exists():
        lines += ["", "## Server resources during the run", "", "```", Path(extra).read_text().strip()[-4000:], "```"]
    out = Path(f"{prefix}_SUMMARY.md")
    out.write_text("\n".join(lines) + "\n")
    return out


if __name__ == "__main__":
    extra = sys.argv[sys.argv.index("--stats-file") + 1] if "--stats-file" in sys.argv else ""
    print(summarize(sys.argv[1], extra))
