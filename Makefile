# =============================================================================
# 3D Avatar Chatbot - Production Makefile
# Author: Ruslan Magana
# Website: https://ruslanmv.com
# License: Apache 2.0
# =============================================================================

.PHONY: help install install-dev check-node dev start serve serve-vercel vercel-check \
        build validate test test-watch test-ci coverage lint lint-check format format-check \
        security security-audit security-fix docs docs-serve deploy deploy-netlify \
        clean clean-cache clean-all reset info version audit all ci quick \
        update-deps check-updates list-scripts watch-lint watch-test

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Project variables
PROJECT_NAME := 3D Avatar Chatbot
VERSION := 2.0.0
NODE_VERSION := $(shell node --version 2>/dev/null || echo "not installed")
NPM_VERSION := $(shell npm --version 2>/dev/null || echo "not installed")

# Vercel variables (for local demo)
VERCEL_PORT ?= 3000
VERCEL_BIN := $(shell command -v vercel 2>/dev/null)
VERCEL_LOCAL := ./node_modules/.bin/vercel

# =============================================================================
# Help Target - Self-documenting Makefile
# =============================================================================

help: ## Show this help message
	@echo "$(BLUE)=============================================================================$(NC)"
	@echo "$(GREEN)  $(PROJECT_NAME) - Makefile Commands$(NC)"
	@echo "$(BLUE)=============================================================================$(NC)"
	@echo ""
	@echo "$(YELLOW)Available targets:$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(BLUE)=============================================================================$(NC)"
	@echo "$(YELLOW)System Information:$(NC)"
	@echo "  Node.js: $(NODE_VERSION)"
	@echo "  npm:     $(NPM_VERSION)"
	@echo "$(BLUE)=============================================================================$(NC)"

# =============================================================================
# Installation & Setup
# =============================================================================

install: check-node ## Install all dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dependencies installed successfully!$(NC)"

install-dev: check-node ## Install development dependencies
	@echo "$(BLUE)Installing development dependencies...$(NC)"
	npm install --save-dev
	@echo "$(GREEN)✓ Development dependencies installed!$(NC)"

