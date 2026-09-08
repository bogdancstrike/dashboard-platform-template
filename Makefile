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

.PHONY: check-seed
check-seed: ## Verify the seeded data is referentially consistent
	$(COMPOSE) run --rm -e SEED_ARGS=--check seed

.PHONY: sync-files
sync-files: ## Write the object bytes every seeded file points at
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-files seed

.PHONY: sync-exports
sync-exports: ## Write the file every seeded export claims, and make its counts describe it
	$(COMPOSE) run --rm -e SEED_ARGS=--sync-exports seed

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

.PHONY: test-backend-db
test-backend-db: ## Backend tests including the ones that need PostgreSQL and MinIO
	cd $(BACKEND) && TEST_DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform $(STORAGE_ENV) ../$(PY) -m pytest

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
lint: ## Typecheck and lint the frontend, and check the endpoint map and docs
	cd $(FRONTEND) && npm run typecheck
	cd $(FRONTEND) && npm run lint
	cd $(BACKEND) && ../$(PY) -m src.api.endpoint_map
	$(PY) scripts/render-rbac-matrix.py --check

.PHONY: docs
docs: ## Regenerate the documents that are derived from the code
	$(PY) scripts/render-rbac-matrix.py

# ── Local development, outside Docker ────────────────────────────────────

.PHONY: dev-api
dev-api: ## Run the API on the host against the stack's database
	cd $(BACKEND) && DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform ../$(PY) main.py

.PHONY: dev-web
dev-web: ## Run the Vite dev server, proxying to a local API
	cd $(FRONTEND) && npm run dev
