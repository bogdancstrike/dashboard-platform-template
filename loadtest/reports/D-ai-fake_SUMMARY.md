# Load test summary — `D-ai-fake`

* peak users: **300**, peak throughput **118 req/s**, mean 104 req/s
* requests: 12,510, failures: 57 (**0.46%**)
* latency overall: p50 12 ms · p95 70 ms · p99 620 ms · max 1208 ms

| endpoint | reqs | fail % | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| GET `/api/calendar/events` | 194 | 0.00 | 56 | 650 | 970 | 1.6 |
| GET `/api/profile/[id]` | 66 | 0.00 | 17 | 490 | 620 | 0.5 |
| GET `/admin/logs` | 7 | 0.00 | 28 | 460 | 460 | 0.1 |
| POST `/api/explorer/insights` | 274 | 0.00 | 9 | 380 | 730 | 2.3 |
| GET `/notifications` | 181 | 0.00 | 11 | 330 | 590 | 1.5 |
| GET `/api/kanban/boards` | 256 | 0.00 | 11 | 280 | 900 | 2.1 |
| POST `/api/explorer/query [list]` | 1,037 | 0.00 | 26 | 270 | 770 | 8.6 |
| POST `/api/explorer/query [advanced]` | 280 | 0.00 | 23 | 260 | 970 | 2.3 |
| GET `/notifications/counts` | 902 | 0.00 | 10 | 260 | 690 | 7.5 |
| GET `/api/records/[type]/[id]` | 652 | 0.00 | 11 | 190 | 720 | 5.4 |
| GET `/exports` | 132 | 0.00 | 15 | 190 | 620 | 1.1 |
| GET `/dashboard/summary` | 393 | 0.00 | 11 | 160 | 820 | 3.3 |
| GET `/api/files/tree` | 196 | 0.00 | 14 | 130 | 760 | 1.6 |
| GET `/api/me` | 536 | 0.00 | 11 | 120 | 680 | 4.4 |
| GET `/admin/quality` | 1 | 0.00 | 110 | 110 | 110 | 0.0 |
| GET `/api/search/global` | 926 | 0.00 | 26 | 96 | 630 | 7.7 |
| GET `/api/dashboards` | 127 | 0.00 | 14 | 89 | 740 | 1.1 |
| GET `/api/announcements` | 536 | 0.00 | 16 | 80 | 620 | 4.4 |
| GET `/api/kanban/boards/[id]` | 341 | 0.00 | 14 | 79 | 580 | 2.8 |
| POST `/exports/estimate` | 132 | 0.00 | 9 | 70 | 160 | 1.1 |
| GET `/api/reports` | 127 | 0.00 | 11 | 68 | 90 | 1.1 |
| WS `/live [connect]` | 39 | 0.00 | 7 | 58 | 68 | 0.3 |
| GET `/api/mail/threads` | 201 | 0.00 | 12 | 57 | 370 | 1.7 |
| POST `/api/kanban/cards/[id]/move` | 85 | 67.06 | 12 | 55 | 150 | 0.7 |
| GET `/dashboard/alerts` | 393 | 0.00 | 10 | 52 | 100 | 3.3 |
| POST `/api/explorer/query [page]` | 255 | 0.00 | 16 | 46 | 240 | 2.1 |
| GET `/api/relationships/[type]/[id]` | 198 | 0.00 | 16 | 46 | 72 | 1.6 |
| GET `/api/audit/timeline` | 652 | 0.00 | 9 | 45 | 95 | 5.4 |
| POST `/api/assistant/filters [fake]` | 132 | 0.00 | 13 | 44 | 510 | 1.1 |
| GET `/api/files` | 196 | 0.00 | 13 | 35 | 150 | 1.6 |
| POST `/api/assistant/page-help [fake]` | 132 | 0.00 | 10 | 34 | 200 | 1.1 |
| GET `/api/activity` | 536 | 0.00 | 12 | 32 | 96 | 4.4 |
| GET `/admin/audit` | 3 | 0.00 | 16 | 27 | 27 | 0.0 |
| GET `/api/comments` | 652 | 0.00 | 8 | 27 | 62 | 5.4 |
| GET `/admin/users` | 2 | 0.00 | 26 | 26 | 26 | 0.0 |
| GET `/security/overview` | 4 | 0.00 | 21 | 25 | 25 | 0.0 |
| POST `/exports` | 4 | 0.00 | 16 | 22 | 22 | 0.0 |
| GET `/favorites` | 536 | 0.00 | 8 | 21 | 61 | 4.4 |
| GET `/admin/jobs` | 4 | 0.00 | 20 | 20 | 20 | 0.0 |
| GET `/api/records/[type]/[id]/tags` | 652 | 0.00 | 8 | 20 | 57 | 5.4 |
| GET `/recents` | 536 | 0.00 | 8 | 18 | 46 | 4.4 |
| GET `/health/status` | 2 | 0.00 | 8 | 8 | 8 | 0.0 |

## Failures

