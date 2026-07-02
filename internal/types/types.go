// Package types contains shared type definitions used across the mongopal application.
package types

import "time"

// =============================================================================
// Folder and Connection Types
// =============================================================================

// Folder represents a folder for organizing connections.
type Folder struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId,omitempty"`
}

// SavedConnection represents a saved MongoDB connection.
type SavedConnection struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	FolderID       string    `json:"folderId,omitempty"`
	URI            string    `json:"uri"`
	Color          string    `json:"color"`
	ReadOnly       bool      `json:"readOnly"`
	CreatedAt      time.Time `json:"createdAt"`
	LastAccessedAt time.Time `json:"lastAccessedAt,omitempty"`
}

// ExtendedConnection contains all connection data including sensitive credentials.
// This is stored encrypted, unlike SavedConnection which was stored in plain JSON.
type ExtendedConnection struct {
	// Base fields (from SavedConnection)
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	FolderID       string    `json:"folderId,omitempty"`
	Color          string    `json:"color"`
	ReadOnly       bool      `json:"readOnly"`
	CreatedAt      time.Time `json:"createdAt"`
	LastAccessedAt time.Time `json:"lastAccessedAt,omitempty"`

	// MongoDB connection details
	MongoURI string `json:"mongoUri"`

	// SSH tunnel configuration (F074)
	SSHEnabled    bool   `json:"sshEnabled"`
	SSHHost       string `json:"sshHost,omitempty"`
	SSHPort       int    `json:"sshPort,omitempty"`
	SSHUser       string `json:"sshUser,omitempty"`
	SSHPassword   string `json:"sshPassword,omitempty"`   // Stored encrypted
	SSHPrivateKey string `json:"sshPrivateKey,omitempty"` // Stored encrypted (~3KB)
	SSHPassphrase string `json:"sshPassphrase,omitempty"` // Stored encrypted

	// TLS/SSL configuration (F074)
	TLSEnabled        bool   `json:"tlsEnabled"`
	TLSInsecure       bool   `json:"tlsInsecure"` // Allow invalid certificates
	TLSCAFile         string `json:"tlsCAFile,omitempty"`   // CA certificate content (~2KB)
	TLSCertFile       string `json:"tlsCertFile,omitempty"` // Client certificate content
	TLSKeyFile        string `json:"tlsKeyFile,omitempty"`  // Client key content
	TLSKeyPassword    string `json:"tlsKeyPassword,omitempty"` // Client key password

	// SOCKS5 proxy configuration (F074)
	SOCKS5Enabled  bool   `json:"socks5Enabled"`
	SOCKS5Host     string `json:"socks5Host,omitempty"`
	SOCKS5Port     int    `json:"socks5Port,omitempty"`
	SOCKS5User     string `json:"socks5User,omitempty"`
	SOCKS5Password string `json:"socks5Password,omitempty"` // Stored encrypted

	// Safety settings (F074)
	DestructiveDelay          int  `json:"destructiveDelay"`          // Seconds to delay destructive operations
	RequireDeleteConfirmation bool `json:"requireDeleteConfirmation"` // Require typing "DELETE"

	// Form state (F074) - stores raw form field values for editing
	FormData string `json:"formData,omitempty"` // JSON blob of form fields

	// Export/import only — folder path segments for recreating folder structure
	FolderPath []string `json:"folderPath,omitempty"`
}

// ToSavedConnection converts ExtendedConnection to SavedConnection (for compatibility).
func (e *ExtendedConnection) ToSavedConnection() SavedConnection {
	return SavedConnection{
		ID:             e.ID,
		Name:           e.Name,
		FolderID:       e.FolderID,
		URI:            e.MongoURI,
		Color:          e.Color,
		ReadOnly:       e.ReadOnly,
		CreatedAt:      e.CreatedAt,
		LastAccessedAt: e.LastAccessedAt,
	}
}

