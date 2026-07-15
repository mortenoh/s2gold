# s2gold — developer entry points.
# Asset pipeline is Python (uv); web app + tests are pnpm workspaces;
# server + desktop shell are Rust (cargo).

.DEFAULT_GOAL := help
.PHONY: help install doctor dev serve build test lint e2e e2e-install desktop desktop-app desktop-build clean

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

serve: ## Build the frontend and run the Rust server (app + assets + /api)
	pnpm -r build
	cargo run -p s2gold-server --release

build: ## Build all workspace packages
	pnpm -r build

test: ## Run pipeline (pytest), workspace (vitest) and server (cargo) tests
	uv run pytest -q
	pnpm -r test
	cargo test -p s2gold-server

lint: ## Lint Python (ruff + mypy), TypeScript (eslint) and Rust (fmt + clippy)
	uv run ruff check src tests
	uv run mypy src
	pnpm -r lint
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings

e2e: ## Run Playwright end-to-end tests
	pnpm --filter e2e run e2e

e2e-install: ## Install the Chromium browser Playwright needs
	pnpm --filter e2e run e2e:install

desktop: ## Run the Tauri desktop shell (dev)
	pnpm -r build
	cd crates/desktop && pnpm exec tauri dev

desktop-app: ## Build the final macOS .app bundle only (target/release/bundle/macos/)
	pnpm -r build
	cd crates/desktop && pnpm exec tauri build --bundles app

desktop-build: ## Build all desktop bundles (.app + .dmg)
	pnpm -r build
	cd crates/desktop && pnpm exec tauri build

clean: ## Remove build outputs and node_modules
	rm -rf node_modules packages/*/node_modules e2e/node_modules \
		packages/app/dist e2e/playwright-report e2e/test-results target
