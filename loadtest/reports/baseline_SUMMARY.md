# Load test summary — `baseline`

* peak users: **1000**, peak throughput **209 req/s**, mean 93 req/s
* requests: 30,232, failures: 2,925 (**9.68%**)
* latency overall: p50 1500 ms · p95 31000 ms · p99 38000 ms · max 55573 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| POST `/api/explorer/query [page]` | 630 | 1.90 | 2000 | 35000 | 42000 | 1.9 |
| POST `/exports` | 19 | 10.53 | 1200 | 35000 | 35000 | 0.1 |
| GET `/admin/users` | 8 | 12.50 | 1500 | 34000 | 34000 | 0.0 |
| GET `/api/announcements` | 1,318 | 11.00 | 1700 | 34000 | 40000 | 4.0 |
| GET `/api/audit/timeline` | 1,608 | 9.39 | 1700 | 34000 | 40000 | 4.9 |
| GET `/api/kanban/boards/[id]` | 730 | 2.60 | 2400 | 34000 | 40000 | 2.2 |
| GET `/dashboard/alerts` | 960 | 10.94 | 1700 | 34000 | 42000 | 2.9 |
| POST `/api/explorer/insights` | 634 | 7.73 | 2600 | 33000 | 43000 | 1.9 |
| GET `/api/files` | 494 | 8.70 | 1800 | 33000 | 42000 | 1.5 |
| POST `/api/kanban/cards/[id]/move` | 120 | 61.67 | 2000 | 33000 | 44000 | 0.4 |
| GET `/api/reports` | 315 | 12.06 | 1300 | 33000 | 38000 | 1.0 |
| GET `/api/search/global` | 2,329 | 7.94 | 1900 | 33000 | 41000 | 7.1 |
| GET `/dashboard/summary` | 960 | 8.96 | 2700 | 33000 | 41000 | 2.9 |
| POST `/exports/estimate` | 296 | 8.45 | 1800 | 33000 | 37000 | 0.9 |
| GET `/admin/jobs` | 4 | 0.00 | 430 | 32000 | 32000 | 0.0 |
| GET `/api/dashboards` | 315 | 10.79 | 1800 | 32000 | 37000 | 1.0 |
| GET `/api/kanban/boards` | 655 | 6.87 | 1700 | 32000 | 41000 | 2.0 |
| GET `/api/mail/threads` | 440 | 10.23 | 1700 | 31000 | 38000 | 1.3 |
| GET `/exports` | 296 | 7.09 | 1900 | 31000 | 36000 | 0.9 |
| GET `/api/calendar/events` | 480 | 7.08 | 1900 | 30000 | 37000 | 1.5 |
| POST `/api/explorer/query [list]` | 2,608 | 8.17 | 1800 | 30000 | 36000 | 8.0 |
| GET `/api/files/tree` | 494 | 7.09 | 1700 | 30000 | 38000 | 1.5 |
| GET `/api/me` | 1,318 | 8.88 | 1400 | 30000 | 37000 | 4.0 |
| GET `/api/records/[type]/[id]` | 1,608 | 7.59 | 1600 | 30000 | 38000 | 4.9 |
| GET `/notifications` | 468 | 9.62 | 1400 | 30000 | 39000 | 1.4 |
| GET `/notifications/counts` | 2,178 | 7.90 | 1600 | 30000 | 37000 | 6.7 |
| POST `/api/explorer/query [advanced]` | 607 | 9.23 | 1500 | 29000 | 37000 | 1.9 |
| GET `/api/profile/[id]` | 154 | 7.14 | 2000 | 29000 | 38000 | 0.5 |
| GET `/security/overview` | 7 | 14.29 | 880 | 28000 | 28000 | 0.0 |
| GET `/api/records/[type]/[id]/tags` | 1,608 | 9.45 | 950 | 18000 | 34000 | 4.9 |
| GET `/favorites` | 1,318 | 11.00 | 880 | 18000 | 33000 | 4.0 |
| GET `/health/status` | 12 | 0.00 | 1400 | 16000 | 16000 | 0.0 |
| GET `/recents` | 1,318 | 11.00 | 780 | 16000 | 35000 | 4.0 |
| GET `/api/activity` | 1,318 | 11.00 | 1100 | 15000 | 34000 | 4.0 |
| GET `/api/comments` | 1,608 | 9.45 | 1000 | 15000 | 35000 | 4.9 |
| GET `/api/relationships/[type]/[id]` | 481 | 8.32 | 920 | 14000 | 33000 | 1.5 |
| WS `/live [connect]` | 407 | 40.79 | 6300 | 12000 | 16000 | 1.2 |
| GET `/admin/logs` | 3 | 0.00 | 730 | 6200 | 6200 | 0.0 |
| GET `/admin/quality` | 6 | 16.67 | 2800 | 4000 | 4000 | 0.0 |
| GET `/admin/audit` | 7 | 0.00 | 210 | 3000 | 3000 | 0.0 |
| WS `/live [drop]` | 93 | 100.00 | 0 | 0 | 0 | 0.3 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| POST | `/api/explorer/query [list]` | CatchResponseError('HTTP 0') | 213 |
| GET | `/api/search/global` | CatchResponseError('HTTP 0') | 185 |
| GET | `/notifications/counts` | CatchResponseError('HTTP 0') | 172 |
| GET | `/api/comments` | CatchResponseError('HTTP 0') | 152 |
| GET | `/api/records/[type]/[id]/tags` | CatchResponseError('HTTP 0') | 152 |
| GET | `/api/audit/timeline` | CatchResponseError('HTTP 0') | 151 |
| GET | `/favorites` | CatchResponseError('HTTP 0') | 145 |
| GET | `/api/announcements` | CatchResponseError('HTTP 0') | 145 |
| GET | `/recents` | CatchResponseError('HTTP 0') | 145 |
| GET | `/api/activity` | CatchResponseError('HTTP 0') | 145 |
| GET | `/api/records/[type]/[id]` | CatchResponseError('HTTP 0') | 122 |
| GET | `/api/me` | CatchResponseError('HTTP 0') | 117 |
| WS | `/live [connect]` | WebSocketTimeoutException('Connection timed out') | 117 |
| GET | `/dashboard/alerts` | CatchResponseError('HTTP 0') | 105 |
| WS | `/live [drop]` | WebSocketConnectionClosedException('Connection to remote host was lost.') | 93 |
| GET | `/dashboard/summary` | CatchResponseError('HTTP 0') | 86 |
| POST | `/api/kanban/cards/[id]/move` | CatchResponseError('HTTP 404') | 65 |
| POST | `/api/explorer/query [advanced]` | CatchResponseError('HTTP 0') | 56 |
| POST | `/api/explorer/insights` | CatchResponseError('HTTP 0') | 49 |
| GET | `/api/kanban/boards` | CatchResponseError('HTTP 0') | 45 |
| GET | `/notifications` | CatchResponseError('HTTP 0') | 45 |
| GET | `/api/mail/threads` | CatchResponseError('HTTP 0') | 45 |
| GET | `/api/files` | CatchResponseError('HTTP 0') | 43 |
| GET | `/api/relationships/[type]/[id]` | CatchResponseError('HTTP 0') | 40 |
| GET | `/api/reports` | CatchResponseError('HTTP 0') | 38 |

