# Load test summary — `E-shared-deployed`

* peak users: **400**, peak throughput **155 req/s**, mean 123 req/s
* requests: 22,264, failures: 8 (**0.04%**)
* latency overall: p50 29 ms · p95 610 ms · p99 1100 ms · max 2260 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| GET `/admin/quality` | 7 | 0.00 | 490 | 1500 | 1500 | 0.0 |
| GET `/admin/audit` | 2 | 0.00 | 1300 | 1300 | 1300 | 0.0 |
| GET `/dashboard/summary` | 709 | 0.00 | 59 | 1200 | 1900 | 3.9 |
| GET `/admin/users` | 3 | 0.00 | 47 | 1100 | 1100 | 0.0 |
| GET `/api/calendar/events` | 355 | 0.00 | 85 | 910 | 1300 | 2.0 |
| POST `/api/explorer/query [list]` | 1,878 | 0.00 | 49 | 870 | 1200 | 10.4 |
| GET `/api/profile/[id]` | 105 | 0.00 | 29 | 790 | 1300 | 0.6 |
| GET `/api/files/tree` | 372 | 0.00 | 29 | 770 | 1300 | 2.1 |
| GET `/api/dashboards` | 226 | 0.00 | 26 | 750 | 1100 | 1.3 |
| POST `/api/explorer/query [advanced]` | 476 | 0.00 | 41 | 740 | 1000 | 2.6 |
| GET `/health/status` | 5 | 0.00 | 44 | 730 | 730 | 0.0 |
| GET `/notifications` | 329 | 0.00 | 31 | 730 | 1000 | 1.8 |
| GET `/notifications/counts` | 1,644 | 0.00 | 27 | 720 | 1000 | 9.1 |
| GET `/api/me` | 919 | 0.00 | 22 | 710 | 960 | 5.1 |
| GET `/api/mail/threads` | 378 | 0.00 | 24 | 690 | 950 | 2.1 |
| GET `/api/records/[type]/[id]` | 1,200 | 0.00 | 24 | 690 | 1000 | 6.7 |
| GET `/security/overview` | 8 | 0.00 | 48 | 690 | 690 | 0.0 |
| GET `/exports` | 250 | 0.00 | 29 | 650 | 1100 | 1.4 |
| GET `/api/kanban/boards` | 502 | 0.00 | 23 | 630 | 990 | 2.8 |
| POST `/api/explorer/insights` | 470 | 0.00 | 18 | 620 | 1000 | 2.6 |
| GET `/api/search/global` | 1,801 | 0.00 | 39 | 600 | 1100 | 10.0 |
| GET `/api/kanban/boards/[id]` | 668 | 0.00 | 28 | 490 | 1100 | 3.7 |
| POST `/api/explorer/query [page]` | 497 | 0.00 | 34 | 480 | 980 | 2.8 |
| GET `/api/announcements` | 919 | 0.00 | 27 | 470 | 1100 | 5.1 |
| POST `/exports` | 10 | 0.00 | 29 | 450 | 450 | 0.1 |
| GET `/api/files` | 372 | 0.00 | 28 | 390 | 860 | 2.1 |
| POST `/api/kanban/cards/[id]/move` | 166 | 0.00 | 31 | 360 | 810 | 0.9 |
| GET `/api/audit/timeline` | 1,200 | 0.00 | 18 | 330 | 680 | 6.7 |
| GET `/dashboard/alerts` | 709 | 0.00 | 21 | 330 | 780 | 3.9 |
| GET `/api/reports` | 226 | 0.00 | 20 | 320 | 510 | 1.3 |
| POST `/exports/estimate` | 250 | 0.00 | 19 | 320 | 540 | 1.4 |
| GET `/api/comments` | 1,200 | 0.00 | 17 | 310 | 700 | 6.7 |
| GET `/api/activity` | 919 | 0.00 | 21 | 300 | 740 | 5.1 |
| GET `/api/relationships/[type]/[id]` | 362 | 0.00 | 27 | 240 | 750 | 2.0 |
| GET `/admin/logs` | 8 | 0.00 | 68 | 230 | 230 | 0.0 |
| GET `/api/records/[type]/[id]/tags` | 1,200 | 0.00 | 15 | 210 | 680 | 6.7 |
| GET `/favorites` | 919 | 0.00 | 15 | 210 | 690 | 5.1 |
| WS `/live [connect]` | 78 | 10.26 | 15 | 210 | 490 | 0.4 |
| GET `/admin/jobs` | 3 | 0.00 | 24 | 160 | 160 | 0.0 |
| GET `/recents` | 919 | 0.00 | 14 | 160 | 400 | 5.1 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| WS | `/live [connect]` | RuntimeError('unexpected first frame presence') | 8 |

## Server resources during the run