| method | name | error | occurrences |
|---|---|---|---:|
| POST | `/api/kanban/cards/[id]/move` | CatchResponseError('HTTP 404') | 57 |

## Server resources during the run

```

nucleus-api cpu=0.02% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=39.32% mem=464.5MiB / 60.43GiB
nucleus-redis cpu=0.58% mem=40.09MiB / 60.43GiB
pg connections: 31 active=2
20:18:32
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=56.05% mem=484MiB / 60.43GiB
nucleus-redis cpu=0.74% mem=41.41MiB / 60.43GiB
pg connections: 32 active=2
20:18:39
nucleus-api cpu=1.89% mem=307.9MiB / 60.43GiB
nucleus-postgres cpu=42.13% mem=465.8MiB / 60.43GiB
nucleus-redis cpu=0.52% mem=38.25MiB / 60.43GiB
pg connections: 31 active=2
20:18:46
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=59.65% mem=499.3MiB / 60.43GiB
nucleus-redis cpu=0.77% mem=38.38MiB / 60.43GiB
pg connections: 32 active=3
20:18:53
nucleus-api cpu=1.69% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=38.89% mem=472.7MiB / 60.43GiB
nucleus-redis cpu=0.56% mem=38.39MiB / 60.43GiB
pg connections: 31 active=2
20:19:00
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=35.83% mem=472.1MiB / 60.43GiB
nucleus-redis cpu=0.82% mem=35.82MiB / 60.43GiB
pg connections: 31 active=1
20:19:07
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=40.42% mem=480.1MiB / 60.43GiB
nucleus-redis cpu=0.63% mem=33.08MiB / 60.43GiB
pg connections: 31 active=2
20:19:14
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=39.03% mem=509.1MiB / 60.43GiB
nucleus-redis cpu=0.77% mem=30.33MiB / 60.43GiB
pg connections: 31 active=1
20:19:21
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=34.78% mem=497.5MiB / 60.43GiB
nucleus-redis cpu=0.96% mem=32.21MiB / 60.43GiB
pg connections: 31 active=2
20:19:29
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=40.82% mem=510MiB / 60.43GiB
nucleus-redis cpu=0.61% mem=29.13MiB / 60.43GiB
pg connections: 31 active=1
20:19:36
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=37.70% mem=489.8MiB / 60.43GiB
nucleus-redis cpu=0.77% mem=28.65MiB / 60.43GiB
pg connections: 31 active=1
20:19:43
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=40.69% mem=488.8MiB / 60.43GiB
nucleus-redis cpu=0.55% mem=27.7MiB / 60.43GiB
pg connections: 31 active=1
20:19:50
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=33.32% mem=484.7MiB / 60.43GiB
nucleus-redis cpu=0.75% mem=25.63MiB / 60.43GiB
pg connections: 31 active=2
20:19:57
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=28.47% mem=480.7MiB / 60.43GiB
nucleus-redis cpu=0.53% mem=24.27MiB / 60.43GiB
pg connections: 31 active=1
20:20:04
nucleus-api cpu=0.03% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=2.59% mem=449.8MiB / 60.43GiB
nucleus-redis cpu=0.27% mem=23.63MiB / 60.43GiB
pg connections: 31 active=1
20:20:11
nucleus-api cpu=0.03% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=0.01% mem=447.9MiB / 60.43GiB
nucleus-redis cpu=0.13% mem=21.57MiB / 60.43GiB
pg connections: 31 active=1
20:20:18
nucleus-api cpu=0.02% mem=307.6MiB / 60.43GiB
nucleus-postgres cpu=0.01% mem=447.7MiB / 60.43GiB
nucleus-redis cpu=0.14% mem=19.5MiB / 60.43GiB
pg connections: 31 active=1
20:20:25
nucleus-api cpu=0.02% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=22.93% mem=461MiB / 60.43GiB
nucleus-redis cpu=1.58% mem=19.56MiB / 60.43GiB
pg connections: 32 active=2
20:20:32
nucleus-api cpu=0.02% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=48.08% mem=478MiB / 60.43GiB
nucleus-redis cpu=0.16% mem=17.42MiB / 60.43GiB
pg connections: 32 active=1
20:20:39
nucleus-api cpu=0.79% mem=307.7MiB / 60.43GiB
nucleus-postgres cpu=13.08% mem=458.8MiB / 60.43GiB
nucleus-redis cpu=1.44% mem=16.58MiB / 60.43GiB
pg connections: 32 active=1
20:20:46
nucleus-api cpu=0.04% mem=310.4MiB / 60.43GiB
nucleus-postgres cpu=0.27% mem=469.6MiB / 60.43GiB
nucleus-redis cpu=0.19% mem=15.52MiB / 60.43GiB
pg connections: 31 active=1
20:20:53
nucleus-api cpu=1.79% mem=314MiB / 60.43GiB
nucleus-postgres cpu=2.85% mem=453.8MiB / 60.43GiB
nucleus-redis cpu=0.15% mem=14.49MiB / 60.43GiB
pg connections: 31 active=1
```