// ConnectionShareBundle is the encrypted bundle format for sharing connections.
type ConnectionShareBundle struct {
	Version int    `json:"v"`
	App     string `json:"app"`
	Time    string `json:"ts"`
	Nonce   string `json:"nonce"`
	Data    string `json:"data"`
}

// ConnectionShareResult contains the export result: bundle JSON and the decryption key.
type ConnectionShareResult struct {
	Bundle string `json:"bundle"`
	Key    string `json:"key"`
}

// BulkShareEntry is a single connection in a bulk export.
type BulkShareEntry struct {
	Name   string `json:"name"`
	Bundle string `json:"bundle"`
}

// BulkConnectionShareResult contains multiple encrypted connections sharing one key.
type BulkConnectionShareResult struct {
	Version     int              `json:"version"`
	Connections []BulkShareEntry `json:"connections"`
	Key         string           `json:"key"`
}

// ConnectionInfo provides detailed info about a connection.
type ConnectionInfo struct {
	ID            string `json:"id"`
	Type          string `json:"type"`       // "standalone", "replicaset", "sharded"
	ReplicaSet    string `json:"replicaSet"` // e.g., "rs0"
	Primary       string `json:"primary"`
	ServerVersion string `json:"serverVersion"`
}

// ConnectionStatus represents the status of a connection.
type ConnectionStatus struct {
	Connected bool   `json:"connected"`
	Error     string `json:"error,omitempty"`
}

// TestConnectionResult is the enhanced result from a test connection attempt.
type TestConnectionResult struct {
	Success       bool   `json:"success"`
	Error         string `json:"error,omitempty"`
	Hint          string `json:"hint,omitempty"`
	ServerVersion string `json:"serverVersion,omitempty"`
	Topology      string `json:"topology,omitempty"` // "standalone", "replicaset", "sharded"
	Latency       int64  `json:"latency"`            // milliseconds
	TLSEnabled    bool   `json:"tlsEnabled"`
	ReplicaSet    string `json:"replicaSet,omitempty"`
}

// =============================================================================
// Connection Form Data Types (for URI building from stored form state)
// =============================================================================

// HostPort represents a single host:port pair in a connection.
type HostPort struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// ConnectionFormData represents the form fields stored in ExtendedConnection.FormData.
// Used to rebuild the MongoDB URI at connect time without url.Parse roundtrips.
type ConnectionFormData struct {
	ConnectionType         string      `json:"connectionType"` // standalone|replicaset|sharded|srv
	Hosts                  []HostPort  `json:"hosts"`
	SRVHostname            string      `json:"srvHostname"`
	ReplicaSetName         string      `json:"replicaSetName"`
	DefaultDatabase        string      `json:"defaultDatabase"`
	AuthMechanism          string      `json:"authMechanism"` // none|scram-sha-1|scram-sha-256|x509|mongodb-aws|kerberos
	Username               string      `json:"username"`
	AuthDatabase           string      `json:"authDatabase"`
	TLSEnabled             bool        `json:"tlsEnabled"`
	TLSInsecure            bool        `json:"tlsInsecure"`
	MaxPoolSize            int         `json:"maxPoolSize"`
	RetryWrites            bool        `json:"retryWrites"`
	WriteConcernW          interface{} `json:"writeConcernW"`
	WriteConcernJ          bool        `json:"writeConcernJ"`
	WriteConcernWTimeout   int         `json:"writeConcernWTimeout"`
	ReadPreference         string      `json:"readPreference"`
	AppName                string      `json:"appName"`
	Compressors            []string    `json:"compressors"`
	ConnectTimeout         int         `json:"connectTimeout"`         // seconds
	SocketTimeout          int         `json:"socketTimeout"`          // seconds
	ServerSelectionTimeout int         `json:"serverSelectionTimeout"` // seconds
}

// =============================================================================
// Database and Collection Types
// =============================================================================

