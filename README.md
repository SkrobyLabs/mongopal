# MongoPal

A lightweight, cross-platform MongoDB GUI for exploring, viewing, and editing documents.

## Features

- Connect to MongoDB instances via connection URI
- Organize connections into nested folders with drag-and-drop
- Browse databases and collections in tree view
- View documents in Table or JSON format with pagination
- Smart column widths based on field names and types
- Edit documents with Monaco editor (syntax highlighting, formatting)
- Insert new documents with JSON validation
- Bulk operations with keyboard shortcuts (select, delete multiple)
- Collection schema analysis with field type distribution
- Export/import databases and collections with progress tracking and ETA
- Query filtering and sorting with mongosh script support
- Secure credential storage (OS keyring with encrypted fallback)
- Multi-tab interface with pinning, renaming, drag-reorder
- Full keyboard navigation throughout the app
- Notification history with actionable error hints
- Dark theme optimized for extended use (WCAG AA compliant)

## Technology Stack

- **Backend**: Go 1.24+
- **MongoDB Driver**: mongo-go-driver
- **Frontend**: React 18 + TypeScript 5.9+ (strict mode) + Vite
- **Styling**: TailwindCSS
- **Desktop Framework**: Wails v2

## Prerequisites

- Go 1.24 or later
- Node.js 18 or later
- Wails CLI (`make install-wails`, pinned to Wails v2.11.0)

## Development

### Install dependencies

```bash
make install
```

### Run in development mode

```bash
make dev
```

This starts the app with hot reload enabled for both Go and React.

### Build for production

```bash
make build
```

The binary will be created in `build/bin/`.

### Build for specific platforms

```bash
# macOS amd64 and arm64 app bundles
make build-darwin

# Windows
make build-windows

# Linux
make build-linux
```

### Version metadata

MongoPal builds include runtime version metadata exposed through Wails via `GetVersionInfo`. Local builds use the exact git tag when the current commit is tagged, otherwise they report the current commit as a development build. Dirty working trees are marked as development builds.

## Releases

Pull requests run the reusable GitHub Actions build workflow automatically, and maintainers can trigger it manually from the Actions tab. The workflow runs unit tests, TypeScript typecheck, `go vet`, and frontend build before platform packaging.

To publish a release:

```bash
git tag -a vX.Y.Z -m "MongoPal vX.Y.Z"
git push origin vX.Y.Z
```

Pushing a `v*` tag runs the release workflow, builds platform artifacts, generates GitHub release notes, and publishes a release with:

- `MongoPal-linux-amd64.zip`
- `MongoPal-windows-amd64.zip`
- `MongoPal-macos-amd64.zip`
- `MongoPal-macos-arm64.zip`

Release builds patch `wails.json` product metadata from the tag version before packaging. macOS artifacts are currently unsigned and not notarized; users may need to allow the app in macOS Privacy & Security or remove the quarantine attribute manually.

## Project Structure

```
mongopal/
├── main.go                 # Entry point, Wails app setup
├── app.go                  # Thin facade for Wails bindings
├── app_test.go             # Backend unit tests
├── integration_test.go     # Integration tests (requires Docker)
├── wails.json              # Wails configuration
├── Makefile                # Build automation
│
├── internal/               # Backend packages
│   ├── core/               # App state and event emitter
│   ├── types/              # Shared type definitions
│   ├── credential/         # Password/keyring management
│   ├── storage/            # Config file I/O, connections
│   ├── connection/         # Connect, Disconnect, TestConnection, GetServerInfo
│   ├── database/           # List databases/collections, drop ops
│   ├── document/           # Document CRUD operations
│   ├── schema/             # Schema inference and export
│   ├── export/             # Database/collection export
│   ├── importer/           # Database/collection import
│   └── script/             # Mongosh script execution
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Root component with state management
│   │   ├── types/          # TypeScript type definitions
│   │   │   └── wails.d.ts  # Centralized Wails bindings
│   │   ├── components/     # React components (TypeScript)
│   │   │   ├── Sidebar.tsx           # Folder/connection tree with drag-drop
│   │   │   ├── CollectionView.tsx    # Document list with filters
│   │   │   ├── DocumentEditView.tsx  # Monaco editor
│   │   │   ├── SchemaView.tsx        # Collection schema analysis
│   │   │   ├── KeyboardShortcuts.tsx # Shortcuts reference modal
│   │   │   ├── ActionableError.tsx   # Error hints with recovery
│   │   │   ├── Import/ExportModals   # Data transfer
│   │   │   ├── contexts/             # React contexts for state
│   │   │   └── ...
│   │   ├── hooks/          # Custom React hooks (useProgressETA)
│   │   └── utils/          # Query parsing, schema utils, error parsing, autocomplete
│   └── ...
│
├── .claude/                # Claude Code configuration
│   ├── rules/              # Project context
│   └── skills/             # Custom skills (pr-summary)
│
└── build/
    └── bin/                # Built binaries
```

## Testing

### Run all tests (unit + integration)
```bash
make test
```

### Unit tests only (used by commit hook)
```bash
make test-unit              # All unit tests
make test-unit-frontend     # Frontend only (includes TypeScript typecheck)
make test-unit-go           # Go only
make typecheck              # TypeScript type checking
make test-watch             # Frontend watch mode
```

### Integration tests (requires Docker)
```bash
make test-integration              # All integration tests
make test-integration-go           # Go only (testcontainers)
make test-integration-frontend     # Frontend only
```

### Coverage reports
```bash
make test-coverage
```

## Keyboard Shortcuts

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

## Documentation

For detailed project context and architecture, see `.claude/rules/mongopal-context.md`.

> **Maintenance**: Update this file AND `.claude/rules/mongopal-context.md` when codebase structure changes.

## License

MIT
