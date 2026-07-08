# s2gold — developer entry points.
# Asset pipeline is Python (uv); web app + tests are pnpm workspaces.

.DEFAULT_GOAL := help
.PHONY: help install doctor dev build test lint e2e e2e-install clean

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Convert game assets from a GOG installer: make install INSTALLER=path/to/gog.exe
ifndef INSTALLER
	$(error INSTALLER is not set. Usage: make install INSTALLER=path/to/gog.exe)
endif
	uv run s2gold install "$(INSTALLER)"

doctor: ## Check external tool dependencies for the asset pipeline
	uv run s2gold doctor

dev: ## Start the Vite dev server for the web app
	pnpm --filter app dev

build: ## Build all workspace packages
	pnpm -r build

test: ## Run pipeline (pytest) and workspace (vitest) unit tests
	uv run pytest -q
	pnpm -r test

lint: ## Lint Python (ruff + mypy) and TypeScript (eslint)
	uv run ruff check src tests
	uv run mypy src
	pnpm -r lint

e2e: ## Run Playwright end-to-end tests
	pnpm --filter e2e run e2e

e2e-install: ## Install the Chromium browser Playwright needs
	pnpm --filter e2e run e2e:install

clean: ## Remove build outputs and node_modules
	rm -rf node_modules packages/*/node_modules e2e/node_modules \
		packages/app/dist e2e/playwright-report e2e/test-results
