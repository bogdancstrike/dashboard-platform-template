# Nucleus — the commands worth remembering.
#
# `make up` is the whole platform from nothing: database, cache, identity,
# seed, API and the SPA.

SHELL := /bin/bash
COMPOSE := docker compose
BACKEND := backend
FRONTEND := frontend
PY := $(BACKEND)/.venv/bin/python

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ── The stack ────────────────────────────────────────────────────────────

.PHONY: up
up: ## Build and start everything, then wait for it to be healthy
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory wait
	@$(MAKE) --no-print-directory urls

.PHONY: down
down: ## Stop everything, keeping the data
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop everything and delete the volumes — database included
	$(COMPOSE) down -v --remove-orphans

.PHONY: wait
wait: ## Block until the API answers its readiness probe
	@echo "waiting for the API…"
	@for i in $$(seq 1 120); do \
		if curl -fsS "http://localhost:$${API_PORT:-5101}/platform/health/ready" >/dev/null 2>&1; then \
			echo "ready"; exit 0; fi; \
		sleep 2; \
	done; \
	echo "the API never became ready; try 'make logs'"; exit 1

.PHONY: urls
urls: ## Print where everything is
	@echo
	@echo "  app        http://localhost:$${FRONTEND_PORT:-5174}"
	@echo "  api docs   http://localhost:$${API_PORT:-5101}/"
	@echo "  health     http://localhost:$${API_PORT:-5101}/platform/health/status"
	@echo "  keycloak   http://localhost:$${KEYCLOAK_PORT:-8080}  (admin/admin)"
	@echo
	@echo "  sign in as admin/admin, manager/manager, operator/operator,"
	@echo "  analyst/analyst or user/user"
	@echo

.PHONY: logs
logs: ## Follow the logs of every service
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Show service status
	$(COMPOSE) ps

.PHONY: restart-api
restart-api: ## Rebuild and restart just the API
	$(COMPOSE) up -d --build api

# ── Data ─────────────────────────────────────────────────────────────────

.PHONY: seed
seed: ## Seed, if the database is empty
	$(COMPOSE) run --rm seed

.PHONY: reseed
reseed: ## Drop every table and seed again
	$(COMPOSE) run --rm -e SEED_ARGS=--reset seed

# ── Schema (Alembic) ─────────────────────────────────────────────────────
#
# The schema is versioned by revision. The seed still calls `create_all` for a
# database that is *empty* — a first `docker compose up` should not need two
# commands — and `--sync-schema` still repairs an existing one additively; what
# these add is the answer for a database that has to move from one shape to
# another with rows in it. `migrations/env.py` reads `DATABASE_URL`, so all
# three see one database.

.PHONY: migrate
migrate: ## Bring the database up to the latest revision
	$(COMPOSE) run --rm --no-deps seed python -m alembic upgrade head

.PHONY: migration-status
migration-status: ## Which revision the database is at, and what is pending
	$(COMPOSE) run --rm --no-deps seed python -m alembic current --verbose
	$(COMPOSE) run --rm --no-deps seed python -m alembic heads

.PHONY: migration
migration: ## Generate a revision from the models — make migration m="what changed"
	@test -n "$(m)" || { echo 'usage: make migration m="what changed"'; exit 2; }
	# Written into the repository, not into the image: the container's copy of
	# `migrations/` is a build artefact, and a revision generated there would
	# be lost with the container.
	cd $(BACKEND) && DATABASE_URL="postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform" \
		../$(PY) -m alembic revision --autogenerate -m "$(m)"

.PHONY: migration-sql
migration-sql: ## Print the SQL an upgrade would run, for somebody else to apply
	cd $(BACKEND) && DATABASE_URL="postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform" \
		../$(PY) -m alembic upgrade head --sql

.PHONY: check-seed
check-seed: ## Verify the seeded data is referentially consistent
	$(COMPOSE) run --rm -e SEED_ARGS=--check seed

.PHONY: sync-files
sync-files: ## Write the object bytes every seeded file points at
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-files seed

.PHONY: sync-exports
sync-exports: ## Write the file every seeded export claims, and make its counts describe it
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-exports seed

.PHONY: sync-imports
sync-imports: ## Make every seeded import run describe a file that could exist
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-imports seed

.PHONY: sync-sessions
sync-sessions: ## Leave at most one current session per person, and only a live one
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-sessions seed

.PHONY: sync-favorites
sync-favorites: ## Move the old per-row is_favorite flags into the one favourites store
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-favorites seed

.PHONY: sync-tags
sync-tags: ## Make each record's tags array agree with its tag links
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-tags seed

.PHONY: sync-searches
sync-searches: ## Drop filter keys no dataset declares, and add the missing list views
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-searches seed

.PHONY: sync-schema
sync-schema: ## Add columns the model declares and the database lacks
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-schema seed

.PHONY: sync-roles
sync-roles: ## Give the built-in roles any newly declared permissions
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-roles seed

.PHONY: sync-reports
sync-reports: ## Make saved reports the analysis compiler would reject runnable
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-reports seed

