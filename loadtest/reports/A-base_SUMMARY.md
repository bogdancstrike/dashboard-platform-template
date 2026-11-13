# Load test summary — `A-base`

* peak users: **1000**, peak throughput **178 req/s**, mean 90 req/s
* requests: 23,649, failures: 288 (**1.22%**)
* latency overall: p50 2300 ms · p95 25000 ms · p99 35000 ms · max 57424 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| GET `/admin/audit` | 8 | 0.00 | 1200 | 37000 | 37000 | 0.0 |
| GET `/admin/logs` | 5 | 0.00 | 9400 | 32000 | 32000 | 0.0 |
| GET `/dashboard/summary` | 769 | 0.00 | 5100 | 32000 | 44000 | 2.9 |
| POST `/api/explorer/insights` | 512 | 0.00 | 4800 | 31000 | 43000 | 1.9 |
| GET `/api/files` | 389 | 0.00 | 2400 | 31000 | 36000 | 1.5 |
| GET `/api/calendar/events` | 370 | 0.00 | 3200 | 30000 | 36000 | 1.4 |
| GET `/api/profile/[id]` | 127 | 0.00 | 2500 | 30000 | 39000 | 0.5 |
| GET `/exports` | 242 | 0.00 | 2300 | 30000 | 36000 | 0.9 |
| GET `/notifications` | 385 | 0.00 | 2800 | 30000 | 37000 | 1.5 |
| GET `/api/dashboards` | 242 | 0.00 | 3300 | 29000 | 36000 | 0.9 |
| POST `/api/explorer/query [advanced]` | 470 | 0.00 | 2900 | 28000 | 41000 | 1.8 |
| POST `/api/explorer/query [list]` | 1,937 | 0.05 | 2500 | 28000 | 37000 | 7.4 |
| GET `/api/kanban/boards/[id]` | 687 | 9.32 | 2400 | 28000 | 37000 | 2.6 |
| GET `/api/records/[type]/[id]` | 1,212 | 0.00 | 2400 | 28000 | 35000 | 4.6 |
| POST `/api/explorer/query [page]` | 533 | 0.00 | 2900 | 27000 | 34000 | 2.0 |
| GET `/api/files/tree` | 389 | 0.00 | 2500 | 27000 | 36000 | 1.5 |
| GET `/api/mail/threads` | 376 | 0.00 | 2500 | 27000 | 36000 | 1.4 |
| GET `/api/reports` | 242 | 0.00 | 2800 | 27000 | 41000 | 0.9 |
| GET `/api/search/global` | 1,782 | 0.00 | 2700 | 27000 | 36000 | 6.8 |
| GET `/notifications/counts` | 1,767 | 0.06 | 2400 | 27000 | 36000 | 6.7 |
| GET `/api/announcements` | 1,030 | 0.00 | 2400 | 26000 | 33000 | 3.9 |
| GET `/api/me` | 1,030 | 0.00 | 2500 | 26000 | 33000 | 3.9 |
| GET `/dashboard/alerts` | 769 | 0.00 | 2000 | 26000 | 34000 | 2.9 |
| POST `/exports/estimate` | 242 | 0.00 | 2200 | 26000 | 33000 | 0.9 |
| GET `/api/audit/timeline` | 1,212 | 0.00 | 2400 | 25000 | 33000 | 4.6 |
| GET `/api/kanban/boards` | 489 | 0.00 | 2200 | 25000 | 37000 | 1.9 |
| POST `/api/kanban/cards/[id]/move` | 198 | 32.32 | 1800 | 25000 | 32000 | 0.8 |
| POST `/exports` | 19 | 0.00 | 860 | 25000 | 25000 | 0.1 |
| GET `/admin/quality` | 10 | 0.00 | 3100 | 23000 | 23000 | 0.0 |
| GET `/api/activity` | 1,030 | 0.00 | 1900 | 16000 | 27000 | 3.9 |
| GET `/favorites` | 1,030 | 0.10 | 1500 | 16000 | 26000 | 3.9 |
| GET `/admin/users` | 7 | 0.00 | 2000 | 15000 | 15000 | 0.0 |
| GET `/api/comments` | 1,212 | 0.08 | 1800 | 15000 | 27000 | 4.6 |
| GET `/api/records/[type]/[id]/tags` | 1,212 | 0.00 | 1300 | 15000 | 25000 | 4.6 |
| GET `/api/relationships/[type]/[id]` | 347 | 0.00 | 1000 | 15000 | 25000 | 1.3 |
| WS `/live [connect]` | 245 | 32.24 | 7900 | 15000 | 19000 | 0.9 |
| GET `/health/status` | 11 | 0.00 | 1100 | 14000 | 14000 | 0.0 |
| GET `/recents` | 1,030 | 0.00 | 1100 | 14000 | 26000 | 3.9 |
| GET `/security/overview` | 3 | 0.00 | 2100 | 4100 | 4100 | 0.0 |
| GET `/admin/jobs` | 2 | 0.00 | 58 | 58 | 58 | 0.0 |
| WS `/live [drop]` | 77 | 100.00 | 0 | 0 | 0 | 0.3 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| WS | `/live [connect]` | WebSocketTimeoutException('Connection timed out') | 79 |
| WS | `/live [drop]` | WebSocketConnectionClosedException('Connection to remote host was lost.') | 77 |
| GET | `/api/kanban/boards/[id]` | CatchResponseError('HTTP 404') | 64 |
| POST | `/api/kanban/cards/[id]/move` | CatchResponseError('HTTP 404') | 64 |
| GET | `/favorites` | CatchResponseError('HTTP 500') | 1 |
| GET | `/api/comments` | CatchResponseError('HTTP 500') | 1 |
| GET | `/notifications/counts` | CatchResponseError('HTTP 500') | 1 |
| POST | `/api/explorer/query [list]` | CatchResponseError('HTTP 500') | 1 |

