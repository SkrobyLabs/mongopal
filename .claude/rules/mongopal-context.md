# MongoPal Project Context

Lightweight, cross-platform MongoDB GUI for exploring, viewing, and editing documents. Go+React via Wails framework.

> **IMPORTANT**: When modifying project structure, adding packages, or changing documentation, update BOTH this file AND `README.md` to keep them in sync.

## Tech Stack
- **Desktop**: Wails v2
- **Backend**: Go 1.24+, mongo-go-driver v1.17
- **Frontend**: React 18, TypeScript 5.9+, Vite, TailwindCSS
- **Credentials**: OS Keyring (go-keyring) with encrypted file fallback
- **Testing**: Vitest (frontend), Go testing + testcontainers (backend)

## Quick File Reference

### Backend Core
| Purpose | File |
|---------|------|
| Thin facade for Wails bindings | `app.go` |
| App entry point | `main.go` |
| Wails config | `wails.json` |
| Unit tests | `app_test.go` |
| Integration tests (requires Docker) | `integration_test.go` |

### Internal Packages
| Package | Purpose | Key Files |
|---------|---------|-----------|
| `internal/types` | All shared type definitions | `types.go` |
| `internal/core` | App state and event emitter | `state.go`, `events.go` |
| `internal/credential` | Password/keyring management, encrypted storage | `keyring.go`, `uri.go`, `encrypted_storage.go` |
| `internal/storage` | Config file I/O, connections, folders, favorites | `persistence.go`, `connections.go`, `folders.go`, `favorites.go` |
| `internal/connection` | Connect, Disconnect, TestConnection | `service.go` |
| `internal/database` | List databases/collections, drop operations | `listing.go`, `operations.go` |
| `internal/document` | Document CRUD operations | `crud.go`, `parser.go` |
| `internal/schema` | Schema inference and export | `inference.go`, `export.go` |
| `internal/export` | Database/collection export (CSV, JSON, BSON) | `database.go`, `collection.go`, `documents.go`, `json.go`, `bson.go` |
| `internal/importer` | Database/collection import (ZIP, JSON, CSV) | `database.go`, `collection.go`, `helpers.go`, `json.go`, `csv.go`, `detect.go` |
| `internal/script` | Mongosh script execution | `mongosh.go` |
| `internal/performance` | Go runtime and connection metrics | `metrics.go` |
| `internal/ai` | AI query assistant: Anthropic provider, keyring-only API key, schema-aware prompt builder (F077) | `provider.go`, `anthropic.go`, `apikey.go`, `prompt.go`, `parse.go`, `service.go` |

### Frontend Core
| Purpose | File |
|---------|------|
| App entry/state | `frontend/src/App.tsx` |
| Global styles | `frontend/src/index.css` |
| Tailwind config | `frontend/tailwind.config.js` |
| Centralized Wails type definitions | `frontend/src/types/wails.d.ts` |

### Components
| Purpose | File |
|---------|------|
| Left sidebar tree (folders, connections) | `frontend/src/components/Sidebar.tsx` |
| Tab bar with drag-reorder | `frontend/src/components/TabBar.tsx` |
| Collection data view with filters | `frontend/src/components/CollectionView.tsx` |
| Document table display | `frontend/src/components/TableView.tsx` |
| Document editor (Monaco) | `frontend/src/components/DocumentEditView.tsx` |
| Collection schema analysis | `frontend/src/components/SchemaView.tsx` |
| Bulk action bar | `frontend/src/components/BulkActionBar.tsx` |
| Connection form modal (legacy) | `frontend/src/components/ConnectionForm.tsx` |
| Advanced connection form (F074) | `frontend/src/components/connection-form/ConnectionFormV2.tsx` |
| Application settings | `frontend/src/components/Settings.tsx` |
| Toast notifications + history | `frontend/src/components/NotificationContext.tsx` |
| Confirmation dialogs | `frontend/src/components/ConfirmDialog.tsx` |
| Error boundary wrapper | `frontend/src/components/ErrorBoundary.tsx` |
| Unified export modal (databases & collections) | `frontend/src/components/UnifiedExportModal.tsx` |
| Unified import modal (databases & collections) | `frontend/src/components/UnifiedImportModal.tsx` |
| Collection export dropdown (CSV/JSON/BSON) | `frontend/src/components/CollectionExportButton.tsx` |
| JSON export dialog | `frontend/src/components/JSONExportDialog.tsx` |
| BSON export dialog (mongodump) | `frontend/src/components/BSONExportDialog.tsx` |
| Unified import dialog (JSON, CSV, BSON) | `frontend/src/components/ImportDialog.tsx` |
| Keyboard shortcuts modal | `frontend/src/components/KeyboardShortcuts.tsx` |
| Actionable error display | `frontend/src/components/ActionableError.tsx` |
| Performance metrics panel | `frontend/src/components/PerformancePanel.tsx` |
| Server info diagnostics modal | `frontend/src/components/ServerInfoModal.tsx` |
| AI query assistant panel (F077) | `frontend/src/components/AIQueryPanel.tsx` |

