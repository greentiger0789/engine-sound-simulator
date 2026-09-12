.DEFAULT_GOAL := help

.PHONY: help check format shell ticket lint-actions lint-docker secrets ci dev down build test e2e
help:
	@echo 'make check        Check application, formatting, and Markdown in Docker'
	@echo 'make format       Format repository files in Docker'
	@echo 'make shell        Open the development tooling container'
	@echo 'make dev          Start the Vite development server'
	@echo 'make down         Stop Compose services'
	@echo 'make build        Build production application and web images'
	@echo 'make test         Run unit tests in Docker'
	@echo 'make e2e          Run AudioWorklet browser tests in Docker'
	@echo 'make ci           Run all current CI checks in Docker'
	@echo 'make ticket TICKET=1  Show a numbered implementation ticket'

check:
	docker compose run --build --rm tools npm run check

format:
	docker compose run --build --rm tools npm run format

shell:
	docker compose run --build --rm tools sh

dev:
	docker compose up --build dev

down:
	docker compose down

build:
	docker compose build build web

test:
	docker compose run --build --rm tools npm run test

e2e:
	@e2e_project=ess-e2e-$$$$; status=0; \
		docker compose -p "$$e2e_project" up --build --abort-on-container-exit --exit-code-from e2e e2e || status=$$?; \
		docker compose -p "$$e2e_project" down --volumes; \
		exit $$status

ticket:
	docker compose run --build --rm -e TICKET tools sh -c 'node scripts/tickets.mjs show "$$TICKET"'

export TICKET

lint-actions:
	docker run --rm -v "$(CURDIR):/repo:ro" -w /repo rhysd/actionlint:1.7.12

lint-docker:
	docker run --rm -i hadolint/hadolint:v2.15.1 < Dockerfile

secrets:
	docker run --rm -v "$(CURDIR):/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact

ci: check test build e2e lint-actions lint-docker secrets
