# Load test summary — `B-fix`

* peak users: **1000**, peak throughput **196 req/s**, mean 145 req/s
* requests: 35,391, failures: 8 (**0.02%**)
* latency overall: p50 1800 ms · p95 8300 ms · p99 13000 ms · max 32750 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| POST `/api/explorer/insights` | 733 | 0.00 | 3500 | 13000 | 18000 | 3.0 |
| GET `/dashboard/summary` | 1,117 | 0.00 | 4500 | 13000 | 18000 | 4.6 |
| GET `/admin/quality` | 9 | 0.00 | 4100 | 9700 | 9700 | 0.0 |
| GET `/api/kanban/boards` | 796 | 0.00 | 1800 | 9600 | 15000 | 3.3 |
| GET `/api/dashboards` | 369 | 0.00 | 2000 | 9000 | 14000 | 1.5 |
| POST `/api/explorer/query [page]` | 751 | 0.00 | 1800 | 9000 | 14000 | 3.1 |
| GET `/api/records/[type]/[id]` | 1,899 | 0.00 | 1700 | 9000 | 14000 | 7.8 |
| GET `/api/profile/[id]` | 208 | 0.00 | 1800 | 8800 | 15000 | 0.9 |
| GET `/api/mail/threads` | 545 | 0.00 | 1500 | 8700 | 14000 | 2.2 |
| WS `/live [connect]` | 214 | 2.80 | 1700 | 8600 | 10000 | 0.9 |
| GET `/notifications` | 585 | 0.00 | 1700 | 8600 | 13000 | 2.4 |
| POST `/api/explorer/query [advanced]` | 743 | 0.00 | 1800 | 8500 | 13000 | 3.0 |
| GET `/api/search/global` | 2,809 | 0.00 | 1800 | 8500 | 14000 | 11.5 |
| GET `/api/calendar/events` | 630 | 0.00 | 2000 | 8200 | 11000 | 2.6 |
| POST `/api/explorer/query [list]` | 2,971 | 0.00 | 1900 | 8000 | 13000 | 12.1 |
| GET `/health/status` | 8 | 0.00 | 2200 | 8000 | 8000 | 0.0 |
| GET `/api/kanban/boards/[id]` | 1,056 | 0.00 | 1800 | 7900 | 13000 | 4.3 |
| GET `/notifications/counts` | 2,634 | 0.00 | 1700 | 7900 | 12000 | 10.8 |
| GET `/dashboard/alerts` | 1,117 | 0.00 | 1800 | 7800 | 12000 | 4.6 |
| GET `/api/files` | 509 | 0.00 | 1800 | 7700 | 12000 | 2.1 |
| GET `/api/audit/timeline` | 1,899 | 0.00 | 1700 | 7600 | 13000 | 7.8 |
| GET `/api/reports` | 369 | 0.00 | 1600 | 7600 | 12000 | 1.5 |
| GET `/api/activity` | 1,485 | 0.00 | 1700 | 7500 | 12000 | 6.1 |
| GET `/api/files/tree` | 509 | 0.00 | 2000 | 7500 | 10000 | 2.1 |
| GET `/api/comments` | 1,899 | 0.00 | 1600 | 7400 | 11000 | 7.8 |
| GET `/api/me` | 1,485 | 0.00 | 1700 | 7400 | 11000 | 6.1 |
| GET `/api/records/[type]/[id]/tags` | 1,899 | 0.00 | 1600 | 7400 | 12000 | 7.8 |
| GET `/recents` | 1,485 | 0.00 | 1600 | 7400 | 12000 | 6.1 |
| GET `/admin/audit` | 6 | 0.00 | 3500 | 7300 | 7300 | 0.0 |
| GET `/exports` | 397 | 0.00 | 1600 | 7200 | 11000 | 1.6 |
| GET `/api/announcements` | 1,485 | 0.00 | 1900 | 6800 | 11000 | 6.1 |
| GET `/api/relationships/[type]/[id]` | 584 | 0.00 | 1600 | 6800 | 14000 | 2.4 |
| GET `/favorites` | 1,485 | 0.07 | 1600 | 6800 | 11000 | 6.1 |
| GET `/admin/users` | 9 | 0.00 | 1200 | 6600 | 6600 | 0.0 |
| GET `/admin/logs` | 7 | 0.00 | 2800 | 6500 | 6500 | 0.0 |
| POST `/api/kanban/cards/[id]/move` | 260 | 0.38 | 1700 | 6500 | 9800 | 1.1 |
| POST `/exports/estimate` | 397 | 0.00 | 1600 | 5900 | 8600 | 1.6 |
| POST `/exports` | 15 | 0.00 | 3100 | 5200 | 5200 | 0.1 |
| GET `/security/overview` | 7 | 0.00 | 900 | 4000 | 4000 | 0.0 |
| GET `/admin/jobs` | 6 | 0.00 | 2100 | 3400 | 3400 | 0.0 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| WS | `/live [connect]` | WebSocketTimeoutException('Connection timed out') | 6 |
| POST | `/api/kanban/cards/[id]/move` | CatchResponseError('HTTP 503') | 1 |
| GET | `/favorites` | CatchResponseError('HTTP 503') | 1 |

