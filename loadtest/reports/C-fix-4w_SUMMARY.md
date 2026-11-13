# Load test summary — `C-fix-4w`

* peak users: **1000**, peak throughput **358 req/s**, mean 259 req/s
* requests: 62,344, failures: 1 (**0.00%**)
* latency overall: p50 98 ms · p95 1100 ms · p99 2700 ms · max 10038 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| GET `/admin/logs` | 15 | 0.00 | 64 | 2900 | 2900 | 0.1 |
| GET `/admin/users` | 12 | 0.00 | 140 | 2700 | 2700 | 0.0 |
| GET `/admin/audit` | 27 | 0.00 | 240 | 2100 | 3100 | 0.1 |
| POST `/exports` | 33 | 0.00 | 110 | 2000 | 4800 | 0.1 |
| GET `/admin/jobs` | 20 | 0.00 | 160 | 1800 | 1800 | 0.1 |
| GET `/dashboard/summary` | 1,979 | 0.00 | 250 | 1800 | 4500 | 8.2 |
| GET `/health/status` | 13 | 0.00 | 12 | 1800 | 1800 | 0.1 |
| GET `/admin/quality` | 19 | 0.00 | 240 | 1700 | 1700 | 0.1 |
| POST `/api/explorer/insights` | 1,304 | 0.00 | 140 | 1700 | 5100 | 5.4 |
| WS `/live [connect]` | 222 | 0.00 | 13 | 1400 | 2600 | 0.9 |
| GET `/api/calendar/events` | 1,030 | 0.00 | 230 | 1300 | 2600 | 4.3 |
| GET `/api/me` | 2,597 | 0.00 | 120 | 1300 | 3300 | 10.8 |
| GET `/api/dashboards` | 625 | 0.00 | 110 | 1200 | 2500 | 2.6 |
| POST `/api/explorer/query [advanced]` | 1,389 | 0.00 | 150 | 1200 | 3100 | 5.8 |
| POST `/api/explorer/query [list]` | 5,388 | 0.00 | 160 | 1200 | 3000 | 22.4 |
| GET `/api/mail/threads` | 995 | 0.00 | 100 | 1200 | 3400 | 4.1 |
| GET `/api/profile/[id]` | 315 | 0.00 | 140 | 1200 | 2000 | 1.3 |
| GET `/notifications` | 1,075 | 0.00 | 100 | 1200 | 4500 | 4.5 |
| GET `/api/files` | 991 | 0.00 | 110 | 1100 | 4100 | 4.1 |
| GET `/api/kanban/boards` | 1,362 | 0.00 | 84 | 1100 | 3100 | 5.7 |
| GET `/api/records/[type]/[id]` | 3,357 | 0.00 | 110 | 1100 | 2800 | 13.9 |
| GET `/api/search/global` | 5,041 | 0.00 | 120 | 1100 | 3100 | 20.9 |
| GET `/notifications/counts` | 4,651 | 0.00 | 110 | 1100 | 2800 | 19.3 |
| GET `/api/announcements` | 2,597 | 0.00 | 120 | 1000 | 2800 | 10.8 |
| POST `/api/explorer/query [page]` | 1,365 | 0.00 | 130 | 1000 | 2200 | 5.7 |
| GET `/api/files/tree` | 991 | 0.00 | 130 | 1000 | 2500 | 4.1 |
| POST `/api/kanban/cards/[id]/move` | 423 | 0.24 | 130 | 1000 | 2800 | 1.8 |
| GET `/exports` | 634 | 0.00 | 98 | 1000 | 2600 | 2.6 |
| GET `/api/kanban/boards/[id]` | 1,785 | 0.00 | 100 | 980 | 3300 | 7.4 |
| GET `/api/audit/timeline` | 3,357 | 0.00 | 77 | 900 | 2400 | 13.9 |
| GET `/dashboard/alerts` | 1,979 | 0.00 | 73 | 890 | 2200 | 8.2 |
| GET `/api/reports` | 625 | 0.00 | 82 | 860 | 2300 | 2.6 |
| GET `/api/activity` | 2,597 | 0.00 | 78 | 850 | 2000 | 10.8 |
| POST `/exports/estimate` | 634 | 0.00 | 66 | 820 | 2000 | 2.6 |
| GET `/api/comments` | 3,357 | 0.00 | 68 | 780 | 2200 | 13.9 |
| GET `/recents` | 2,597 | 0.00 | 55 | 780 | 1700 | 10.8 |
| GET `/api/records/[type]/[id]/tags` | 3,357 | 0.00 | 58 | 760 | 2000 | 13.9 |
| GET `/favorites` | 2,597 | 0.00 | 60 | 750 | 1900 | 10.8 |
| GET `/api/relationships/[type]/[id]` | 978 | 0.00 | 75 | 740 | 2000 | 4.1 |
| GET `/security/overview` | 11 | 0.00 | 38 | 520 | 520 | 0.0 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| POST | `/api/kanban/cards/[id]/move` | CatchResponseError('HTTP 503') | 1 |

