<!-- solution-docs:begin decisions -->
# Key decisions

Lightweight ADRs for the non-obvious choices behind MongoPal. Each is inferred from the
code and its comments; where the record is thinner it is marked low-confidence.

## 1. Wails (Go + React) rather than Electron or a web app

**Context.** MongoPal needs cross-platform desktop distribution, a rich interactive UI
(tables, editors, drag-and-drop trees), direct use of the MongoDB driver, and system-level
access to the OS keyring.

**Decision.** Build on Wails v2 — a Go backend compiled to a single native binary with a
React/TypeScript frontend in the platform webview — instead of Electron (bundles a full
browser) or a hosted web app (no local keyring or subprocess access).

**Consequence.** Small, fast-starting native binaries and first-class Go concurrency for
background export/import, at the cost of being desktop-only and coupled to Wails' release
cadence. Webview quirks occasionally leak into the UI (e.g. drag-and-drop state updates
deferred to work around WebKit).

## 2. Dual credential storage: encrypted files keyed by the OS keyring

**Context.** Connections carry real secrets (MongoDB passwords, SSH keys, TLS certs,
proxy credentials) that must persist across restarts, survive disk theft, and still work
on machines where the keyring is unreliable.

**Decision.** Store each connection encrypted with AES-256-GCM on disk, with a
per-connection key held in the OS keyring. If the keyring is unavailable, fall back to an
ephemeral key so encryption still applies. Keep the older keyring-password format working
for backward compatibility.

**Consequence.** Disk compromise alone does not expose credentials, and connections are
isolated key-by-key — but the encrypted files are not portable if the keyring is lost, and
the fallback path adds complexity. See [Connection management](features/connection-management.md).

## 3. AI API key is keyring-only; prompts carry schema, never data

**Context.** The Anthropic API key is a long-lived secret, and document contents must
never leave the machine for privacy reasons — while schema (field names and types) is safe
to send and is what the model needs.

**Decision.** Store the API key in the OS keyring with an environment-variable override
for CI, and *intentionally no file fallback*. Build prompts from inferred schema only,
sanitizing field names, and never include document values.

**Consequence.** The key never touches disk and data never leaves the app, at the cost of
no offline fallback if the keyring fails. See [Query modes](features/query-modes.md).

## 4. Extended JSON everywhere for lossless round-trips

**Context.** BSON types (ObjectId, Date, Binary, Decimal128, …) have no direct JSON
equivalent, yet users fetch documents, edit them as JSON, and save them back.

**Decision.** Marshal and unmarshal all document data as MongoDB Extended JSON
(`bson.MarshalExtJSON` / `bson.UnmarshalExtJSON`), and display it that way in the UI.

**Consequence.** Every fetch → edit → save cycle preserves exact types with no silent data
loss, in exchange for more verbose JSON than the shell's `ObjectId(...)` shorthand.

## 5. Shell out to mongosh / mongodump / mongorestore

**Context.** MongoDB's official tools already handle every auth mechanism, server version,
and BSON-archive edge case; reimplementing them in Go would duplicate a large,
fast-moving surface.

**Decision.** Execute scripts via `mongosh` and do binary export/import via
`mongodump`/`mongorestore`, detecting availability at startup and passing connection URIs
through environment variables rather than argv. Pure-Go paths (via the driver) remain for
everyday queries, JSON, and CSV.

**Consequence.** New MongoDB auth mechanisms and archive features work for free and
credentials stay out of process listings — but these features require the external tools
to be installed, and MongoPal must sanitize tool stderr to avoid leaking credentials into
error messages. See [Export & import](features/export-import.md).

## 6. SQL→MongoDB conversion runs client-side in TypeScript

**Context.** A live "type SQL, see the MongoDB query" preview needs to update on every
keystroke, and a round-trip to the backend per keystroke would feel sluggish. Off-the-shelf
SQL converters carry licensing and size baggage.

**Decision.** Implement a small, purpose-built pipeline (tokenizer → parser → transformer →
serializer) in the frontend, driven by the schema already sampled for autocomplete so bare
literals coerce to the right BSON types. Keep the grammar closed (SELECT-family only; no
JOIN, subqueries, or CTEs).

**Consequence.** Instant, network-free preview and inline parse errors, at the cost of a
fixed grammar that must be extended by editing the parser rather than configuration. See
[Query modes](features/query-modes.md).

## 7. Thin facade delegating to per-capability services

**Context.** Wails bindings are the public API surface, but business logic should be
testable without a running desktop shell, and each capability (connection, document,
export, …) has distinct concerns.

**Decision.** Keep `app.go` a thin facade: type re-exports for binding generation plus
one short delegating method per capability, with all logic living in `internal/` services
that operate on `AppState`.

**Consequence.** Services are unit-testable and adding a feature is mechanical (implement
in a service, add a delegate, regenerate bindings), at the price of one layer of
indirection and the discipline to keep logic out of the facade.

## 8. Frontend migrated from JavaScript to strict TypeScript

**Context.** The frontend calls dozens of Wails-generated functions with varying
signatures; wrong argument counts and shapes surfaced only at runtime.

**Decision.** Migrate the frontend to strict-mode TypeScript with centralized Wails type
declarations, planned out in `TYPESCRIPT_MIGRATION_PLAN.md`.

**Consequence.** Binding mismatches are caught at compile time via `make typecheck`, at the
cost of maintaining the type declarations in step with the Go API.

_Generated by solution-docs against commit `1cc8ae0` on 2026-07-03._
<!-- solution-docs:end decisions -->