### Contexts
| Purpose | File |
|---------|------|
| Connection state management | `frontend/src/components/contexts/ConnectionContext.tsx` |
| Tab state management | `frontend/src/components/contexts/TabContext.tsx` |
| Status bar state | `frontend/src/components/contexts/StatusContext.tsx` |
| Operation tracking (busy indicator) | `frontend/src/components/contexts/OperationContext.tsx` |
| Debug logging (toggle via Settings) | `frontend/src/components/contexts/DebugContext.tsx` |
| Export/import queue tracking | `frontend/src/components/contexts/ExportQueueContext.tsx` |

### Hooks
| Purpose | File |
|---------|------|
| ETA time remaining calculation | `frontend/src/hooks/useProgressETA.ts` |

### Utilities
| Purpose | File |
|---------|------|
| MongoDB query parsing | `frontend/src/utils/queryParser.ts` |
| Mongosh script parsing | `frontend/src/utils/mongoshParser.ts` |
| Schema analysis helpers | `frontend/src/utils/schemaUtils.ts` |
| Table formatting utils | `frontend/src/utils/tableViewUtils.ts` |
| Error parsing for actionable hints | `frontend/src/utils/errorParser.ts` |
| Query editor autocomplete provider | `frontend/src/utils/queryCompletionProvider.ts` |
| Shared schema field-type lookup (used by both completion providers + SQL transformer) | `frontend/src/utils/schemaFieldLookup.ts` |
| SQL→MongoDB query converter (F076) | `frontend/src/utils/sqlConverter/` (tokenizer, parser, transformer, serializer, index, sqlCompletionProvider) |

## Key Patterns

### Document IDs
MongoDB documents can have various ID types. Handle them consistently:
- **ObjectId**: `{ "$oid": "507f1f77bcf86cd799439011" }`
- **Binary/UUID**: `{ "$binary": { "base64": "...", "subType": "03" } }`
- **UUID**: `{ "$uuid": "..." }`
- **String**: Plain string

Frontend passes Extended JSON for complex types; backend's `parseDocumentID()` handles conversion.

### Connection Credentials (F074)
- **New**: Full connections stored encrypted in `~/.config/mongopal/connections/*.encrypted`
- **Encryption**: AES-256-GCM with keys stored in OS keyring (per-connection)
- **ExtendedConnection** type stores MongoDB password, SSH credentials, TLS certs, proxy settings
- **Legacy**: Old format (keyring password + JSON URI) still supported for backward compatibility
- Password injected into URI at connection time

### BSON Extended JSON
All document data uses MongoDB Extended JSON format for round-trip fidelity:
- Dates: `{ "$date": "2023-01-01T00:00:00Z" }`
- Numbers: `{ "$numberLong": "123" }`, `{ "$numberInt": "42" }`
- Use `bson.MarshalExtJSON` / `bson.UnmarshalExtJSON` in Go

### Export/Import Operations
Both database-level and collection-level operations:
- **Export**: Creates JSON file with manifest metadata
- **Import**: Supports conflict resolution (skip/overwrite/reject), dry-run preview
- **Progress tracking**: Real-time events via Wails runtime for UI updates
- **Cancellation**: Long-running operations can be interrupted

### Schema Analysis
- Samples documents from collection (configurable count)
- Analyzes field distribution and types
- Identifies nested structures with frequency stats
- Exports schema as JSON

### Folder Organization
- Connections can be organized into nested folders
- Drag-and-drop to move connections/folders between folders
- Folder hierarchy stored in `~/.config/mongopal/folders.json`
- WebKit drag fix: State updates deferred via `setTimeout(0)` to prevent drag cancellation

### Keyboard Navigation
- Full keyboard navigation for sidebar tree (arrow keys, Home/End)
- Tab management (Cmd+W close, Cmd+Shift+[ ] switch tabs)
- Bulk action shortcuts (Cmd+A select all, Delete for selected)
- Query history dropdown (arrow keys, Enter to select)
- Escape closes modals and panels

### Notifications
- Toast stack limited to 4 visible with grouping
- Auto-dismiss pauses on hover
- Notification history drawer (persisted)
- Actionable error hints with recovery suggestions