// DatabaseInfo describes a MongoDB database.
type DatabaseInfo struct {
	Name           string    `json:"name"`
	SizeOnDisk     int64     `json:"sizeOnDisk"`
	Empty          bool      `json:"empty"`
	LastAccessedAt time.Time `json:"lastAccessedAt,omitempty"`
}

// CollectionInfo describes a MongoDB collection.
type CollectionInfo struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Count int64  `json:"count"`
}

// IndexInfo describes a MongoDB index.
type IndexInfo struct {
	Name       string         `json:"name"`
	Keys       map[string]int `json:"keys"`
	Unique     bool           `json:"unique"`
	Sparse     bool           `json:"sparse"`
	TTL        int64          `json:"ttl,omitempty"`        // TTL in seconds, 0 if not a TTL index
	Size       int64          `json:"size"`                 // Index size in bytes
	UsageCount int64          `json:"usageCount,omitempty"` // Number of operations that used this index
}

// IndexOptions specifies options for creating an index.
type IndexOptions struct {
	Unique             bool   `json:"unique"`
	Sparse             bool   `json:"sparse"`
	Background         bool   `json:"background"`
	ExpireAfterSeconds int64  `json:"expireAfterSeconds,omitempty"` // TTL in seconds
	Name               string `json:"name,omitempty"`               // Custom index name
}

// CollectionExportInfo provides collection info for the export modal.
type CollectionExportInfo struct {
	Name       string `json:"name"`
	Count      int64  `json:"count"`
	SizeOnDisk int64  `json:"sizeOnDisk"`
}

// CollectionStats contains statistics about a MongoDB collection.
type CollectionStats struct {
	Namespace      string `json:"namespace"`      // Full namespace (db.collection)
	Count          int64  `json:"count"`          // Number of documents
	Size           int64  `json:"size"`           // Total uncompressed size of documents in bytes
	StorageSize    int64  `json:"storageSize"`    // Storage size on disk in bytes
	AvgObjSize     int64  `json:"avgObjSize"`     // Average document size in bytes
	IndexCount     int    `json:"indexCount"`     // Number of indexes
	TotalIndexSize int64  `json:"totalIndexSize"` // Total size of all indexes in bytes
	Capped         bool   `json:"capped"`         // Whether collection is capped
}

// CollectionProfile is a lightweight summary of collection characteristics,
// used for pre-query health checks and adaptive behavior.
type CollectionProfile struct {
	AvgDocSizeBytes int64    `json:"avgDocSizeBytes"` // Average document size from collStats
	DocCount        int64    `json:"docCount"`         // Total documents
	FieldCount      int      `json:"fieldCount"`       // Top-level field count from quick schema sample
	TotalFieldPaths int      `json:"totalFieldPaths"`  // Total field paths including nested
	MaxNestingDepth int      `json:"maxNestingDepth"`  // Deepest nesting level found
	TopFields       []string `json:"topFields"`        // Top-level field names from sample (for auto-projection)
}

// =============================================================================
// Query Types
// =============================================================================

// ExplainResult contains the results of an explain plan analysis.
type ExplainResult struct {
	QueryPlanner     QueryPlannerResult   `json:"queryPlanner"`
	ExecutionStats   ExecutionStatsResult `json:"executionStats"`
	WinningPlan      string               `json:"winningPlan"`      // Human-readable summary of winning plan
	IndexUsed        string               `json:"indexUsed"`        // Name of index used, empty if collection scan
	IsCollectionScan bool                 `json:"isCollectionScan"` // True if no index was used
	RawExplain       string               `json:"rawExplain"`       // Full explain output as JSON
}

// QueryPlannerResult contains query planner information.
type QueryPlannerResult struct {
	Namespace        string `json:"namespace"`
	IndexFilterSet   bool   `json:"indexFilterSet"`
	ParsedQuery      string `json:"parsedQuery"`      // Query as parsed by MongoDB
	RejectedPlans    int    `json:"rejectedPlans"`    // Number of rejected query plans
	WinningPlanStage string `json:"winningPlanStage"` // Top-level stage of winning plan
}