## Server resources during the run

```
em=293.1MiB / 60.43GiB
nucleus-postgres cpu=136.17% mem=546.2MiB / 60.43GiB
nucleus-redis cpu=1.43% mem=31.83MiB / 60.43GiB
pg connections: 43 active=3
20:14:02
nucleus-api cpu=0.21% mem=293.6MiB / 60.43GiB
nucleus-postgres cpu=136.83% mem=515MiB / 60.43GiB
nucleus-redis cpu=1.59% mem=30.77MiB / 60.43GiB
pg connections: 38 active=1
20:14:09
nucleus-api cpu=0.22% mem=299MiB / 60.43GiB
nucleus-postgres cpu=138.62% mem=494.3MiB / 60.43GiB
nucleus-redis cpu=1.44% mem=31.63MiB / 60.43GiB
pg connections: 34 active=1
20:14:16
nucleus-api cpu=0.53% mem=305MiB / 60.43GiB
nucleus-postgres cpu=196.14% mem=586.7MiB / 60.43GiB
nucleus-redis cpu=1.91% mem=35.68MiB / 60.43GiB
pg connections: 47 active=3
20:14:23
nucleus-api cpu=2.01% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=168.91% mem=517.5MiB / 60.43GiB
nucleus-redis cpu=2.83% mem=36.1MiB / 60.43GiB
pg connections: 41 active=2
20:14:30
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=112.40% mem=540.4MiB / 60.43GiB
nucleus-redis cpu=1.29% mem=36.03MiB / 60.43GiB
pg connections: 47 active=7
20:14:37
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=128.54% mem=506.4MiB / 60.43GiB
nucleus-redis cpu=1.18% mem=37.64MiB / 60.43GiB
pg connections: 45 active=3
20:14:44
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=123.59% mem=580MiB / 60.43GiB
nucleus-redis cpu=1.75% mem=39.01MiB / 60.43GiB
pg connections: 49 active=2
20:14:51
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=119.77% mem=510.7MiB / 60.43GiB
nucleus-redis cpu=1.29% mem=40.88MiB / 60.43GiB
pg connections: 41 active=4
20:14:58
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=199.98% mem=630.6MiB / 60.43GiB
nucleus-redis cpu=1.22% mem=44.56MiB / 60.43GiB
pg connections: 46 active=2
20:15:05
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=134.78% mem=573.5MiB / 60.43GiB
nucleus-redis cpu=1.62% mem=44.21MiB / 60.43GiB
pg connections: 46 active=3
20:15:12
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=76.29% mem=479.9MiB / 60.43GiB
nucleus-redis cpu=1.67% mem=45.02MiB / 60.43GiB
pg connections: 38 active=1
20:15:19
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=142.93% mem=604.4MiB / 60.43GiB
nucleus-redis cpu=1.65% mem=46.06MiB / 60.43GiB
pg connections: 47 active=1
20:15:26
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=140.04% mem=520.4MiB / 60.43GiB
nucleus-redis cpu=1.58% mem=47.34MiB / 60.43GiB
pg connections: 46 active=3
20:15:33
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=140.05% mem=551.1MiB / 60.43GiB
nucleus-redis cpu=1.33% mem=49.36MiB / 60.43GiB
pg connections: 41 active=1
20:15:40
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=17.85% mem=454.6MiB / 60.43GiB
nucleus-redis cpu=0.62% mem=49.57MiB / 60.43GiB
pg connections: 33 active=1
20:15:48
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=2.79% mem=430.7MiB / 60.43GiB
nucleus-redis cpu=0.13% mem=48.82MiB / 60.43GiB
pg connections: 31 active=1
20:15:55
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=0.03% mem=430.4MiB / 60.43GiB
nucleus-redis cpu=0.08% mem=48.8MiB / 60.43GiB
pg connections: 31 active=1
20:16:02
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=0.02% mem=430.4MiB / 60.43GiB
nucleus-redis cpu=0.07% mem=48.59MiB / 60.43GiB
pg connections: 31 active=1
20:16:09
nucleus-api cpu=0.02% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=0.02% mem=430.4MiB / 60.43GiB
nucleus-redis cpu=1.42% mem=48.62MiB / 60.43GiB
pg connections: 31 active=1
20:16:16
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=0.24% mem=430.4MiB / 60.43GiB
nucleus-redis cpu=0.11% mem=48.85MiB / 60.43GiB
pg connections: 31 active=1
20:16:23
nucleus-api cpu=1.76% mem=307.9MiB / 60.43GiB
nucleus-postgres cpu=2.67% mem=430.4MiB / 60.43GiB
nucleus-redis cpu=0.10% mem=48.59MiB / 60.43GiB
pg connections: 31 active=1
20:16:30
```