## Build Commands
```bash
make dev              # Development with hot-reload
make build            # Build for current platform
make build-prod       # Production optimized build
make build-darwin     # macOS universal binary
make build-linux      # Linux amd64
make build-windows    # Windows amd64
make test                      # All tests (unit + integration)
make test-unit                 # All unit tests (commit hook)
make test-unit-go              # Go unit tests only
make test-unit-frontend        # Frontend unit tests only (includes typecheck)
make typecheck                 # TypeScript type checking
make test-watch                # Frontend watch mode
make test-integration          # All integration tests (Docker)
make test-integration-go       # Go integration only
make test-integration-frontend # Frontend integration only
make test-coverage             # All tests with coverage
make generate         # Regenerate Wails bindings
make fmt              # Format code
make lint             # Lint code
```

## Adding Features

### New Backend Method
1. Implement logic in the appropriate `internal/` package
2. Add a delegation method to `App` struct in `app.go`
3. Run `make generate` to update bindings
4. Call via `window.go.main.App.MethodName()` in frontend

### New Type
1. Add type definition to `internal/types/types.go`
2. Add type re-export in `app.go` for Wails binding generation

### New Component
1. Create in `frontend/src/components/`
2. Import and use in parent component
3. Follow existing patterns for state management (useState/useEffect)

## Code Style
- **Go**: Standard gofmt, error wrapping with `fmt.Errorf`
- **TypeScript**: Strict mode enabled, centralized Wails types in `src/types/wails.d.ts`
- **React**: Functional components with hooks, no class components
- **CSS**: TailwindCSS utilities, custom classes in `index.css`
- **Colors**: Dark theme with zinc palette, accent `#4CC38A`

## Testing

### Unit Tests
Run with `make test-unit` (used by pre-commit hook):
- **Frontend** (`make test-unit-frontend`): Vitest with jsdom, 560+ tests
- **Go** (`make test-unit-go`): URI parsing, validation, document IDs
- Test files located alongside source: `*.test.js`, `*_test.go`
- Watch mode: `make test-watch`

### Integration Tests
Run with `make test-integration` (requires Docker):
- **Go** (`make test-integration-go`): Full MongoDB via testcontainers
- **Frontend** (`make test-integration-frontend`): E2E-lite tests
- 5-minute timeout for longer operations
- Covers connection, CRUD, export/import flows

### All Tests
Run with `make test` for unit + integration tests.

### Coverage
Run with `make test-coverage` for coverage reports.

## Backend Architecture

The backend uses a thin facade pattern:
- `app.go` contains the `App` struct which is the Wails binding surface
- All methods delegate to specialized services in `internal/` packages
- State is managed centrally via `internal/core/AppState`

### Method Categories (in App facade)
| Category | Methods | Internal Package |
|----------|---------|------------------|
| Connection | Connect, Disconnect, TestConnection, GetServerInfo | `internal/connection` |
| Storage | SaveConnection, SaveExtendedConnection, GetExtendedConnection, ListSavedConnections, CreateFolder, etc. | `internal/storage` |
| Database | ListDatabases, ListCollections, DropDatabase, DropCollection | `internal/database` |
| Document | FindDocuments, AggregateDocuments, GetDocument, InsertDocument, UpdateDocument, DeleteDocument | `internal/document` |
| Schema | InferCollectionSchema, ExportSchemaAsJSON | `internal/schema` |
| Export | ExportDatabases, ExportSelectiveDatabases, ExportCollections, ExportDocumentsAsZip, ExportCollectionAsJSON, GetJSONSavePath, CheckToolAvailability, ExportWithMongodump | `internal/export` |
| Import | ImportDatabases, ImportSelectiveDatabases, DryRunSelectiveImport, ImportCollections, PreviewImportFile, ImportJSON, DryRunImportJSON, PreviewJSONFile, DetectFileFormat, GetImportFilePath, PreviewCSVFile, ImportCSV, DryRunImportCSV, ImportWithMongorestore | `internal/importer`, `internal/export` |
| Script | ExecuteScript, CheckMongoshAvailable | `internal/script` |
| Performance | GetPerformanceMetrics, ForceGC | `internal/performance` |
| AI | GenerateAIQuery, SetAIAPIKey, GetAIAPIKeyStatus, ClearAIAPIKey | `internal/ai` |

> **Maintenance**: Update this file AND `README.md` when codebase structure changes.

---

## Required: Update Docs After Structural Changes

After adding/removing/renaming files in these locations, you **MUST** update the documentation:

| Changed Location | Update These Files |
|------------------|-------------------|
| `internal/*/` | This file + `README.md` |
| `frontend/src/components/` | This file + `README.md` |
| `frontend/src/components/contexts/` | This file + `README.md` |
| `frontend/src/hooks/` | This file + `README.md` |
| `frontend/src/utils/` | This file + `README.md` |
| Root `*.go` files | This file + `README.md` |

This is **not optional**. Do it in the same session as the structural change.