// ExecutionStatsResult contains execution statistics.
type ExecutionStatsResult struct {
	ExecutionSuccess  bool  `json:"executionSuccess"`
	NReturned         int64 `json:"nReturned"`         // Documents returned
	ExecutionTimeMs   int64 `json:"executionTimeMs"`   // Execution time in milliseconds
	TotalKeysExamined int64 `json:"totalKeysExamined"` // Index keys examined
	TotalDocsExamined int64 `json:"totalDocsExamined"` // Documents examined
}

// QueryOptions specifies parameters for document queries.
type QueryOptions struct {
	Skip       int64  `json:"skip"`
	Limit      int64  `json:"limit"`
	Sort       string `json:"sort"`
	Projection string `json:"projection"`
}

// QueryResult contains the result of a document query.
type QueryResult struct {
	Documents   []string `json:"documents"` // Extended JSON strings
	Total       int64    `json:"total"`
	HasMore     bool     `json:"hasMore"`
	QueryTimeMs int64    `json:"queryTimeMs"`
	Warnings    []string `json:"warnings,omitempty"` // Non-fatal errors during query
}

// =============================================================================
// Schema Types
// =============================================================================

// SchemaField represents a field in the inferred schema.
type SchemaField struct {
	Type       string                 `json:"type"`
	Occurrence float64                `json:"occurrence"`          // Percentage of documents containing this field
	Fields     map[string]SchemaField `json:"fields,omitempty"`    // For nested objects
	ArrayType  *SchemaField           `json:"arrayType,omitempty"` // For arrays
}

// SchemaResult represents the inferred schema of a collection.
type SchemaResult struct {
	Collection string                 `json:"collection"`
	SampleSize int                    `json:"sampleSize"`
	TotalDocs  int64                  `json:"totalDocs"`
	Fields     map[string]SchemaField `json:"fields"`
}

// AIQueryResult is the result of an AI-assisted query generation (F077).
type AIQueryResult struct {
	Raw          string `json:"raw"`          // full model response text
	Query        string `json:"query"`        // extracted from first fenced code block (Raw fallback if none)
	Explanation  string `json:"explanation"`  // text outside the code block, trimmed
	Model        string `json:"model"`        // resolved model identifier used for the call
	InputTokens  int    `json:"inputTokens"`  // prompt tokens reported by the provider
	OutputTokens int    `json:"outputTokens"` // completion tokens reported by the provider
}

// =============================================================================
// Export/Import Types
// =============================================================================

// DocumentExportEntry represents a document to be exported.
type DocumentExportEntry struct {
	Database   string `json:"database"`
	Collection string `json:"collection"`
	DocID      string `json:"docId"`
	JSON       string `json:"json"`
}

// ExportProgress represents the progress of an export/import operation.
type ExportProgress struct {
	ExportID        string `json:"exportId,omitempty"` // Unique export ID for tracking concurrent exports
	Phase           string `json:"phase"`              // "exporting" | "importing" | "previewing"
	Database        string `json:"database"`
	Collection      string `json:"collection"`
	Current         int64  `json:"current"`
	Total           int64  `json:"total"`
	DatabaseIndex   int    `json:"databaseIndex"`   // Current database (1-indexed)
	DatabaseTotal   int    `json:"databaseTotal"`   // Total databases
	CollectionIndex int    `json:"collectionIndex"` // Current collection (1-indexed) for collection-level exports
	CollectionTotal int    `json:"collectionTotal"` // Total collections for collection-level exports
	ProcessedDocs   int64  `json:"processedDocs"`   // Cumulative docs processed across all collections
	TotalDocs       int64  `json:"totalDocs"`       // Total docs across all collections (for ETA)
}

// ImportProgress is the same as ExportProgress.
type ImportProgress = ExportProgress

