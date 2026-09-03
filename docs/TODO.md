# Implementation Tracker

Living checklist for the Enterprise Application Template Platform. Updated after
every task. Section numbers map to the requirement spec (§1–§77).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundations

- [x] Repo scaffold (`backend/`, `frontend/`, `docs/`, compose)
- [x] QF framework wheel vendored into `backend/dist/`
- [ ] `docker-compose.yml` — postgres 18, redis 8, api, seed, frontend
- [~] `README.md` done; `.env.example`, `Makefile` outstanding
- [ ] `docs/architecture.md`, `docs/features.md`

## Phase 1 — Backend core

- [x] `src/config.py` + top-level `config.py` shim (QF requires it)
- [x] `wsgi.py` / `main.py` / `gunicorn.conf.py`
- [x] `core/db.py` — engine, `session_scope`
- [x] `core/errors.py` — domain error taxonomy + Flask/RESTX handlers
- [x] `core/pagination.py` — page/size envelope
- [x] `core/query.py` — declarative FieldSet filter/sort/search/facets
- [x] `core/rules.py` — RAQB JSON-logic tree → SQLAlchemy (§4, §51)
- [x] `core/cache.py` — Redis caching helpers (§53)
- [x] `core/auth.py` — JWT sessions, personas, RBAC decorators (§58)
- [x] `core/audit.py` — audit trail writer (§21)
- [x] `core/correlation.py` — correlation id + CORS

## Phase 2 — Data model

- [x] Identity: organizations, departments, teams, regions, users, roles,
      permissions, groups, sessions, login history, security events
- [x] Business: projects, customers, tickets, orders, tasks, documents,
      devices, events (calendar)
- [x] Content: emails/threads/attachments, comments, tags, files/folders
- [x] Platform: notifications, audit logs, system logs, jobs, scheduled tasks,
      feature flags, api clients, integrations, alert rules, email templates
- [x] Personalization: saved searches, saved views, favorites, recent items,
      dashboards/widgets, preferences, reports

## Phase 3 — Seeds (§57)

- [ ] Deterministic generator: 20 orgs, 150 users, 50 projects, 500 tasks,
      1 000 audit rows, 200 emails, 100 files, 100 jobs, thousands of records
- [ ] Referential consistency across all modules

## Phase 4 — Backend API

- [~] Health/readiness done; `/api/me`, auth + persona switch outstanding
- [ ] Dashboard KPIs, charts, alerts, drill-down (§2, §44, §66)
- [ ] Generic entity list/detail/CRUD/bulk (§3, §7, §8, §43)
- [ ] Search: simple, advanced (RAQB), saved searches (§4, §5, §6)
- [ ] Admin: users, groups, roles, permissions, settings, flags, api, jobs
- [ ] Email module, tasks, calendar, files, audit, logs, health, reports
- [ ] Import/export pipelines (§29, §30)

## Phase 5 — Frontend foundation

- [ ] Vite + React + TS + AntD + ECharts + RAQB toolchain
- [ ] Theme tokens, AntD theme, CSS vars, chart theme, density modes
- [ ] API client, query hooks, URL-state persistence (§69, §72)
- [ ] App shell: sidebar, header, breadcrumbs, global search, notifications,
      profile, quick actions, recents, favorites, command palette

## Phase 6 — Frontend pages

- [ ] Dashboard + dashboard builder
- [ ] Data table showcase, entity lists, entity detail, forms, wizard
- [ ] Search (simple/advanced/saved/results)
- [ ] Admin area, users, roles matrix
- [ ] Email inbox/detail/compose
- [ ] Tasks (kanban/table/list), calendar, file manager
- [ ] Audit logs, system logs, jobs, system health, api, integrations, flags
- [ ] Reports, import, export
- [ ] Component showcase, template gallery, error pages
- [ ] Preferences, security, organization settings

## Phase 7 — Verification

- [ ] `docker compose up` clean-boot green
- [ ] Seed verified (row counts + referential checks)
- [~] Backend tests — 34 passing for routing, health, meta, HTTP contract
- [ ] Frontend typecheck + build
- [ ] Docs complete
