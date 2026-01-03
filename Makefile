.PHONY: help test test-api start-vrm-factory stop-vrm-factory dev format lint

# Default target
help:
	@echo "3D Avatar Chatbot - Development Commands"
	@echo ""
	@echo "Available targets:"
	@echo "  make dev              - Start development server"
	@echo "  make test             - Run all tests"
	@echo "  make test-api         - Test VRM Factory API"
	@echo "  make start-vrm-factory - Start VRM Factory service"
	@echo "  make stop-vrm-factory  - Stop VRM Factory service"
	@echo "  make format           - Format code with Prettier"
	@echo "  make lint             - Lint code with ESLint"
	@echo "  make validate         - Run lint, format check, and tests"
	@echo ""

# Start development server
dev:
	@echo "Starting development server on http://localhost:8080"
	@echo "VR Mode: http://localhost:8080/index-vr.html"
	@echo "Desktop Mode: http://localhost:8080/index.html"
	npm start

# Run all tests
test:
	npm test

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