// ImportOptions specifies how to handle existing documents during import.
type ImportOptions struct {
	FilePath       string   `json:"filePath"`       // Path to the zip file
	Databases      []string `json:"databases"`      // Databases to import (empty = all)
	Collections    []string `json:"collections"`    // Collections to import (empty = all, for collection-level imports)
	SourceDatabase string   `json:"sourceDatabase"` // Source database in archive (for collection-level imports)
	Mode           string   `json:"mode"`           // "skip" | "override"
}

// ImportPreview contains info about an import file for user selection.
type ImportPreview struct {
	FilePath   string                  `json:"filePath"`
	ExportedAt string                  `json:"exportedAt"`
	Databases  []ImportPreviewDatabase `json:"databases"`
}

// ImportPreviewDatabase contains info about a database in the import file.
type ImportPreviewDatabase struct {
	Name            string `json:"name"`
	CollectionCount int    `json:"collectionCount"`
	DocumentCount   int64  `json:"documentCount"`
}

// CollectionImportResult contains import results for a single collection.
type CollectionImportResult struct {
	Name                string   `json:"name"`
	DocumentsInserted   int64    `json:"documentsInserted"`
	DocumentsSkipped    int64    `json:"documentsSkipped"`
	DocumentsParseError int64    `json:"documentsParseError,omitempty"` // Docs that failed to parse
	CurrentCount        int64    `json:"currentCount,omitempty"`        // For dry-run: docs currently in target
	IndexErrors         []string `json:"indexErrors,omitempty"`         // Errors from index creation
}

// DatabaseImportResult contains import results for a single database.
type DatabaseImportResult struct {
	Name         string                   `json:"name"`
	Collections  []CollectionImportResult `json:"collections"`
	CurrentCount int64                    `json:"currentCount,omitempty"` // For dry-run: total docs currently in target
}

// ImportResult contains the result of an import operation.
type ImportResult struct {
	Databases           []DatabaseImportResult `json:"databases"`
	DocumentsInserted   int64                  `json:"documentsInserted"`
	DocumentsSkipped    int64                  `json:"documentsSkipped"`
	DocumentsFailed     int64                  `json:"documentsFailed,omitempty"`     // Docs that failed to restore
	DocumentsParseError int64                  `json:"documentsParseError,omitempty"` // Docs that failed to parse
	DocumentsDropped    int64                  `json:"documentsDropped,omitempty"`    // For dry-run override: docs that will be dropped
	Errors              []string               `json:"errors"`
}

// ImportErrorResult contains partial results and error details when an import fails.
type ImportErrorResult struct {
	Error              string       `json:"error"`                        // The error message
	PartialResult      ImportResult `json:"partialResult"`                // What was imported before failure
	FailedDatabase     string       `json:"failedDatabase,omitempty"`     // Database where failure occurred
	FailedCollection   string       `json:"failedCollection,omitempty"`   // Collection where failure occurred
	RemainingDatabases []string     `json:"remainingDatabases,omitempty"` // Databases that weren't attempted
}

// ExportManifest contains metadata about an exported archive.
type ExportManifest struct {
	Version    string                   `json:"version"`
	ExportedAt time.Time                `json:"exportedAt"`
	Databases  []ExportManifestDatabase `json:"databases"`
}

// ExportManifestDatabase contains info about an exported database.
type ExportManifestDatabase struct {
	Name        string                     `json:"name"`
	Collections []ExportManifestCollection `json:"collections"`
}

// ExportManifestCollection contains info about an exported collection.
type ExportManifestCollection struct {
	Name       string `json:"name"`
	DocCount   int64  `json:"docCount"`
	IndexCount int    `json:"indexCount"`
}

// CollectionsImportPreview contains info about an export file for collection import.
type CollectionsImportPreview struct {
	FilePath   string                             `json:"filePath"`
	ExportedAt string                             `json:"exportedAt"`
	Databases  []CollectionsImportPreviewDatabase `json:"databases"`
}