.PHONY: sync-automations
sync-automations: ## Make automations the engine cannot run runnable, and pause the obsolete
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-automations seed

.PHONY: sync-mailboxes
sync-mailboxes: ## Give each demo persona an inbox worth opening
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-mailboxes seed

.PHONY: sync-org
sync-org: ## Recount each department's headcount from the people in it
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-org seed

.PHONY: sync-health
sync-health: ## Give every monitored service a month of history to draw
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-health seed

.PHONY: sync-jobs
sync-jobs: ## Give every background-job status at least one job
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-jobs seed

.PHONY: sync-settings
sync-settings: ## Add newly declared system settings, and refit any that no longer fit
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-settings seed

.PHONY: psql
psql: ## Open a psql shell on the stack's database
	$(COMPOSE) exec postgres psql -U platform -d platform

# ── Tests ────────────────────────────────────────────────────────────────

.PHONY: test
test: test-backend test-frontend ## Run every test suite

.PHONY: test-backend
test-backend: ## Backend tests (no database needed)
	cd $(BACKEND) && ../$(PY) -m pytest

# The storage tests upload the way a browser does — straight at MinIO, past
# the API — so they need the same endpoint the browser uses. Without these the
# suite falls back to the local directory and the presigned-upload tests skip
# themselves rather than failing.
STORAGE_ENV := \
	STORAGE_ENDPOINT=http://localhost:$${MINIO_PORT:-9000} \
	STORAGE_PUBLIC_ENDPOINT=http://localhost:$${MINIO_PORT:-9000} \
	STORAGE_ACCESS_KEY=$${MINIO_ROOT_USER:-nucleus} \
	STORAGE_SECRET_KEY=$${MINIO_ROOT_PASSWORD:-nucleus-dev-secret}

# The cache tests assert *invalidation*, which cannot be asserted against a
# cache that is switched off — and it is off by default so the suite runs on a
# laptop with nothing installed. `TEST_REDIS_URL` turns it on, the same shape
# as `TEST_DATABASE_URL`.
CACHE_ENV := TEST_REDIS_URL=redis://localhost:$${REDIS_PORT:-6380}/0

.PHONY: test-backend-db
test-backend-db: ## Backend tests including the ones that need PostgreSQL, MinIO and Redis
	cd $(BACKEND) && TEST_DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform $(STORAGE_ENV) $(CACHE_ENV) ../$(PY) -m pytest

.PHONY: test-frontend
test-frontend: ## Frontend unit and component tests
	cd $(FRONTEND) && npm run test

# The suite *spends* fixtures, so it provisions them first. A retry consumes an
# attempt irreversibly — `attempt` is a record of what happened and nothing
# rewrites it — so one full sweep leaves the queue with one fewer retryable job
# per status, and after two or three the jobs spec fails on its own guard,
# which says to run exactly this. Provisioning is additive and idempotent, so
# doing it every time costs nothing on a queue that is already stocked.
.PHONY: e2e
e2e: sync-jobs ## Playwright end-to-end suite against the running stack
	cd $(FRONTEND) && npm run test:e2e

.PHONY: e2e-only
e2e-only: ## The suite without topping up the fixtures it spends
	cd $(FRONTEND) && npm run test:e2e

.PHONY: lint
lint: ## Typecheck, lint and *build* the frontend, and check the endpoint map and docs
	cd $(FRONTEND) && npm run typecheck
	cd $(FRONTEND) && npm run lint
	# The production build, because it is the only step that catches a
	# *bundling* mistake. `/showcase/components` globbed `src/components/*.tsx`
	# to derive its inventory, which made Vite pull `ExportButton.test.tsx` —
	# and MSW with it — into the production module graph. Typecheck and lint
	# were both perfectly happy; the build was not. Finding that in
	# `docker compose build` rather than here cost a redeploy.
	cd $(FRONTEND) && npm run build
	cd $(BACKEND) && ../$(PY) -m src.api.endpoint_map
	$(PY) scripts/render-rbac-matrix.py --check
	# Also *validates*: a feature marked shipped that names a route the router
	# does not serve, or an endpoint the map does not mount, fails here. The
	# hand-typed catalogue had `/showcase/table` as §3's home for the life of
	# the project and no page of that name was ever built.
	$(PY) scripts/render-features.py --check
	# The guided tour, checked the same way: a stop that names a route the
	# router does not serve, or a §77 capability no stop covers, fails here.
	# `frontend/e2e/walkthrough.spec.ts` then walks all eighteen in a browser.
	$(PY) scripts/render-walkthrough.py --check

.PHONY: docs
docs: ## Regenerate the documents that are derived from the code
	$(PY) scripts/render-rbac-matrix.py
	$(PY) scripts/render-walkthrough.py
	$(PY) scripts/render-features.py

# ── Local development, outside Docker ────────────────────────────────────

.PHONY: dev-api
dev-api: ## Run the API on the host against the stack's database
	cd $(BACKEND) && DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform ../$(PY) main.py

.PHONY: dev-web
dev-web: ## Run the Vite dev server, proxying to a local API
	cd $(FRONTEND) && npm run dev
