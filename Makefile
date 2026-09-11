.DEFAULT_GOAL := help

.PHONY: help check format shell ticket lint-actions lint-docker secrets ci
help:
	@echo 'make check        Check formatting and Markdown in Docker'
	@echo 'make format       Format repository files in Docker'
	@echo 'make shell        Open the development tooling container'
	@echo 'make ci           Run all current CI checks in Docker'
	@echo 'make ticket TICKET=1  Show a numbered implementation ticket'

check:
	docker compose run --build --rm tools npm run check

format:
	docker compose run --build --rm tools npm run format

shell:
	docker compose run --build --rm tools sh

ticket:
	docker compose run --build --rm -e TICKET tools sh -c 'node scripts/tickets.mjs show "$$TICKET"'

export TICKET

lint-actions:
	docker run --rm -v "$(CURDIR):/repo:ro" -w /repo rhysd/actionlint:1.7.12

lint-docker:
	docker run --rm -i hadolint/hadolint:v2.15.1 < Dockerfile

secrets:
	docker run --rm -v "$(CURDIR):/repo:ro" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact

ci: check lint-actions lint-docker secrets