// CollectionsImportPreviewDatabase describes a database in the export file.
type CollectionsImportPreviewDatabase struct {
	Name        string                         `json:"name"`
	Collections []CollectionsImportPreviewItem `json:"collections"`
}

// CollectionsImportPreviewItem describes a collection in the export file.
type CollectionsImportPreviewItem struct {
	Name     string `json:"name"`
	DocCount int64  `json:"docCount"`
}

// =============================================================================
// JSON Export/Import Types
// =============================================================================

// JSONExportOptions specifies options for JSON export.
type JSONExportOptions struct {
	Filter   string `json:"filter"`   // Optional query filter in Extended JSON format
	FilePath string `json:"filePath"` // Pre-selected file path; if provided, skip save dialog
	Pretty   bool   `json:"pretty"`   // Pretty-print output
	Array    bool   `json:"array"`    // If true, output as JSON array; if false, NDJSON (one doc per line)
}

// JSONImportOptions specifies options for JSON import.
type JSONImportOptions struct {
	FilePath string `json:"filePath"` // Path to the JSON/NDJSON file
	Mode     string `json:"mode"`     // "skip" | "override"
}

// JSONImportPreview contains info about a JSON file for user preview.
type JSONImportPreview struct {
	FilePath      string `json:"filePath"`
	Format        string `json:"format"` // "ndjson" | "jsonarray"
	DocumentCount int64  `json:"documentCount"`
	FileSize      int64  `json:"fileSize"`
	SampleDoc     string `json:"sampleDoc"`
}

// =============================================================================
// CSV Export Types
// =============================================================================

// CSVExportOptions specifies options for CSV export.
type CSVExportOptions struct {
	Delimiter      string `json:"delimiter"`      // Field delimiter, defaults to comma
	IncludeHeaders bool   `json:"includeHeaders"` // Whether to include column headers
	FlattenArrays  bool   `json:"flattenArrays"`  // If true, join arrays with semicolon; if false, create JSON representation
	Filter         string `json:"filter"`         // Optional query filter in Extended JSON format
	FilePath       string `json:"filePath"`       // Pre-selected file path; if provided, skip save dialog
}

// =============================================================================
// CSV Import Types
// =============================================================================

// CSVImportPreviewOptions specifies options for previewing a CSV file.
type CSVImportPreviewOptions struct {
	FilePath  string `json:"filePath"`
	Delimiter string `json:"delimiter"` // Auto-detected if empty
	MaxRows   int    `json:"maxRows"`   // Preview row count (default 10)
}

// CSVImportOptions specifies options for CSV import.
type CSVImportOptions struct {
	FilePath      string   `json:"filePath"`
	Delimiter     string   `json:"delimiter"`     // Auto-detected if empty
	HasHeaders    bool     `json:"hasHeaders"`    // If true, first row is headers
	FieldNames    []string `json:"fieldNames"`    // Override headers (used if HasHeaders is false or user renames)
	TypeInference bool     `json:"typeInference"` // Infer types from values
	Mode          string   `json:"mode"`          // "skip" | "override"
}

// CSVImportPreview contains info about a CSV file for user preview.
type CSVImportPreview struct {
	FilePath   string     `json:"filePath"`
	Headers    []string   `json:"headers"`
	SampleRows [][]string `json:"sampleRows"`
	TotalRows  int64      `json:"totalRows"`
	FileSize   int64      `json:"fileSize"`
	Delimiter  string     `json:"delimiter"` // Detected or specified
}

// =============================================================================
// BSON Export/Import Types (mongodump/mongorestore)
// =============================================================================

// ToolAvailability reports which external CLI tools are available.
type ToolAvailability struct {
	Mongodump           bool   `json:"mongodump"`
	MongodumpVersion    string `json:"mongodumpVersion,omitempty"`
	Mongorestore        bool   `json:"mongorestore"`
	MongorestoreVersion string `json:"mongorestoreVersion,omitempty"`
}

