ROOT_DIR := $(shell pwd)
LLVM_PYTHON_PATH := /home/yuding/work/llvm-project/build/tools/mlir/python_packages/mlir_core
BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV_PYTHON := $(ROOT_DIR)/$(BACKEND_DIR)/.venv/bin/python3

.PHONY: test test-backend test-frontend lint build clean help

## ── Testing ──────────────────────────────────────────────

test: test-backend test-frontend ## Run all tests
	@echo "\n✅ All tests passed."

test-backend: ## Run backend pytest
	@echo "── Backend tests ──"
	cd $(BACKEND_DIR) && \
		PYTHONPATH=$(LLVM_PYTHON_PATH):$(shell pwd)/$(BACKEND_DIR) \
		$(VENV_PYTHON) -m pytest tests/ -v --tb=short

test-frontend: ## Run frontend vitest
	@echo "── Frontend tests ──"
	cd $(FRONTEND_DIR) && npx vitest run

## ── Lint / Type Check ────────────────────────────────────

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Type check backend with mypy (if installed)
	@echo "── Backend lint ──"
	cd $(BACKEND_DIR) && \
		PYTHONPATH=$(LLVM_PYTHON_PATH):$(shell pwd)/$(BACKEND_DIR) \
		$(VENV_PYTHON) -m py_compile app/main.py app/services/ir_manager.py app/routers/model.py

lint-frontend: ## TypeScript type check
	@echo "── Frontend lint ──"
	cd $(FRONTEND_DIR) && npx tsc --noEmit

## ── Build ────────────────────────────────────────────────

build: build-frontend ## Build all

build-frontend: ## Build frontend for production
	@echo "── Building frontend ──"
	cd $(FRONTEND_DIR) && npx vite build

## ── Dev Servers ──────────────────────────────────────────

dev-backend: ## Start backend dev server
	cd $(BACKEND_DIR) && \
		PYTHONPATH=$(LLVM_PYTHON_PATH):$(shell pwd)/$(BACKEND_DIR) \
		$(VENV_PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Start frontend dev server
	cd $(FRONTEND_DIR) && npm run dev

## ── Utilities ────────────────────────────────────────────

clean: ## Clean build artifacts
	rm -rf $(FRONTEND_DIR)/dist
	rm -rf $(BACKEND_DIR)/__pycache__ $(BACKEND_DIR)/app/__pycache__
	rm -rf $(BACKEND_DIR)/.pytest_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
