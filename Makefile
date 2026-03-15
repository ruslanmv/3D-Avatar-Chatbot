.PHONY: help install build start dev test test-api test-avatars start-vrm-factory stop-vrm-factory format lint validate clean

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