// MongodumpOptions specifies options for mongodump export.
type MongodumpOptions struct {
	Databases           []string            `json:"databases"`                     // Export specific databases (empty = all except system)
	Database            string              `json:"database,omitempty"`            // Single database export
	Collections         []string            `json:"collections,omitempty"`         // Specific collections within Database
	ExcludeCollections  []string            `json:"excludeCollections,omitempty"`  // Collections to exclude (used instead of Collections for single-archive export)
	DatabaseCollections map[string][]string `json:"databaseCollections,omitempty"` // db → excluded collections (for multi-DB partial selection)
	OutputPath          string              `json:"outputPath"`                    // .tar.gz archive path
}

// MongorestoreOptions specifies options for mongorestore import.
type MongorestoreOptions struct {
	InputPath  string   `json:"inputPath"`            // Input directory or archive path
	Database   string   `json:"database,omitempty"`   // Target database (overrides source)
	Collection string   `json:"collection,omitempty"` // Target collection (for single-collection restore)
	Drop       bool     `json:"drop"`                 // Drop each collection before import
	DryRun     bool     `json:"dryRun"`               // Preview without importing
	Files      []string `json:"files,omitempty"`      // Specific archive files to import (empty = all)
	NsInclude  []string `json:"nsInclude,omitempty"`  // --nsInclude namespace filter patterns (e.g. "db.coll")
}

// ImportDirEntry represents a single file entry in a directory scan.
type ImportDirEntry struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// ArchivePreview contains the contents of a .archive file as discovered by mongorestore --dryRun.
type ArchivePreview struct {
	Databases []ArchivePreviewDatabase `json:"databases"`
}

// ArchivePreviewDatabase describes a database found inside an archive.
type ArchivePreviewDatabase struct {
	Name        string                     `json:"name"`
	Collections []ArchivePreviewCollection `json:"collections"`
}

// ArchivePreviewCollection describes a collection found inside an archive.
type ArchivePreviewCollection struct {
	Name      string `json:"name"`
	Documents int64  `json:"documents"`
}

// =============================================================================
// Script Execution Types
// =============================================================================

// ScriptResult represents the result of executing a MongoDB shell script.
type ScriptResult struct {
	Output   string `json:"output"`
	Error    string `json:"error,omitempty"`
	ExitCode int    `json:"exitCode"`
}

// =============================================================================
// Saved Query Types
// =============================================================================