## Server resources during the run

```
5.5MiB / 60.43GiB
nucleus-postgres cpu=33.36% mem=357.6MiB / 60.43GiB
nucleus-redis cpu=0.33% mem=14.01MiB / 60.43GiB
pg connections: 21 active=1
19:52:52
nucleus-api cpu=1.47% mem=812.7MiB / 60.43GiB
nucleus-postgres cpu=0.94% mem=359.6MiB / 60.43GiB
nucleus-redis cpu=0.14% mem=13.92MiB / 60.43GiB
pg connections: 21 active=1
19:52:59
nucleus-api cpu=0.13% mem=811.4MiB / 60.43GiB
nucleus-postgres cpu=2.58% mem=360.1MiB / 60.43GiB
nucleus-redis cpu=1.38% mem=14.81MiB / 60.43GiB
pg connections: 21 active=1
19:53:06
nucleus-api cpu=98.33% mem=560.5MiB / 60.43GiB
nucleus-postgres cpu=38.09% mem=395.7MiB / 60.43GiB
nucleus-redis cpu=0.21% mem=13.62MiB / 60.43GiB
pg connections: 41 active=4
19:53:13
nucleus-api cpu=199.70% mem=382.9MiB / 60.43GiB
nucleus-postgres cpu=58.18% mem=529.2MiB / 60.43GiB
nucleus-redis cpu=1.97% mem=15.34MiB / 60.43GiB
pg connections: 61 active=44
19:53:20
nucleus-api cpu=128.39% mem=537.1MiB / 60.43GiB
nucleus-postgres cpu=40.56% mem=532.5MiB / 60.43GiB
nucleus-redis cpu=0.45% mem=15.49MiB / 60.43GiB
pg connections: 42 active=13
19:53:27
nucleus-api cpu=146.33% mem=640.9MiB / 60.43GiB
nucleus-postgres cpu=53.32% mem=713.8MiB / 60.43GiB
nucleus-redis cpu=0.70% mem=15.49MiB / 60.43GiB
pg connections: 61 active=50
19:53:34
nucleus-api cpu=163.26% mem=701.5MiB / 60.43GiB
nucleus-postgres cpu=58.53% mem=764.8MiB / 60.43GiB
nucleus-redis cpu=0.99% mem=16.87MiB / 60.43GiB
pg connections: 61 active=49
19:53:41
nucleus-api cpu=104.62% mem=778.7MiB / 60.43GiB
nucleus-postgres cpu=61.56% mem=584.6MiB / 60.43GiB
nucleus-redis cpu=0.39% mem=15.3MiB / 60.43GiB
pg connections: 41 active=8
19:53:48
nucleus-api cpu=100.76% mem=814.5MiB / 60.43GiB
nucleus-postgres cpu=28.67% mem=607.9MiB / 60.43GiB
nucleus-redis cpu=1.70% mem=17.2MiB / 60.43GiB
pg connections: 41 active=8
19:53:55
nucleus-api cpu=106.90% mem=810.2MiB / 60.43GiB
nucleus-postgres cpu=13.11% mem=332.4MiB / 60.43GiB
nucleus-redis cpu=0.25% mem=16.38MiB / 60.43GiB
pg connections: 41 active=20
19:54:02
nucleus-api cpu=100.45% mem=688.3MiB / 60.43GiB
nucleus-postgres cpu=59.72% mem=505.8MiB / 60.43GiB
nucleus-redis cpu=0.57% mem=15.64MiB / 60.43GiB
pg connections: 44 active=19
19:54:09
nucleus-api cpu=103.93% mem=762MiB / 60.43GiB
nucleus-postgres cpu=64.04% mem=568.9MiB / 60.43GiB
nucleus-redis cpu=0.41% mem=16.35MiB / 60.43GiB
pg connections: 44 active=9
19:54:17
nucleus-api cpu=142.02% mem=560MiB / 60.43GiB
nucleus-postgres cpu=73.48% mem=568.3MiB / 60.43GiB
nucleus-redis cpu=0.94% mem=16.71MiB / 60.43GiB
pg connections: 51 active=28
19:54:24
nucleus-api cpu=147.83% mem=612.4MiB / 60.43GiB
nucleus-postgres cpu=86.08% mem=613MiB / 60.43GiB
nucleus-redis cpu=1.95% mem=17.6MiB / 60.43GiB
pg connections: 47 active=24
19:54:31
nucleus-api cpu=1.96% mem=608.1MiB / 60.43GiB
nucleus-postgres cpu=5.03% mem=348MiB / 60.43GiB
nucleus-redis cpu=0.16% mem=15.77MiB / 60.43GiB
pg connections: 21 active=1
19:54:38
nucleus-api cpu=0.15% mem=608.4MiB / 60.43GiB
nucleus-postgres cpu=23.60% mem=373.9MiB / 60.43GiB
nucleus-redis cpu=0.11% mem=17.27MiB / 60.43GiB
pg connections: 23 active=2
19:54:45
nucleus-api cpu=102.17% mem=246.4MiB / 60.43GiB
nucleus-postgres cpu=6.86% mem=241.3MiB / 60.43GiB
nucleus-redis cpu=0.06% mem=15.57MiB / 60.43GiB
pg connections: 11 active=1
19:54:52
nucleus-api cpu=0.02% mem=306.8MiB / 60.43GiB
nucleus-postgres cpu=0.02% mem=239.8MiB / 60.43GiB
nucleus-redis cpu=0.11% mem=15.49MiB / 60.43GiB
pg connections: 11 active=1
19:54:59
nucleus-api cpu=0.03% mem=306.8MiB / 60.43GiB
nucleus-postgres cpu=2.69% mem=241.3MiB / 60.43GiB
nucleus-redis cpu=1.41% mem=15.99MiB / 60.43GiB
pg connections: 11 active=1
19:55:06
nucleus-api cpu=0.09% mem=307MiB / 60.43GiB
nucleus-postgres cpu=28.89% mem=240.3MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=15.24MiB / 60.43GiB
pg connections: 11 active=1
19:55:13
nucleus-api cpu=0.03% mem=306.7MiB / 60.43GiB
nucleus-postgres cpu=4.59% mem=249.9MiB / 60.43GiB
nucleus-redis cpu=1.51% mem=15.1MiB / 60.43GiB
pg connections: 12 active=1
```
