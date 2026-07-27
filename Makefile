.PHONY: help install build start dev test test-api test-avatars e2e e2e-check start-vrm-factory stop-vrm-factory format lint validate clean

# Default target
help:
	@echo "3D Avatar Chatbot - Development & Production Commands"
	@echo ""
	@echo "Production:"
	@echo "  make install          - Install all dependencies"
	@echo "  make build            - Build: install deps, format, lint, validate"
	@echo "  make start            - Production start (same server, NODE_ENV=production)"
	@echo ""
	@echo "Development:"
	@echo "  make dev              - Start development server"
	@echo "  make test             - Run all tests (unit + avatar health)"
	@echo "  make test-avatars     - Validate avatar files, manifest, config"
	@echo "  make test-api         - Test VRM Factory API"
	@echo "  make e2e              - End-to-end hello-world across the whole stack"
	@echo "  make e2e-check        - E2E assertion against an already-running stack"
	@echo "  make format           - Format code with Prettier"
	@echo "  make lint             - Lint code with ESLint"
	@echo "  make validate         - Run lint, format check, and tests"
	@echo "  make clean            - Remove node_modules, coverage, dist"
	@echo ""
	@echo "Services:"
	@echo "  make start-vrm-factory - Start VRM Factory service"
	@echo "  make stop-vrm-factory  - Stop VRM Factory service"
	@echo ""

# Install dependencies
install:
	@echo "Installing dependencies..."
	npm install --legacy-peer-deps || npm install || true
	@echo "Dependencies installed."

# Build: install deps, format, lint check, validate avatars
build: install
	@echo "Building project..."
	npm run format
	npm run format:check
	@echo "Build complete. Ready for deployment."

# Production start
start: install
	@echo "Starting production server on http://localhost:8080"
	@echo "Avatar Manager: http://localhost:8080/vrm-manager.html"
	@echo "VR Mode:        http://localhost:8080/index-vr.html"
	@echo "Desktop Mode:   http://localhost:8080/index.html"
	NODE_ENV=production npm start

# Start development server
dev:
	@echo "Starting development server on http://localhost:8080"
	@echo "Avatar Manager: http://localhost:8080/vrm-manager.html"
	@echo "VR Mode:        http://localhost:8080/index-vr.html"
	@echo "Desktop Mode:   http://localhost:8080/index.html"
	npm start

# Run all tests (avatar health + unit tests)
test:
	@python3 check-avatars.py --test
	@echo ""
	npm test

# Validate avatar files, manifest, and config
test-avatars:
	@python3 check-avatars.py --test

# End-to-end "hello world" smoke test across the whole local stack:
#   Ollama -> HomePilot -> OllaBridge Local -> yourfriend.online
# Brings each service up (sibling repo checkouts), waits for health, asserts an
# avatar chat reply, then tears everything down. Non-destructive.
#   make e2e                      # start the stack + assert
#   make e2e SKIP_INSTALL=1       # faster re-run (skip `make install`)
#   make e2e KEEP_UP=1            # leave services running for debugging
e2e:
	@bash scripts/e2e-local.sh

# Assert against an ALREADY-running stack (no start/stop). Handy in CI or when
# you started the services yourself.
e2e-check:
	@python3 tests/e2e/hello_world_e2e.py

# Test VRM Factory API
test-api:
	@echo "Testing VRM Factory API..."
	@bash test-vrm-api.sh

# Start VRM Factory
start-vrm-factory:
	@echo "Starting VRM Factory..."
	@cd vrm-factory && docker-compose up -d
	@echo "VRM Factory API: http://localhost:8000"
	@echo "API Docs: http://localhost:8000/docs"

# Stop VRM Factory
stop-vrm-factory:
	@echo "Stopping VRM Factory..."
	@cd vrm-factory && docker-compose down

# Format code
format:
	npm run format

# Lint code
lint:
	npm run lint

# Validate everything
validate:
	npm run validate

# Clean project
clean:
	npm run clean