```
=798MiB / 60.43GiB
nucleus-postgres cpu=39.40% mem=574.1MiB / 60.43GiB
nucleus-redis cpu=0.86% mem=18.95MiB / 60.43GiB
pg connections: 41 active=2
04:22:53
nucleus-api cpu=116.58% mem=797.1MiB / 60.43GiB
nucleus-postgres cpu=48.07% mem=556.3MiB / 60.43GiB
nucleus-redis cpu=2.46% mem=18.43MiB / 60.43GiB
pg connections: 42 active=1
04:23:00
nucleus-api cpu=129.93% mem=804.6MiB / 60.43GiB
nucleus-postgres cpu=54.86% mem=575MiB / 60.43GiB
nucleus-redis cpu=0.67% mem=19.95MiB / 60.43GiB
pg connections: 41 active=2
04:23:07
nucleus-api cpu=146.72% mem=811.5MiB / 60.43GiB
nucleus-postgres cpu=68.75% mem=581.7MiB / 60.43GiB
nucleus-redis cpu=0.62% mem=20.18MiB / 60.43GiB
pg connections: 43 active=1
04:23:15
nucleus-api cpu=144.06% mem=812.9MiB / 60.43GiB
nucleus-postgres cpu=47.66% mem=557.3MiB / 60.43GiB
nucleus-redis cpu=2.31% mem=19.95MiB / 60.43GiB
pg connections: 41 active=2
04:23:22
nucleus-api cpu=141.97% mem=814.8MiB / 60.43GiB
nucleus-postgres cpu=66.51% mem=672.4MiB / 60.43GiB
nucleus-redis cpu=1.01% mem=21.34MiB / 60.43GiB
pg connections: 61 active=1
04:23:29
nucleus-api cpu=148.74% mem=815.2MiB / 60.43GiB
nucleus-postgres cpu=53.67% mem=613.6MiB / 60.43GiB
nucleus-redis cpu=0.63% mem=21.05MiB / 60.43GiB
pg connections: 50 active=1
04:23:36
nucleus-api cpu=145.48% mem=817.9MiB / 60.43GiB
nucleus-postgres cpu=30.93% mem=609.4MiB / 60.43GiB
nucleus-redis cpu=0.84% mem=23.02MiB / 60.43GiB
pg connections: 53 active=3
04:23:43
nucleus-api cpu=168.75% mem=818MiB / 60.43GiB
nucleus-postgres cpu=96.45% mem=585.2MiB / 60.43GiB
nucleus-redis cpu=0.64% mem=23.77MiB / 60.43GiB
pg connections: 56 active=2
04:23:50
nucleus-api cpu=178.47% mem=815.8MiB / 60.43GiB
nucleus-postgres cpu=28.65% mem=558.6MiB / 60.43GiB
nucleus-redis cpu=2.07% mem=24.75MiB / 60.43GiB
pg connections: 44 active=1
04:23:57
nucleus-api cpu=196.95% mem=817.7MiB / 60.43GiB
nucleus-postgres cpu=107.56% mem=668MiB / 60.43GiB
nucleus-redis cpu=1.21% mem=23.65MiB / 60.43GiB
pg connections: 60 active=1
04:24:04
nucleus-api cpu=195.48% mem=817.3MiB / 60.43GiB
nucleus-postgres cpu=65.42% mem=674.8MiB / 60.43GiB
nucleus-redis cpu=2.33% mem=25.91MiB / 60.43GiB
pg connections: 61 active=1
04:24:11
nucleus-api cpu=130.80% mem=818MiB / 60.43GiB
nucleus-postgres cpu=54.09% mem=584.6MiB / 60.43GiB
nucleus-redis cpu=1.08% mem=25.63MiB / 60.43GiB
pg connections: 41 active=2
04:24:18
nucleus-api cpu=200.25% mem=818.1MiB / 60.43GiB
nucleus-postgres cpu=41.23% mem=590.1MiB / 60.43GiB
nucleus-redis cpu=0.36% mem=26.46MiB / 60.43GiB
pg connections: 71 active=2
04:24:25
nucleus-api cpu=0.04% mem=812.6MiB / 60.43GiB
nucleus-postgres cpu=0.05% mem=539.8MiB / 60.43GiB
nucleus-redis cpu=1.47% mem=26.01MiB / 60.43GiB
pg connections: 41 active=1
04:24:32
nucleus-api cpu=0.43% mem=813.6MiB / 60.43GiB
nucleus-postgres cpu=0.06% mem=539.7MiB / 60.43GiB
nucleus-redis cpu=0.17% mem=25.29MiB / 60.43GiB
pg connections: 41 active=1
04:24:39
nucleus-api cpu=0.35% mem=813.5MiB / 60.43GiB
nucleus-postgres cpu=0.06% mem=540.1MiB / 60.43GiB
nucleus-redis cpu=0.14% mem=25.15MiB / 60.43GiB
pg connections: 41 active=1
04:24:46
nucleus-api cpu=0.09% mem=812.7MiB / 60.43GiB
nucleus-postgres cpu=0.05% mem=360.8MiB / 60.43GiB
nucleus-redis cpu=0.14% mem=24.16MiB / 60.43GiB
pg connections: 21 active=1
04:24:54
nucleus-api cpu=1.88% mem=814.1MiB / 60.43GiB
nucleus-postgres cpu=2.78% mem=361.8MiB / 60.43GiB
nucleus-redis cpu=0.18% mem=24.29MiB / 60.43GiB
pg connections: 21 active=1
04:25:01
nucleus-api cpu=0.06% mem=812.4MiB / 60.43GiB
nucleus-postgres cpu=0.05% mem=361.3MiB / 60.43GiB
nucleus-redis cpu=0.13% mem=24.55MiB / 60.43GiB
pg connections: 21 active=1
04:25:08
nucleus-api cpu=0.06% mem=812.4MiB / 60.43GiB
nucleus-postgres cpu=0.05% mem=361.2MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=24.04MiB / 60.43GiB
pg connections: 21 active=1
04:25:15
nucleus-api cpu=0.19% mem=812.4MiB / 60.43GiB
nucleus-postgres cpu=0.04% mem=360.9MiB / 60.43GiB
nucleus-redis cpu=1.62% mem=25.44MiB / 60.43GiB
pg connections: 21 active=1
```