// SavedQuery represents a saved MongoDB query.
type SavedQuery struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	ConnectionID string    `json:"connectionId"`
	Database     string    `json:"database"`
	Collection   string    `json:"collection"`
	Query        string    `json:"query"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// =============================================================================
// Theme Types
// =============================================================================

// ThemeColors defines the 27 color tokens that constitute a theme.
type ThemeColors struct {
	Background   string `json:"background"`
	Surface      string `json:"surface"`
	SurfaceHover string `json:"surfaceHover"`
	SurfaceActive string `json:"surfaceActive"`
	TextDim      string `json:"textDim"`
	TextMuted    string `json:"textMuted"`
	TextSecondary string `json:"textSecondary"`
	TextLight    string `json:"textLight"`
	Text         string `json:"text"`
	Border       string `json:"border"`
	BorderLight  string `json:"borderLight"`
	BorderHover  string `json:"borderHover"`

	Primary      string `json:"primary"`
	PrimaryHover string `json:"primaryHover"`
	PrimaryMuted string `json:"primaryMuted"`

	Error       string `json:"error"`
	ErrorDark   string `json:"errorDark"`
	Warning     string `json:"warning"`
	WarningDark string `json:"warningDark"`
	Success     string `json:"success"`
	SuccessDark string `json:"successDark"`
	Info        string `json:"info"`
	InfoDark    string `json:"infoDark"`

	ScrollbarTrack      string `json:"scrollbarTrack"`
	ScrollbarThumb      string `json:"scrollbarThumb"`
	ScrollbarThumbHover string `json:"scrollbarThumbHover"`
}

// ThemeFonts defines the 2 font tokens.
type ThemeFonts struct {
	UI   string `json:"ui"`
	Mono string `json:"mono"`
}

// Theme is a complete color + font theme.
type Theme struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Author  string      `json:"author,omitempty"`
	Builtin bool        `json:"builtin"`
	Colors  ThemeColors `json:"colors"`
	Fonts   ThemeFonts  `json:"fonts,omitempty"`
}

// ThemeConfig persists the user's current theme selection.
type ThemeConfig struct {
	ActiveThemeID string `json:"activeThemeId"`
}

// =============================================================================
// Server Info Types
// =============================================================================

// ServerInfo contains comprehensive server diagnostics from multiple MongoDB commands.
type ServerInfo struct {
	ServerVersion  string            `json:"serverVersion"`
	GitVersion     string            `json:"gitVersion"`
	Modules        []string          `json:"modules"`
	OpenSSLVersion string            `json:"openSSLVersion"`
	Topology       string            `json:"topology"` // "standalone", "replicaset", "sharded"
	MaxBsonSize    int64             `json:"maxBsonSize"`
	MaxMsgSize     int64             `json:"maxMsgSize"`
	MaxWriteBatch  int64             `json:"maxWriteBatch"`
	ReadOnly       bool              `json:"readOnly"`
	FCV            string            `json:"fcv"`
	FCVError       string            `json:"fcvError,omitempty"`
	Host           *ServerHostInfo   `json:"host,omitempty"`
	Status         *ServerStatusInfo `json:"status,omitempty"`
	ReplicaSet     *ReplicaSetInfo   `json:"replicaSet,omitempty"`
	RawServerStatus string           `json:"rawServerStatus,omitempty"`
	RawReplStatus   string           `json:"rawReplStatus,omitempty"`
	Errors         map[string]string `json:"errors,omitempty"`
}

// ServerHostInfo contains host system information.
type ServerHostInfo struct {
	Hostname string  `json:"hostname"`
	OS       string  `json:"os"`
	Arch     string  `json:"arch"`
	CPUs     int     `json:"cpus"`
	MemoryMB float64 `json:"memoryMB"`
}

// ServerStatusInfo contains key metrics from serverStatus.
type ServerStatusInfo struct {
	Uptime              int64  `json:"uptime"`
	ConnsActive         int64  `json:"connsActive"`
	ConnsCurrent        int64  `json:"connsCurrent"`
	ConnsAvailable      int64  `json:"connsAvailable"`
	ConnsTotalCreated   int64  `json:"connsTotalCreated"`
	OpsInsert           int64  `json:"opsInsert"`
	OpsQuery            int64  `json:"opsQuery"`
	OpsUpdate           int64  `json:"opsUpdate"`
	OpsDelete           int64  `json:"opsDelete"`
	OpsGetmore          int64  `json:"opsGetmore"`
	OpsCommand          int64  `json:"opsCommand"`
	MemResident         int64  `json:"memResident"`
	MemVirtual          int64  `json:"memVirtual"`
	NetworkBytesIn      int64  `json:"networkBytesIn"`
	NetworkBytesOut     int64  `json:"networkBytesOut"`
	NetworkRequests     int64  `json:"networkRequests"`
	StorageEngine       string `json:"storageEngine"`
}

// ReplicaSetInfo contains replica set topology information.
type ReplicaSetInfo struct {
	Name    string             `json:"name"`
	Members []ReplicaSetMember `json:"members"`
}

// ReplicaSetMember describes a single replica set member.
type ReplicaSetMember struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	StateStr   string `json:"stateStr"`
	Health     int    `json:"health"`
	Uptime     int64  `json:"uptime"`
	OptimeDate string `json:"optimeDate"`
	SyncSource string `json:"syncSource,omitempty"`
	Self       bool   `json:"self"`
}