## Server resources during the run

```
leus-api cpu=4.37% mem=259.7MiB / 60.43GiB
nucleus-postgres cpu=94.22% mem=947.5MiB / 60.43GiB
nucleus-redis cpu=0.88% mem=22.64MiB / 60.43GiB
pg connections: 71 active=3
20:05:48
nucleus-api cpu=0.02% mem=260.1MiB / 60.43GiB
nucleus-postgres cpu=90.60% mem=988.8MiB / 60.43GiB
nucleus-redis cpu=0.62% mem=22.56MiB / 60.43GiB
pg connections: 71 active=2
20:05:55
nucleus-api cpu=0.68% mem=260.7MiB / 60.43GiB
nucleus-postgres cpu=144.73% mem=983.4MiB / 60.43GiB
nucleus-redis cpu=0.52% mem=24.09MiB / 60.43GiB
pg connections: 71 active=4
20:06:02
nucleus-api cpu=0.02% mem=260.7MiB / 60.43GiB
nucleus-postgres cpu=80.51% mem=984MiB / 60.43GiB
nucleus-redis cpu=0.98% mem=25.51MiB / 60.43GiB
pg connections: 71 active=6
20:06:09
nucleus-api cpu=1.75% mem=261.4MiB / 60.43GiB
nucleus-postgres cpu=58.02% mem=952.6MiB / 60.43GiB
nucleus-redis cpu=1.04% mem=25.52MiB / 60.43GiB
pg connections: 69 active=1
20:06:16
nucleus-api cpu=9.13% mem=260.9MiB / 60.43GiB
nucleus-postgres cpu=24.84% mem=956.6MiB / 60.43GiB
nucleus-redis cpu=0.57% mem=26.81MiB / 60.43GiB
pg connections: 69 active=1
20:06:23
nucleus-api cpu=0.02% mem=260.9MiB / 60.43GiB
nucleus-postgres cpu=73.38% mem=969.6MiB / 60.43GiB
nucleus-redis cpu=0.76% mem=27.21MiB / 60.43GiB
pg connections: 70 active=1
20:06:30
nucleus-api cpu=11.13% mem=261.2MiB / 60.43GiB
nucleus-postgres cpu=68.59% mem=975.5MiB / 60.43GiB
nucleus-redis cpu=2.46% mem=28.55MiB / 60.43GiB
pg connections: 69 active=4
20:06:37
nucleus-api cpu=0.61% mem=261.4MiB / 60.43GiB
nucleus-postgres cpu=54.00% mem=982MiB / 60.43GiB
nucleus-redis cpu=0.44% mem=28.45MiB / 60.43GiB
pg connections: 69 active=3
20:06:44
nucleus-api cpu=0.02% mem=261.4MiB / 60.43GiB
nucleus-postgres cpu=55.95% mem=983.8MiB / 60.43GiB
nucleus-redis cpu=0.88% mem=29.67MiB / 60.43GiB
pg connections: 69 active=2
20:06:51
nucleus-api cpu=13.67% mem=264.7MiB / 60.43GiB
nucleus-postgres cpu=88.30% mem=985.6MiB / 60.43GiB
nucleus-redis cpu=0.83% mem=31.12MiB / 60.43GiB
pg connections: 70 active=1
20:06:58
nucleus-api cpu=0.03% mem=261.6MiB / 60.43GiB
nucleus-postgres cpu=66.78% mem=1004MiB / 60.43GiB
nucleus-redis cpu=0.98% mem=29.91MiB / 60.43GiB
pg connections: 70 active=1
20:07:05
nucleus-api cpu=0.03% mem=261.6MiB / 60.43GiB
nucleus-postgres cpu=43.36% mem=1014MiB / 60.43GiB
nucleus-redis cpu=0.85% mem=31.03MiB / 60.43GiB
pg connections: 70 active=4
20:07:12
nucleus-api cpu=0.02% mem=261.6MiB / 60.43GiB
nucleus-postgres cpu=35.90% mem=1007MiB / 60.43GiB
nucleus-redis cpu=0.94% mem=32.45MiB / 60.43GiB
pg connections: 70 active=1
20:07:19
nucleus-api cpu=0.02% mem=261.6MiB / 60.43GiB
nucleus-postgres cpu=103.08% mem=1.001GiB / 60.43GiB
nucleus-redis cpu=0.23% mem=32.05MiB / 60.43GiB
pg connections: 71 active=3
20:07:27
nucleus-api cpu=0.02% mem=261.8MiB / 60.43GiB
nucleus-postgres cpu=2.12% mem=518MiB / 60.43GiB
nucleus-redis cpu=1.69% mem=31.85MiB / 60.43GiB
pg connections: 30 active=1
20:07:34
nucleus-api cpu=0.03% mem=261.8MiB / 60.43GiB
nucleus-postgres cpu=2.23% mem=523.1MiB / 60.43GiB
nucleus-redis cpu=0.12% mem=31.91MiB / 60.43GiB
pg connections: 30 active=1
20:07:41
nucleus-api cpu=1.73% mem=262.6MiB / 60.43GiB
nucleus-postgres cpu=1.45% mem=516.8MiB / 60.43GiB
nucleus-redis cpu=0.17% mem=31.89MiB / 60.43GiB
pg connections: 30 active=1
20:07:48
nucleus-api cpu=0.02% mem=262.3MiB / 60.43GiB
nucleus-postgres cpu=0.01% mem=517.4MiB / 60.43GiB
nucleus-redis cpu=0.14% mem=31.4MiB / 60.43GiB
pg connections: 30 active=1
20:07:55
nucleus-api cpu=5.13% mem=263.4MiB / 60.43GiB
nucleus-postgres cpu=1.58% mem=518.6MiB / 60.43GiB
nucleus-redis cpu=0.21% mem=32.14MiB / 60.43GiB
pg connections: 30 active=1
20:08:02
nucleus-api cpu=0.31% mem=263.1MiB / 60.43GiB
nucleus-postgres cpu=0.07% mem=518.5MiB / 60.43GiB
nucleus-redis cpu=2.29% mem=31.96MiB / 60.43GiB
pg connections: 30 active=1
20:08:09
nucleus-api cpu=1.75% mem=264.8MiB / 60.43GiB
nucleus-postgres cpu=2.63% mem=520.1MiB / 60.43GiB
nucleus-redis cpu=0.12% mem=31.43MiB / 60.43GiB
pg connections: 30 active=1
```
