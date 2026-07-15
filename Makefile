# s2gold — developer entry points.
# Asset pipeline is Python (uv); web app + tests are pnpm workspaces;
# server + desktop shell are Rust (cargo).

.DEFAULT_GOAL := help
.PHONY: help install doctor dev serve build test lint e2e e2e-install desktop desktop-app desktop-build desktop-zip clean

# Local-only secrets for desktop notarization (Apple ID, app-specific
# password, team id) live in a gitignored .env at the repo root — plain
# KEY=value lines, see .env.example. Absent .env is fine: the app is then
# signed (when a Developer ID is in the keychain) but not notarized.
ifneq (,$(wildcard .env))
include .env
export APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_SIGNING_IDENTITY
endif

# Sign with a Developer ID when one is available: honour a pre-set
# APPLE_SIGNING_IDENTITY, else sniff the login keychain; with no cert fall
# back to an ad-hoc (unsigned) build. $(1) = extra tauri build args.
define tauri_build_signed
	cd crates/desktop && \
	  SIGN_ID="$${APPLE_SIGNING_IDENTITY:-$$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"; \
	  if [ -n "$$SIGN_ID" ]; then \
	    echo ">>> Signing as: $$SIGN_ID"; \
	    APPLE_SIGNING_IDENTITY="$$SIGN_ID" pnpm exec tauri build $(1); \
	  else \
	    echo ">>> No Developer ID in keychain — ad-hoc (unsigned) build"; \
	    pnpm exec tauri build $(1); \
	  fi
endef

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

desktop-app: ## Build the final signed macOS .app bundle only (target/release/bundle/macos/)
	pnpm -r build
	$(call tauri_build_signed,--bundles app)

# Zip the built .app with ditto (a plain zip would break the signature).
define zip_app
	@mkdir -p target/release/bundle/zip
	@VERSION=$$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' crates/desktop/tauri.conf.json | head -1); \
	ARCH=$$(uname -m | sed 's/arm64/aarch64/'); \
	OUT="target/release/bundle/zip/s2gold_$${VERSION}_$${ARCH}.app.zip"; \
	rm -f "$$OUT"; \
	ditto -c -k --keepParent target/release/bundle/macos/s2gold.app "$$OUT"; \
	echo ">>> $$OUT"
endef

desktop-build: ## Build all desktop bundles, signed (.app + .dmg + .zip)
	pnpm -r build
	$(call tauri_build_signed,)
	$(call zip_app)

desktop-zip: desktop-app ## Build the signed .app and zip it for distribution
	$(call zip_app)

clean: ## Remove build outputs and node_modules
	rm -rf node_modules packages/*/node_modules e2e/node_modules \
		packages/app/dist e2e/playwright-report e2e/test-results target
