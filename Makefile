.PHONY: help dev run build build-prod build-darwin build-windows build-linux build-windows-amd64 build-macos-amd64 build-macos-arm64 build-linux-amd64 clean install test test-unit test-unit-go test-unit-frontend typecheck test-watch test-integration test-integration-go test-integration-frontend test-coverage test-coverage-go test-coverage-frontend setup setup-quick install-hooks install-frontend install-wails generate doctor fmt lint frontend-dist frontend-dist-placeholder appicon seed-testdb seed-testdb-stop .require-wails

# Ensure Go bin is in PATH
GOBIN ?= $(shell go env GOPATH 2>/dev/null)/bin
export PATH := $(GOBIN):$(PATH)

WAILS_VERSION ?= v2.11.0
WAILS ?= $(shell command -v wails 2>/dev/null || echo "$(GOBIN)/wails")
MAGICK ?= $(shell command -v magick 2>/dev/null || command -v convert 2>/dev/null)
UNAME_S := $(shell uname -s 2>/dev/null || echo "")
ifeq ($(OS),Windows_NT)
DETECTED_OS := Windows
else
DETECTED_OS := $(UNAME_S)
endif
BUILD_TAGS ?= $(shell if [ "$(UNAME_S)" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null && pkg-config --exists webkit2gtk-4.1 2>/dev/null; then echo "webkit2_41"; fi)
BUILD_TAG_FLAGS := $(if $(strip $(BUILD_TAGS)),-tags "$(BUILD_TAGS)",)
GIT_COMMIT ?= $(shell git rev-parse HEAD 2>/dev/null || echo "")
GIT_DIRTY ?= $(shell git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null && echo "false" || echo "true")
APP_VERSION ?= $(shell git describe --tags --exact-match 2>/dev/null | sed 's/^v//' || true)
VERSION_LDFLAGS := -X main.AppVersion=$(APP_VERSION) -X main.GitCommit=$(GIT_COMMIT) -X main.GitDirty=$(GIT_DIRTY)
BUILD_FLAGS := -trimpath $(BUILD_TAG_FLAGS) -ldflags "-s -w $(VERSION_LDFLAGS)"

# Default target
.DEFAULT_GOAL := help

# ===========================================
# Help
# ===========================================

help:
	@echo ""
	@echo "MongoPal - MongoDB GUI Explorer"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup:"
	@echo "  setup          Full setup (system deps, Go, Node, Wails, npm, hooks)"
	@echo "  setup-quick    Setup without system dependencies"
	@echo "  install        Install Go and npm dependencies"
	@echo "  install-wails  Install pinned Wails CLI ($(WAILS_VERSION))"
	@echo "  install-hooks  Install git pre-commit hooks"
	@echo "  install-frontend  Install frontend npm dependencies only"
	@echo ""
	@echo "Development:"
	@echo "  dev            Start development server with hot-reload"
	@echo "  run            Build and launch the application"
	@echo "  generate       Generate Wails bindings"
	@echo "  doctor         Run Wails doctor to verify setup"
	@echo ""
	@echo "Build:"
	@echo "  build          Build for current platform"
	@echo "  build-prod     Build optimized for production"
	@echo "  build-darwin   Build for macOS (amd64 and arm64)"
	@echo "  build-windows  Build for Windows (amd64)"
	@echo "  build-linux    Build for Linux (amd64)"
	@echo "  build-macos-amd64    Build release artifact for macOS amd64"
	@echo "  build-macos-arm64    Build release artifact for macOS arm64"
	@echo "  build-windows-amd64  Build release artifact for Windows amd64"
	@echo "  build-linux-amd64    Build release artifact for Linux amd64"
	@echo ""
	@echo "Testing:"
	@echo "  test                      Run all tests (unit + integration)"
	@echo "  test-unit                 Run all unit tests - used by commit hook"
	@echo "  test-unit-go              Run Go unit tests only"
	@echo "  test-unit-frontend        Run frontend unit tests only"
	@echo "  typecheck                 Run TypeScript type checking"
	@echo "  test-watch                Run frontend tests in watch mode"
	@echo "  test-integration          Run all integration tests (requires Docker)"
	@echo "  test-integration-go       Run Go integration tests only (requires Docker)"
	@echo "  test-integration-frontend Run frontend integration tests only"
	@echo "  test-coverage             Run all tests with coverage reports"
	@echo ""
	@echo "Utilities:"
	@echo "  fmt            Format Go and frontend code"
	@echo "  lint           Lint Go and frontend code"
	@echo "  clean          Remove build artifacts and node_modules"
	@echo "  seed-testdb    Start local MongoDB and seed with test data"
	@echo "  seed-testdb-stop  Stop and remove test MongoDB container"
	@echo ""

# ===========================================
# Setup
# ===========================================

# Full setup: system deps, Go, Node, Wails, frontend, hooks
setup:
	@./scripts/setup.sh

# Setup without system dependencies (if you already have GTK/WebKit)
setup-quick:
	@./scripts/setup.sh --skip-system-deps

# Install git hooks from tracked .githooks directory
install-hooks:
	@echo "Installing git hooks..."
	@cp .githooks/* .git/hooks/
	@chmod +x .git/hooks/*
	@echo "Git hooks installed successfully."

# Install frontend dependencies only
install-frontend:
	cd frontend && npm install

# Install all dependencies
install:
	cd frontend && npm install
	go mod download

install-wails:
	go install github.com/wailsapp/wails/v2/cmd/wails@$(WAILS_VERSION)

# ===========================================
# Development
# ===========================================

# Ensure frontend dist exists (Go embed requires it)
frontend-dist:
	@if [ ! -d "frontend/dist" ]; then \
		echo "Building frontend (first run)..."; \
		cd frontend && npm run build; \
	fi

frontend-dist-placeholder:
	@if [ ! -d "frontend/dist" ]; then \
		mkdir -p frontend/dist; \
		printf '<!doctype html><title>placeholder</title>\n' > frontend/dist/index.html; \
	fi

dev: generate frontend-dist
	$(WAILS) dev

# ===========================================
# Build
# ===========================================

# Generate app icon PNG from SVG source
appicon: build/appicon.png

build/appicon.png: build/appicon.svg
	@if [ -z "$(MAGICK)" ]; then \
		echo "ImageMagick not found. Install 'magick' or 'convert' to generate build/appicon.png."; \
		exit 1; \
	fi
	"$(MAGICK)" -background none $< -resize 1024x1024 $@

.require-wails:
	@if [ ! -x "$(WAILS)" ]; then \
		echo "Wails CLI not found. Install it with: make install-wails"; \
		exit 1; \
	fi

# Build for current platform
build: .require-wails appicon generate
	$(WAILS) build $(BUILD_TAG_FLAGS) -ldflags "$(VERSION_LDFLAGS)"

# Build and launch the current platform executable.
run: build
ifeq ($(DETECTED_OS),Windows)
	@if [ -x build/bin/MongoPal.exe ]; then \
		./build/bin/MongoPal.exe; \
	elif [ -x build/bin/mongopal.exe ]; then \
		./build/bin/mongopal.exe; \
	else \
		echo "Built executable not found in build/bin"; \
		exit 1; \
	fi
else ifeq ($(DETECTED_OS),Darwin)
	@if [ -d build/bin/MongoPal.app ]; then \
		open build/bin/MongoPal.app; \
	elif [ -d build/bin/mongopal.app ]; then \
		open build/bin/mongopal.app; \
	else \
		echo "Built app bundle not found in build/bin"; \
		exit 1; \
	fi
else
	@if [ -x build/bin/MongoPal ]; then \
		./build/bin/MongoPal; \
	elif [ -x build/bin/mongopal ]; then \
		./build/bin/mongopal; \
	else \
		echo "Built executable not found in build/bin"; \
		exit 1; \
	fi
endif

# Build for production (optimized)
build-prod: .require-wails appicon generate
	$(WAILS) build $(BUILD_FLAGS)

# Build for specific platforms
build-darwin: appicon generate build-macos-amd64 build-macos-arm64

build-windows: build-windows-amd64

build-linux: build-linux-amd64

build-windows-amd64: .require-wails appicon generate
	$(WAILS) build -platform windows/amd64 -o MongoPal-windows-amd64.exe $(BUILD_FLAGS)

build-macos-amd64: .require-wails appicon generate
	$(WAILS) build -platform darwin/amd64 -o MongoPal-macos-amd64 $(BUILD_FLAGS)
	@if [ -d build/bin/MongoPal.app ] && [ ! -d build/bin/MongoPal-macos-amd64.app ]; then mv build/bin/MongoPal.app build/bin/MongoPal-macos-amd64.app; fi
	@if [ -d build/bin/mongopal.app ] && [ ! -d build/bin/MongoPal-macos-amd64.app ]; then mv build/bin/mongopal.app build/bin/MongoPal-macos-amd64.app; fi
	@test -d build/bin/MongoPal-macos-amd64.app

build-macos-arm64: .require-wails appicon generate
	$(WAILS) build -platform darwin/arm64 -o MongoPal-macos-arm64 $(BUILD_FLAGS)
	@if [ -d build/bin/MongoPal.app ] && [ ! -d build/bin/MongoPal-macos-arm64.app ]; then mv build/bin/MongoPal.app build/bin/MongoPal-macos-arm64.app; fi
	@if [ -d build/bin/mongopal.app ] && [ ! -d build/bin/MongoPal-macos-arm64.app ]; then mv build/bin/mongopal.app build/bin/MongoPal-macos-arm64.app; fi
	@test -d build/bin/MongoPal-macos-arm64.app

build-linux-amd64: .require-wails appicon generate
	$(WAILS) build -platform linux/amd64 -o MongoPal-linux-amd64 $(BUILD_FLAGS)

# ===========================================
# Testing
# ===========================================

# Run all tests (unit + integration)
test: test-unit test-integration

# Run all unit tests (used by commit hook)
test-unit: test-unit-frontend test-unit-go

# Run Go unit tests
test-unit-go: frontend-dist
	go test -v ./...

# Run TypeScript type checking
typecheck: generate
	cd frontend && npm run typecheck

# Run frontend unit tests (includes type checking)
test-unit-frontend: generate typecheck
	cd frontend && npm test

# Run frontend tests in watch mode
test-watch:
	cd frontend && npm run test:watch

# Run all integration tests (requires Docker)
test-integration: test-integration-frontend test-integration-go

# Run Go integration tests (requires Docker)
test-integration-go:
	go test -v -tags=integration -timeout=5m ./...

# Run frontend integration tests
test-integration-frontend: generate
	cd frontend && npm run test:integration

# Run all tests with coverage
test-coverage: test-coverage-go test-coverage-frontend

# Run Go tests with coverage
test-coverage-go:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report generated: coverage.html"

# Run frontend tests with coverage
test-coverage-frontend: generate
	cd frontend && npm run test:coverage

# ===========================================
# Utilities
# ===========================================

# Clean build artifacts
clean:
	rm -rf build/bin
	rm -rf frontend/dist
	rm -rf frontend/node_modules

# Generate Wails bindings
generate: .require-wails frontend-dist-placeholder
	$(WAILS) generate module
	@if [ -d frontend/wailsjs/wailsjs ]; then \
		ln -sfn wailsjs/go frontend/wailsjs/go; \
		ln -sfn wailsjs/runtime frontend/wailsjs/runtime; \
	fi

# Check Wails doctor
doctor:
	$(WAILS) doctor

# Format code
fmt:
	gofmt -w .
	cd frontend && npm run format

# Lint
lint:
	go vet $(BUILD_TAG_FLAGS) ./...
	golangci-lint run || true
	cd frontend && npm run lint

# ===========================================
# Test Data
# ===========================================

# Start local MongoDB container and seed with test data
seed-testdb:
	@./scripts/seed-testdb.sh

# Re-seed existing container (drops and recreates data)
seed-testdb-reseed:
	@./scripts/seed-testdb.sh --seed

# Stop and remove test MongoDB container
seed-testdb-stop:
	@./scripts/seed-testdb.sh --stop
