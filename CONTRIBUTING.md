# Contributing to MongoPal

This document covers building, running, and testing MongoPal locally. For what the
project is and how it is shaped, start with the [README](README.md) and [docs/](docs/).

## Prerequisites

- Go 1.24 or later
- Node.js 18 or later
- Wails CLI (`make install-wails`, pinned to Wails v2.11.0)

Optional runtime tools (only needed for the features that use them):

- `mongosh` — required for mongosh script execution and SQL/native query preview
- `mongodump` / `mongorestore` — required for BSON export and import

## Development

```bash
make install     # install Go and frontend dependencies
make dev         # run with hot reload for both Go and React
make build       # production build → build/bin/
```

### Build for specific platforms

```bash
make build-darwin    # macOS amd64 and arm64 app bundles
make build-windows   # Windows
make build-linux     # Linux
```

### Regenerating Wails bindings

After changing Go types or `App` facade methods, run `make generate` to refresh the
frontend bindings. See [docs/architecture.md](docs/architecture.md) for how the facade
and bindings fit together.

## Testing

```bash
make test                       # all tests (unit + integration)

make test-unit                  # all unit tests (used by commit hook)
make test-unit-frontend         # Vitest + TypeScript typecheck
make test-unit-go               # Go unit tests
make typecheck                  # TypeScript type checking only
make test-watch                 # frontend watch mode

make test-integration           # all integration tests (requires Docker)
make test-integration-go        # Go integration (testcontainers)
make test-integration-frontend  # frontend integration

make test-coverage              # coverage reports
```

## Version metadata

MongoPal builds embed runtime version metadata exposed through Wails via
`GetVersionInfo`. Local builds use the exact git tag when the current commit is tagged,
otherwise they report the current commit as a development build. Dirty working trees are
marked as development builds.

## Releases

Pull requests run the reusable GitHub Actions build workflow automatically, and
maintainers can trigger it manually from the Actions tab. The workflow runs unit tests,
TypeScript typecheck, `go vet`, and the frontend build before platform packaging.

To publish a release:

```bash
git tag -a vX.Y.Z -m "MongoPal vX.Y.Z"
git push origin vX.Y.Z
```

Pushing a `v*` tag runs the release workflow, builds platform artifacts, generates
GitHub release notes, and publishes zipped binaries for Linux, Windows, and macOS
(amd64 and arm64). Release builds patch `wails.json` product metadata from the tag
version before packaging. macOS artifacts are currently unsigned and not notarized;
users may need to allow the app in macOS Privacy & Security or remove the quarantine
attribute manually.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+/` | Show keyboard shortcuts reference |
| `Cmd+S` | Save document |
| `Cmd+Enter` | Execute query |
| `Cmd+W` | Close current tab |
| `Cmd+Shift+[` | Previous tab |
| `Cmd+Shift+]` | Next tab |
| `Cmd+A` | Select all documents (in bulk mode) |
| `Delete` | Delete selected documents |
| `Escape` | Close panel / cancel edit |
| `↑↓←→` | Navigate sidebar tree |
| `Enter` | Expand/collapse or open item |
| `Home/End` | Jump to first/last item |