## Server resources during the run

```
u=90.5% rss=393196
locust cpu=9.2%
20:00:26
nucleus-api cpu=0.02% mem=315.7MiB / 60.43GiB
nucleus-postgres cpu=51.26% mem=727MiB / 60.43GiB
nucleus-redis cpu=0.36% mem=22.94MiB / 60.43GiB
pg connections: 54 active=9
gunicorn pid=4106275 cpu=2.1% rss=226812
gunicorn pid=4113224 cpu=0.4% rss=152764
gunicorn pid=4179551 cpu=72.5% rss=450160
gunicorn pid=4185674 cpu=92.8% rss=430404
locust cpu=9.3%
20:00:33
nucleus-api cpu=0.02% mem=315.7MiB / 60.43GiB
nucleus-postgres cpu=73.98% mem=634.4MiB / 60.43GiB
nucleus-redis cpu=0.65% mem=23.62MiB / 60.43GiB
pg connections: 59 active=22
gunicorn pid=4106275 cpu=2.0% rss=226812
gunicorn pid=4113224 cpu=0.3% rss=152764
gunicorn pid=4185674 cpu=91.0% rss=424880
gunicorn pid=4192327 cpu=95.5% rss=238944
locust cpu=9.3%
20:00:40
nucleus-api cpu=0.03% mem=315.7MiB / 60.43GiB
nucleus-postgres cpu=18.22% mem=480.2MiB / 60.43GiB
nucleus-redis cpu=1.92% mem=22.67MiB / 60.43GiB
pg connections: 34 active=1
gunicorn pid=4106275 cpu=2.0% rss=226812
gunicorn pid=4113224 cpu=0.3% rss=152764
gunicorn pid=4185674 cpu=75.8% rss=424808
gunicorn pid=4192327 cpu=93.1% rss=275432
locust cpu=9.2%
20:00:47
pg connections: 22 active=1
gunicorn pid=4185674 cpu=64.9% rss=424772
gunicorn pid=4192327 cpu=58.2% rss=275424
locust cpu=9%
20:00:55
nucleus-api cpu=1.85% mem=214.6MiB / 60.43GiB
nucleus-postgres cpu=0.00% mem=284.9MiB / 60.43GiB
nucleus-redis cpu=1.54% mem=21.66MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=3.8% rss=33808
gunicorn pid=5105 cpu=14.7% rss=133764
gunicorn pid=5106 cpu=14.9% rss=133796
gunicorn pid=5873 cpu=41.3% rss=124936
gunicorn pid=4192327 cpu=42.3% rss=275424
locust cpu=8.8%
20:01:02
nucleus-api cpu=0.03% mem=214.4MiB / 60.43GiB
nucleus-postgres cpu=2.87% mem=285.8MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=21.59MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=1.8% rss=33808
gunicorn pid=5105 cpu=6.9% rss=133764
gunicorn pid=5106 cpu=7.0% rss=133796
gunicorn pid=5873 cpu=7.0% rss=124928
gunicorn pid=4192327 cpu=33.3% rss=275424
locust cpu=8.6%
20:01:09
nucleus-api cpu=1.74% mem=216MiB / 60.43GiB
nucleus-postgres cpu=0.01% mem=284.9MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=21.58MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=1.2% rss=33808
gunicorn pid=5105 cpu=4.5% rss=133764
gunicorn pid=5106 cpu=4.5% rss=133796
gunicorn pid=5873 cpu=3.8% rss=124928
gunicorn pid=4192327 cpu=27.4% rss=275388
locust cpu=8.4%
20:01:16
nucleus-api cpu=0.02% mem=214.4MiB / 60.43GiB
nucleus-postgres cpu=0.00% mem=284.9MiB / 60.43GiB
nucleus-redis cpu=0.07% mem=21.59MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=0.8% rss=33808
gunicorn pid=5105 cpu=3.3% rss=133764
gunicorn pid=5106 cpu=3.3% rss=133796
gunicorn pid=5873 cpu=2.6% rss=124928
gunicorn pid=4192327 cpu=23.3% rss=275376
locust cpu=8.2%
20:01:23
nucleus-api cpu=0.02% mem=214.4MiB / 60.43GiB
nucleus-postgres cpu=2.59% mem=285.2MiB / 60.43GiB
nucleus-redis cpu=0.07% mem=21.57MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=0.7% rss=33808
gunicorn pid=5105 cpu=2.6% rss=133764
gunicorn pid=5106 cpu=2.6% rss=133796
gunicorn pid=5873 cpu=2.0% rss=124928
gunicorn pid=4192327 cpu=20.3% rss=275352
locust cpu=8%
20:01:30
nucleus-api cpu=0.03% mem=214.5MiB / 60.43GiB
nucleus-postgres cpu=3.06% mem=285.9MiB / 60.43GiB
nucleus-redis cpu=1.50% mem=23.16MiB / 60.43GiB
pg connections: 11 active=1
gunicorn pid=4910 cpu=0.5% rss=33808
gunicorn pid=5105 cpu=2.2% rss=133776
gunicorn pid=5106 cpu=2.2% rss=133796
gunicorn pid=5873 cpu=1.6% rss=124928
gunicorn pid=4192327 cpu=17.9% rss=275316
locust cpu=7.8%
20:01:37
nucleus-api cpu=0.02% mem=214.5MiB / 60.43GiB
nucleus-postgres cpu=52.16% mem=294.1MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=21.56MiB / 60.43GiB
pg connections: 12 active=1
gunicorn pid=4910 cpu=0.5% rss=33808
gunicorn pid=5105 cpu=1.9% rss=133776
gunicorn pid=5106 cpu=1.9% rss=133796
gunicorn pid=5873 cpu=1.3% rss=124928
gunicorn pid=4192327 cpu=16.1% rss=274084
locust cpu=7.6%
```