check-node: ## Check if Node.js and npm are installed
	@command -v node >/dev/null 2>&1 || { echo "$(RED)Error: Node.js is not installed$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "$(RED)Error: npm is not installed$(NC)"; exit 1; }
	@echo "$(GREEN)✓ Node.js $(NODE_VERSION) and npm $(NPM_VERSION) detected$(NC)"

# =============================================================================
# Development
# =============================================================================

dev: ## Start development server with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	npm run dev

start: ## Start production server
	@echo "$(BLUE)Starting server...$(NC)"
	npm start

# Default local serve uses Vercel demo server (best parity for Nexus)
serve: serve-vercel ## Serve the application locally (Vercel demo)

vercel-check: check-node ## Check if Vercel CLI is available (global or local)
	@if [ -n "$(VERCEL_BIN)" ]; then \
		echo "$(GREEN)✓ Vercel CLI detected (global)$(NC)"; \
	elif [ -x "$(VERCEL_LOCAL)" ]; then \
		echo "$(GREEN)✓ Vercel CLI detected (local)$(NC)"; \
	else \
		echo "$(RED)Error: Vercel CLI is not installed$(NC)"; \
		echo "$(YELLOW)Fix: run one of these:$(NC)"; \
		echo "  $(YELLOW)npm install -g vercel$(NC)"; \
		echo "  $(YELLOW)npm install --save-dev vercel$(NC)"; \
		exit 1; \
	fi

serve-vercel: vercel-check ## Serve the application locally using Vercel demo server
	@echo "$(BLUE)Starting Vercel demo server...$(NC)"
	@echo "$(YELLOW)→ http://localhost:$(VERCEL_PORT)$(NC)"
	@if [ -n "$(VERCEL_BIN)" ]; then \
		vercel dev --port $(VERCEL_PORT); \
	elif [ -x "$(VERCEL_LOCAL)" ]; then \
		$(VERCEL_LOCAL) dev --port $(VERCEL_PORT); \
	else \
		npx vercel dev --port $(VERCEL_PORT); \
	fi

# =============================================================================
# Build & Validation
# =============================================================================

build: lint test ## Run full build pipeline (lint + test)
	@echo "$(GREEN)✓ Build completed successfully!$(NC)"

validate: ## Validate code quality (lint + format + test)
	@echo "$(BLUE)Running full validation...$(NC)"
	npm run validate
	@echo "$(GREEN)✓ Validation passed!$(NC)"

# =============================================================================
# Testing
# =============================================================================

test: ## Run all tests with coverage
	@echo "$(BLUE)Running tests...$(NC)"
	npm test

test-watch: ## Run tests in watch mode
	@echo "$(BLUE)Running tests in watch mode...$(NC)"
	npm run test:watch

test-ci: ## Run tests in CI mode
	@echo "$(BLUE)Running tests in CI mode...$(NC)"
	npm run test:ci

coverage: test ## Generate test coverage report
	@echo "$(GREEN)✓ Coverage report generated in ./coverage$(NC)"
	@command -v open >/dev/null 2>&1 && open coverage/lcov-report/index.html || \
		echo "$(YELLOW)Open coverage/lcov-report/index.html to view the report$(NC)"

# =============================================================================
# Code Quality
# =============================================================================

lint: ## Lint and fix JavaScript files
	@echo "$(BLUE)Linting code...$(NC)"
	npm run lint
	@echo "$(GREEN)✓ Linting completed!$(NC)"

lint-check: ## Check linting without fixing
	@echo "$(BLUE)Checking code style...$(NC)"
	npm run lint:check

format: ## Format all files with Prettier
	@echo "$(BLUE)Formatting code...$(NC)"
	npm run format
	@echo "$(GREEN)✓ Code formatted!$(NC)"

format-check: ## Check code formatting
	@echo "$(BLUE)Checking code formatting...$(NC)"
	npm run format:check

# =============================================================================
# Security
# =============================================================================

security: security-audit ## Run security checks

security-audit: ## Run npm security audit
	@echo "$(BLUE)Running security audit...$(NC)"
	npm run security:audit || echo "$(YELLOW)⚠ Security vulnerabilities found$(NC)"

security-fix: ## Fix security vulnerabilities
	@echo "$(BLUE)Fixing security vulnerabilities...$(NC)"
	npm run security:fix
	@echo "$(GREEN)✓ Security fixes applied!$(NC)"

# =============================================================================
# Documentation
# =============================================================================

docs: ## Generate JSDoc documentation
	@echo "$(BLUE)Generating documentation...$(NC)"
	npm run docs
	@echo "$(GREEN)✓ Documentation generated in ./docs$(NC)"

docs-serve: docs ## Generate and serve documentation
	@echo "$(BLUE)Serving documentation...$(NC)"
	@cd docs && python3 -m http.server 8081 || python -m http.server 8081

# =============================================================================
# Deployment
# =============================================================================

deploy: build ## Deploy to GitHub Pages
	@echo "$(BLUE)Deploying to GitHub Pages...$(NC)"
	npm run deploy
	@echo "$(GREEN)✓ Deployed successfully!$(NC)"

deploy-netlify: build ## Deploy to Netlify
	@echo "$(BLUE)Deploying to Netlify...$(NC)"
	npm run deploy:netlify
	@echo "$(GREEN)✓ Deployed to Netlify!$(NC)"

# =============================================================================
# Maintenance
# =============================================================================

clean: ## Remove generated files and dependencies
	@echo "$(BLUE)Cleaning project...$(NC)"
	npm run clean
	@echo "$(GREEN)✓ Project cleaned!$(NC)"

clean-cache: ## Clear npm cache
	@echo "$(BLUE)Clearing npm cache...$(NC)"
	npm cache clean --force
	@echo "$(GREEN)✓ Cache cleared!$(NC)"

clean-all: clean clean-cache ## Full cleanup (files + cache)
	@echo "$(GREEN)✓ Full cleanup completed!$(NC)"

reset: clean-all install ## Reset project (clean + reinstall)
	@echo "$(GREEN)✓ Project reset completed!$(NC)"

# =============================================================================
# Utilities
# =============================================================================

info: ## Display project information
	@echo "$(BLUE)=============================================================================$(NC)"
	@echo "$(GREEN)Project Information$(NC)"
	@echo "$(BLUE)=============================================================================$(NC)"
	@echo "$(YELLOW)Name:$(NC)         $(PROJECT_NAME)"
	@echo "$(YELLOW)Version:$(NC)      $(VERSION)"
	@echo "$(YELLOW)License:$(NC)      Apache 2.0"
	@echo "$(YELLOW)Author:$(NC)       Ruslan Magana"
	@echo "$(YELLOW)Website:$(NC)      https://ruslanmv.com"
	@echo "$(YELLOW)Node.js:$(NC)      $(NODE_VERSION)"
	@echo "$(YELLOW)npm:$(NC)          $(NPM_VERSION)"
	@echo "$(BLUE)=============================================================================$(NC)"

version: ## Show version information
	@echo "$(PROJECT_NAME) v$(VERSION)"

audit: ## Run all audits (security + code quality)
	@echo "$(BLUE)Running comprehensive audit...$(NC)"
	@make security-audit
	@make lint-check
	@make format-check
	@make test-ci
	@echo "$(GREEN)✓ Audit completed!$(NC)"

# =============================================================================
# Composite Targets
# =============================================================================

all: install build test docs ## Run complete build pipeline
	@echo "$(GREEN)✓ All tasks completed successfully!$(NC)"

ci: install validate ## Run CI pipeline
	@echo "$(GREEN)✓ CI pipeline completed!$(NC)"

quick: lint test ## Quick validation (lint + test)
	@echo "$(GREEN)✓ Quick validation completed!$(NC)"

# =============================================================================
# Advanced Targets
# =============================================================================

update-deps: ## Update all dependencies
	@echo "$(BLUE)Updating dependencies...$(NC)"
	npm update
	@echo "$(GREEN)✓ Dependencies updated!$(NC)"

check-updates: ## Check for available updates
	@echo "$(BLUE)Checking for updates...$(NC)"
	npm outdated || true

list-scripts: ## List all npm scripts
	@echo "$(BLUE)Available npm scripts:$(NC)"
	@npm run | grep -v "^$" | tail -n +2

# =============================================================================
# Development Helpers
# =============================================================================

watch-lint: ## Watch files and lint on change
	@echo "$(BLUE)Watching files for linting...$(NC)"
	@while true; do \
		inotifywait -q -r -e modify js/; \
		make lint; \
	done

watch-test: ## Run tests in watch mode
	@make test-watch
