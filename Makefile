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

.PHONY: psql
psql: ## Open a psql shell on the stack's database
	$(COMPOSE) exec postgres psql -U platform -d platform

# ── Tests ────────────────────────────────────────────────────────────────

.PHONY: test
test: test-backend test-frontend ## Run every test suite

.PHONY: test-backend
test-backend: ## Backend tests (no database needed)
	cd $(BACKEND) && ../$(PY) -m pytest

.PHONY: test-backend-db
test-backend-db: ## Backend tests including the ones that need PostgreSQL
	cd $(BACKEND) && TEST_DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform ../$(PY) -m pytest

.PHONY: test-frontend
test-frontend: ## Frontend unit and component tests
	cd $(FRONTEND) && npm run test

.PHONY: e2e
e2e: ## Playwright end-to-end suite against the running stack
	cd $(FRONTEND) && npm run test:e2e

.PHONY: lint
lint: ## Typecheck and lint the frontend, and check the endpoint map
	cd $(FRONTEND) && npm run typecheck
	cd $(FRONTEND) && npm run lint
	cd $(BACKEND) && ../$(PY) -m src.api.endpoint_map

# ── Local development, outside Docker ────────────────────────────────────

.PHONY: dev-api
dev-api: ## Run the API on the host against the stack's database
	cd $(BACKEND) && DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:$${POSTGRES_PORT:-5433}/platform ../$(PY) main.py

.PHONY: dev-web
dev-web: ## Run the Vite dev server, proxying to a local API
	cd $(FRONTEND) && npm run dev
