package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/peternagy/mongopal/internal/auth"
	"github.com/peternagy/mongopal/internal/connection"
	"github.com/peternagy/mongopal/internal/core"
	"github.com/peternagy/mongopal/internal/credential"
	"github.com/peternagy/mongopal/internal/database"
	"github.com/peternagy/mongopal/internal/debug"
	"github.com/peternagy/mongopal/internal/document"
	"github.com/peternagy/mongopal/internal/export"
	"github.com/peternagy/mongopal/internal/importer"
	"github.com/peternagy/mongopal/internal/performance"
	"github.com/peternagy/mongopal/internal/schema"
	"github.com/peternagy/mongopal/internal/script"
	"github.com/peternagy/mongopal/internal/storage"
	"github.com/peternagy/mongopal/internal/theme"
	"github.com/peternagy/mongopal/internal/types"
)

// =============================================================================
// Type Re-exports for Wails Binding Generation
// =============================================================================

type Folder = types.Folder
type SavedConnection = types.SavedConnection
type ExtendedConnection = types.ExtendedConnection
type ConnectionInfo = types.ConnectionInfo
type ConnectionStatus = types.ConnectionStatus
type TestConnectionResult = types.TestConnectionResult
type ConnectionShareResult = types.ConnectionShareResult
type BulkConnectionShareResult = types.BulkConnectionShareResult
type BulkShareEntry = types.BulkShareEntry
type DatabaseInfo = types.DatabaseInfo
type CollectionInfo = types.CollectionInfo
type CollectionExportInfo = types.CollectionExportInfo
type CollectionStats = types.CollectionStats
type IndexInfo = types.IndexInfo
type IndexOptions = types.IndexOptions
type ExplainResult = types.ExplainResult
type QueryPlannerResult = types.QueryPlannerResult
type ExecutionStatsResult = types.ExecutionStatsResult
type QueryOptions = types.QueryOptions
type QueryResult = types.QueryResult
type SchemaField = types.SchemaField
type SchemaResult = types.SchemaResult
type DocumentExportEntry = types.DocumentExportEntry
type ExportProgress = types.ExportProgress
type ImportProgress = types.ImportProgress
type ImportOptions = types.ImportOptions
type ImportPreview = types.ImportPreview
type ImportPreviewDatabase = types.ImportPreviewDatabase
type CollectionImportResult = types.CollectionImportResult
type DatabaseImportResult = types.DatabaseImportResult
type ImportResult = types.ImportResult
type ExportManifest = types.ExportManifest
type ExportManifestDatabase = types.ExportManifestDatabase
type ExportManifestCollection = types.ExportManifestCollection
type CollectionsImportPreview = types.CollectionsImportPreview
type CollectionsImportPreviewDatabase = types.CollectionsImportPreviewDatabase
type CollectionsImportPreviewItem = types.CollectionsImportPreviewItem
type ScriptResult = types.ScriptResult
type CSVExportOptions = types.CSVExportOptions
type JSONExportOptions = types.JSONExportOptions
type JSONImportOptions = types.JSONImportOptions
type JSONImportPreview = types.JSONImportPreview
type CSVImportPreviewOptions = types.CSVImportPreviewOptions
type CSVImportOptions = types.CSVImportOptions
type CSVImportPreview = types.CSVImportPreview
type ToolAvailability = types.ToolAvailability
type MongodumpOptions = types.MongodumpOptions
type MongorestoreOptions = types.MongorestoreOptions
type ImportDirEntry = types.ImportDirEntry
type ArchivePreview = types.ArchivePreview
type ArchivePreviewDatabase = types.ArchivePreviewDatabase
type ArchivePreviewCollection = types.ArchivePreviewCollection
type SavedQuery = types.SavedQuery
type CollectionProfile = types.CollectionProfile
type ServerInfo = types.ServerInfo
type ServerHostInfo = types.ServerHostInfo
type ServerStatusInfo = types.ServerStatusInfo
type ReplicaSetInfo = types.ReplicaSetInfo
type ReplicaSetMember = types.ReplicaSetMember
type PerformanceMetrics = performance.Metrics
type Theme = types.Theme
type ThemeColors = types.ThemeColors
type ThemeFonts = types.ThemeFonts
type ThemeConfig = types.ThemeConfig

// =============================================================================
// App - Thin Facade for Wails Bindings
// =============================================================================

// App struct holds the application state and services
type App struct {
	state            *core.AppState
	storage          *storage.Service
	encryptedStorage *credential.EncryptedStorage
	connStore        *storage.ConnectionService
	connLifecycle    *storage.ConnectionLifecycle
	folderSvc        *storage.FolderService
	querySvc         *storage.QueryService
	favoriteSvc      *storage.FavoriteService
	dbMetaSvc        *storage.DatabaseMetadataService
	connection       *connection.Service
	database         *database.Service
	document         *document.Service
	schema           *schema.Service
	export           *export.Service
	importer         *importer.Service
	script           *script.Service
	performance      *performance.Service
	auth             *auth.Service
	theme            *theme.ThemeManager
}

// NewApp creates a new App instance
func NewApp() *App {
	state := core.NewAppState()
	storageSvc := storage.NewService("")

	return &App{
		state:   state,
		storage: storageSvc,
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.state.Ctx = ctx
	a.state.Emitter = &core.WailsEventEmitter{Ctx: ctx}

	// Initialize debug logger
	debug.Init(ctx)

	// Initialize OS authentication service with 1-minute grace period
	a.auth = auth.NewService(1 * time.Minute)

	// Initialize config directory and storage
	configDir := storage.InitConfigDir()
	a.storage = storage.NewService(configDir)
	a.state.ConfigDir = configDir

	// Initialize encrypted storage for connections
	encryptedStorageDir := configDir + "/connections"
	encStorage, err := credential.NewEncryptedStorage(encryptedStorageDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to initialize encrypted storage: %v\n", err)
		// Create a fallback - will continue without persistent encryption keys
		encStorage, _ = credential.NewEncryptedStorage(encryptedStorageDir)
	}
	a.encryptedStorage = encStorage

	// Load folders
	folders, _ := a.storage.LoadFolders()
	a.state.Folders = folders

	// Initialize connection service with encrypted storage
	a.connStore = storage.NewConnectionService(a.state, a.storage, encStorage)

	// Load connections from encrypted storage
	if err := a.connStore.LoadAllConnections(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to load connections: %v\n", err)
	}

	// Initialize all other services
	a.folderSvc = storage.NewFolderService(a.state, a.storage)
	a.querySvc = storage.NewQueryService(configDir)
	a.favoriteSvc = storage.NewFavoriteService(configDir)
	a.dbMetaSvc = storage.NewDatabaseMetadataService(configDir)
	a.connLifecycle = storage.NewConnectionLifecycle(a.connStore, a.favoriteSvc, a.dbMetaSvc, a.querySvc)
	a.connection = connection.NewService(a.state, a.connStore)
	a.database = database.NewService(a.state)
	a.document = document.NewService(a.state)
	a.schema = schema.NewService(a.state)
	a.export = export.NewService(a.state, a.connStore)
	a.importer = importer.NewService(a.state, a.connStore)
	a.script = script.NewService(a.connStore)
	a.performance = performance.NewService(a.state)
	a.theme = theme.NewThemeManager(a.state, configDir)
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	a.connection.Shutdown(ctx)
}

// =============================================================================
// Connection Methods
// =============================================================================

func (a *App) Connect(connID string) error {
	return a.connection.Connect(connID)
}

func (a *App) Disconnect(connID string) error {
	return a.connection.Disconnect(connID)
}

func (a *App) DisconnectAll() error {
	return a.connection.DisconnectAll()
}

func (a *App) TestConnection(uri string, connID string) (*TestConnectionResult, error) {
	// For saved connections, merge stored credentials into the test URI
	if connID != "" {
		uri = a.connStore.MergeStoredCredentials(connID, uri)
	}
	return a.connection.TestConnection(uri)
}

func (a *App) GetConnectionStatus(connID string) ConnectionStatus {
	return a.connection.GetConnectionStatus(connID)
}

func (a *App) GetConnectionInfo(connID string) ConnectionInfo {
	return a.connection.GetConnectionInfo(connID)
}

func (a *App) GetServerInfo(connID string) (*ServerInfo, error) {
	return a.connection.GetServerInfo(connID)
}

// =============================================================================
// Storage - Connection Methods
// =============================================================================

func (a *App) SaveExtendedConnection(conn ExtendedConnection) error {
	return a.connStore.SaveExtendedConnection(conn)
}

func (a *App) GetExtendedConnection(connID string) (ExtendedConnection, error) {
	return a.connStore.GetExtendedConnection(connID)
}

func (a *App) ListSavedConnections() ([]SavedConnection, error) {
	return a.connStore.ListSavedConnections()
}

func (a *App) GetSavedConnection(connID string) (SavedConnection, error) {
	return a.connStore.GetSavedConnection(connID)
}

func (a *App) DeleteSavedConnection(connID string) error {
	return a.connLifecycle.DeleteConnection(connID)
}

func (a *App) DuplicateConnection(connID, newName string) (SavedConnection, error) {
	return a.connStore.DuplicateConnection(connID, newName)
}

// resolveFolderPath builds the folder name path (e.g. ["Work", "Backend"]) for a given folder ID.
func (a *App) resolveFolderPath(folderID string) []string {
	if folderID == "" {
		return nil
	}
	folders, _ := a.folderSvc.ListFolders()
	byID := make(map[string]Folder, len(folders))
	for _, f := range folders {
		byID[f.ID] = f
	}
	var path []string
	for id := folderID; id != ""; {
		f, ok := byID[id]
		if !ok {
			break
		}
		path = append([]string{f.Name}, path...)
		id = f.ParentID
	}
	return path
}

// ExportEncryptedConnection encrypts a saved connection for sharing.
// Requires OS authentication for saved connections with credentials.
func (a *App) ExportEncryptedConnection(connID string) (*ConnectionShareResult, error) {
	// Require OS auth since we're exporting credentials
	if err := a.auth.Authenticate("MongoPal needs to verify your identity to export credentials"); err != nil {
		return nil, fmt.Errorf("authentication required to export credentials")
	}

	ext, err := a.connStore.GetExtendedConnection(connID)
	if err != nil {
		return nil, err
	}

	return credential.ExportConnection(ext, a.resolveFolderPath(ext.FolderID))
}

// ExportEncryptedConnections encrypts multiple connections with a single shared key.
// Requires OS authentication.
func (a *App) ExportEncryptedConnections(connIDs []string) (*BulkConnectionShareResult, error) {
	if err := a.auth.Authenticate("MongoPal needs to verify your identity to export credentials"); err != nil {
		return nil, fmt.Errorf("authentication required to export credentials")
	}

	connections := make([]types.ExtendedConnection, 0, len(connIDs))
	folderPaths := make([][]string, 0, len(connIDs))
	for _, connID := range connIDs {
		ext, err := a.connStore.GetExtendedConnection(connID)
		if err != nil {
			return nil, fmt.Errorf("failed to load connection %s: %w", connID, err)
		}
		connections = append(connections, ext)
		folderPaths = append(folderPaths, a.resolveFolderPath(ext.FolderID))
	}

	return credential.ExportConnections(connections, folderPaths)
}

// ExportEncryptedConnectionFromForm encrypts form data directly (for unsaved connections).
func (a *App) ExportEncryptedConnectionFromForm(formDataJSON string) (*ConnectionShareResult, error) {
	bundle, key, err := credential.EncryptForSharing([]byte(formDataJSON))
	if err != nil {
		return nil, err
	}
	return &ConnectionShareResult{Bundle: bundle, Key: key}, nil
}

// DecryptConnectionImport decrypts an encrypted connection bundle.
func (a *App) DecryptConnectionImport(bundleJSON string, key string) (string, error) {
	data, err := credential.DecryptFromSharing(bundleJSON, key)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ConnectionToURI(connID string) (string, error) {
	return a.connStore.ConnectionToURI(connID)
}

func (a *App) ConnectionFromURI(uri string) (SavedConnection, error) {
	return a.connStore.ConnectionFromURI(uri)
}

// =============================================================================
// Storage - Folder Methods
// =============================================================================

func (a *App) CreateFolder(name, parentID string) (Folder, error) {
	return a.folderSvc.CreateFolder(name, parentID)
}

func (a *App) DeleteFolder(folderID string) error {
	movedConnIDs, err := a.folderSvc.DeleteFolder(folderID)
	if err != nil {
		return err
	}
	// Sync cleared folder IDs to encrypted storage
	for _, connID := range movedConnIDs {
		_ = a.connStore.UpdateFolderID(connID, "")
	}
	return nil
}

func (a *App) ListFolders() ([]Folder, error) {
	return a.folderSvc.ListFolders()
}

func (a *App) UpdateFolder(folderID, name, parentID string) error {
	return a.folderSvc.UpdateFolder(folderID, name, parentID)
}

func (a *App) MoveConnectionToFolder(connID, folderID string) error {
	if err := a.folderSvc.MoveConnectionToFolder(connID, folderID); err != nil {
		return err
	}
	// Also update encrypted storage so FolderID survives restart
	return a.connStore.UpdateFolderID(connID, folderID)
}

// =============================================================================
// Database Methods
// =============================================================================

func (a *App) ListDatabases(connID string) ([]DatabaseInfo, error) {
	databases, err := a.database.ListDatabases(connID)
	if err != nil {
		return nil, err
	}

	// Collect database names for cleanup
	dbNames := make([]string, len(databases))
	for i, db := range databases {
		dbNames[i] = db.Name
	}

	// Cleanup stale database metadata (databases that no longer exist)
	_ = a.dbMetaSvc.CleanupStaleDatabases(connID, dbNames)

	// Enrich with LastAccessedAt from metadata
	for i := range databases {
		databases[i].LastAccessedAt = a.dbMetaSvc.GetDatabaseLastAccessed(connID, databases[i].Name)
	}

	return databases, nil
}

func (a *App) UpdateDatabaseAccessed(connID, dbName string) error {
	return a.dbMetaSvc.UpdateDatabaseAccessed(connID, dbName)
}

func (a *App) ListCollections(connID, dbName string) ([]CollectionInfo, error) {
	return a.database.ListCollections(connID, dbName)
}

func (a *App) ListIndexes(connID, dbName, collName string) ([]IndexInfo, error) {
	return a.database.ListIndexes(connID, dbName, collName)
}

func (a *App) CreateIndex(connID, dbName, collName string, keys map[string]int, opts IndexOptions) error {
	return a.database.CreateIndex(connID, dbName, collName, keys, opts)
}

func (a *App) DropIndex(connID, dbName, collName, indexName string) error {
	return a.database.DropIndex(connID, dbName, collName, indexName)
}

func (a *App) DropDatabase(connID, dbName string) error {
	return a.database.DropDatabase(connID, dbName)
}

func (a *App) DropCollection(connID, dbName, collName string) error {
	return a.database.DropCollection(connID, dbName, collName)
}

func (a *App) ClearCollection(connID, dbName, collName string) error {
	return a.database.ClearCollection(connID, dbName, collName)
}

func (a *App) GetDatabasesForExport(connID string) ([]DatabaseInfo, error) {
	return a.database.ListDatabases(connID)
}

func (a *App) GetCollectionsForExport(connID, dbName string) ([]CollectionExportInfo, error) {
	return a.database.GetCollectionsForExport(connID, dbName)
}

func (a *App) GetCollectionStats(connID, dbName, collName string) (*CollectionStats, error) {
	return a.database.GetCollectionStats(connID, dbName, collName)
}

func (a *App) GetCollectionProfile(connID, dbName, collName string) (*CollectionProfile, error) {
	return a.database.GetCollectionProfile(connID, dbName, collName)
}

func (a *App) ExplainQuery(connID, dbName, collName, filter string) (*ExplainResult, error) {
	return a.database.ExplainQuery(connID, dbName, collName, filter)
}

// =============================================================================
// Document Methods
// =============================================================================

func (a *App) FindDocuments(connID, dbName, collName, query string, opts QueryOptions) (*QueryResult, error) {
	return a.document.FindDocuments(connID, dbName, collName, query, opts)
}

// AggregateDocuments executes an aggregation pipeline (SQL GROUP BY execution, F076).
func (a *App) AggregateDocuments(connID, dbName, collName, pipeline string, opts QueryOptions) (*QueryResult, error) {
	return a.document.AggregateDocuments(connID, dbName, collName, pipeline, opts)
}

func (a *App) GetDocument(connID, dbName, collName, docID string) (string, error) {
	return a.document.GetDocument(connID, dbName, collName, docID)
}

func (a *App) UpdateDocument(connID, dbName, collName, docID, jsonDoc string) error {
	return a.document.UpdateDocument(connID, dbName, collName, docID, jsonDoc)
}

func (a *App) InsertDocument(connID, dbName, collName, jsonDoc string) (string, error) {
	return a.document.InsertDocument(connID, dbName, collName, jsonDoc)
}

func (a *App) DeleteDocument(connID, dbName, collName, docID string) error {
	return a.document.DeleteDocument(connID, dbName, collName, docID)
}

func (a *App) ValidateJSON(jsonStr string) error {
	return document.ValidateJSON(jsonStr)
}

// =============================================================================
// Schema Methods
// =============================================================================

func (a *App) InferCollectionSchema(connID, dbName, collName string, sampleSize int) (*SchemaResult, error) {
	return a.schema.InferCollectionSchema(connID, dbName, collName, sampleSize)
}

func (a *App) ExportSchemaAsJSON(jsonContent, defaultFilename string) error {
	return schema.ExportSchemaAsJSON(a.state.Ctx, jsonContent, defaultFilename)
}

// =============================================================================
// Export Methods
// =============================================================================

func (a *App) ExportDatabases(connID string, dbNames []string, savePath string) error {
	return a.export.ExportDatabases(connID, dbNames, savePath)
}

func (a *App) ExportSelectiveDatabases(connID string, dbCollections map[string][]string, savePath string) error {
	return a.export.ExportSelectiveDatabases(connID, dbCollections, savePath)
}

// GetZipSavePath opens a native save file dialog for ZIP files and returns the selected path.
func (a *App) GetZipSavePath(defaultFilename string) (string, error) {
	selected, err := runtime.SaveFileDialog(a.state.Ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Save Export",
		Filters: []runtime.FileFilter{
			{DisplayName: "Zip Files (*.zip)", Pattern: "*.zip"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to open save dialog: %w", err)
	}
	return selected, nil
}

// GetBSONImportDirPath opens a native directory dialog for selecting a mongodump output directory.
func (a *App) GetBSONImportDirPath() (string, error) {
	return a.export.GetBSONImportDirPath()
}

// ScanImportDir lists all files in a directory with their sizes.
func (a *App) ScanImportDir(dirPath string) ([]ImportDirEntry, error) {
	return export.ScanImportDir(dirPath)
}

// GetBSONSavePath opens a native save file dialog for .archive files and returns the selected path.
func (a *App) GetBSONSavePath(defaultFilename string) (string, error) {
	selected, err := runtime.SaveFileDialog(a.state.Ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Save BSON Export",
	})
	if err != nil {
		return "", fmt.Errorf("failed to open save dialog: %w", err)
	}
	return selected, nil
}

func (a *App) CancelExport() {
	a.export.CancelExport()
}

func (a *App) PauseExport() {
	a.export.PauseExport()
}

func (a *App) ResumeExport() {
	a.export.ResumeExport()
}

func (a *App) IsExportPaused() bool {
	return a.export.IsExportPaused()
}

func (a *App) ExportCollections(connID, dbName string, collNames []string) error {
	return a.export.ExportCollections(connID, dbName, collNames)
}

func (a *App) ExportDocumentsAsZip(entries []DocumentExportEntry, defaultFilename string) error {
	return a.export.ExportDocumentsAsZip(entries, defaultFilename)
}

func (a *App) ExportCollectionAsCSV(connID, dbName, collName, defaultFilename string, opts CSVExportOptions) error {
	return a.export.ExportCollectionAsCSV(connID, dbName, collName, defaultFilename, opts)
}

func (a *App) GetCSVSavePath(defaultFilename string) (string, error) {
	return a.export.GetCSVSavePath(defaultFilename)
}

func (a *App) GetJSONSavePath(defaultFilename string) (string, error) {
	return a.export.GetJSONSavePath(defaultFilename)
}

func (a *App) ExportCollectionAsJSON(connID, dbName, collName, defaultFilename string, opts JSONExportOptions) error {
	return a.export.ExportCollectionAsJSON(connID, dbName, collName, defaultFilename, opts)
}

func (a *App) RevealInFinder(filePath string) error {
	return a.export.RevealInFinder(filePath)
}

// =============================================================================
// Import Methods
// =============================================================================

func (a *App) PreviewImportFile() (*ImportPreview, error) {
	return a.importer.PreviewImportFile()
}

func (a *App) PreviewImportFilePath(filePath string) (*ImportPreview, error) {
	return a.importer.PreviewImportFilePath(filePath)
}

func (a *App) DryRunImport(connID string, opts ImportOptions) (*ImportResult, error) {
	return a.importer.DryRunImport(connID, opts)
}

func (a *App) ImportDatabases(connID string, opts ImportOptions) (*ImportResult, error) {
	return a.importer.ImportDatabases(connID, opts)
}

func (a *App) ImportSelectiveDatabases(connID string, dbCollections map[string][]string, mode string, filePath string) error {
	_, err := a.importer.ImportSelectiveDatabases(connID, dbCollections, types.ImportOptions{FilePath: filePath, Mode: mode})
	return err
}

func (a *App) DryRunSelectiveImport(connID string, dbCollections map[string][]string, mode string, filePath string) error {
	_, err := a.importer.DryRunSelectiveImport(connID, dbCollections, types.ImportOptions{FilePath: filePath, Mode: mode})
	return err
}

func (a *App) CancelImport() {
	a.importer.CancelImport()
}

func (a *App) PauseImport() {
	a.importer.PauseImport()
}

func (a *App) ResumeImport() {
	a.importer.ResumeImport()
}

func (a *App) IsImportPaused() bool {
	return a.importer.IsImportPaused()
}

func (a *App) PreviewCollectionsImportFile() (*CollectionsImportPreview, error) {
	return a.importer.PreviewCollectionsImportFile()
}

func (a *App) PreviewCollectionsImportFilePath(filePath string) (*CollectionsImportPreview, error) {
	return a.importer.PreviewCollectionsImportFilePath(filePath)
}

func (a *App) DryRunImportCollections(connID, dbName string, opts ImportOptions) (*ImportResult, error) {
	return a.importer.DryRunImportCollections(connID, dbName, opts)
}

func (a *App) ImportCollections(connID, dbName string, opts ImportOptions) (*ImportResult, error) {
	return a.importer.ImportCollections(connID, dbName, opts)
}

func (a *App) GetImportFilePath() (string, error) {
	return a.importer.GetImportFilePath()
}

func (a *App) DetectFileFormat(filePath string) (string, error) {
	return importer.DetectFileFormat(filePath)
}

func (a *App) PreviewJSONFile(filePath string) (*JSONImportPreview, error) {
	return a.importer.PreviewJSONFile(filePath)
}

func (a *App) ImportJSON(connID, dbName, collName string, opts JSONImportOptions) (*ImportResult, error) {
	return a.importer.ImportJSON(connID, dbName, collName, opts)
}

func (a *App) DryRunImportJSON(connID, dbName, collName string, opts JSONImportOptions) (*ImportResult, error) {
	return a.importer.DryRunImportJSON(connID, dbName, collName, opts)
}

// CSV Import Methods

func (a *App) PreviewCSVFile(opts CSVImportPreviewOptions) (*CSVImportPreview, error) {
	return a.importer.PreviewCSVFile(opts)
}

func (a *App) ImportCSV(connID, dbName, collName string, opts CSVImportOptions) (*ImportResult, error) {
	return a.importer.ImportCSV(connID, dbName, collName, opts)
}

func (a *App) DryRunImportCSV(connID, dbName, collName string, opts CSVImportOptions) (*ImportResult, error) {
	return a.importer.DryRunImportCSV(connID, dbName, collName, opts)
}

// BSON (mongodump/mongorestore) Methods

func (a *App) CheckToolAvailability() *ToolAvailability {
	return export.CheckToolAvailability()
}

func (a *App) ExportWithMongodump(connID string, opts MongodumpOptions) error {
	return a.export.ExportWithMongodump(connID, opts)
}

func (a *App) ImportWithMongorestore(connID string, opts MongorestoreOptions) (*ImportResult, error) {
	return a.export.ImportWithMongorestore(connID, opts)
}

func (a *App) PreviewArchive(connectionId, archivePath string) (*ArchivePreview, error) {
	return a.export.PreviewArchive(connectionId, archivePath)
}

// =============================================================================
// Script Execution Methods
// =============================================================================

func (a *App) CheckMongoshAvailable() (bool, string) {
	return script.CheckMongoshAvailable()
}

func (a *App) ExecuteScript(connID, scriptContent string) (*ScriptResult, error) {
	return a.script.ExecuteScript(connID, scriptContent)
}

func (a *App) ExecuteScriptWithDatabase(connID, dbName, scriptContent string) (*ScriptResult, error) {
	return a.script.ExecuteScriptWithDatabase(connID, dbName, scriptContent)
}

// =============================================================================
// Saved Query Methods
// =============================================================================

func (a *App) SaveQuery(query SavedQuery) (SavedQuery, error) {
	return a.querySvc.SaveQuery(query)
}

func (a *App) GetSavedQuery(queryID string) (SavedQuery, error) {
	return a.querySvc.GetQuery(queryID)
}

func (a *App) ListSavedQueries(connectionID, database, collection string) ([]SavedQuery, error) {
	return a.querySvc.ListQueries(connectionID, database, collection)
}

func (a *App) DeleteSavedQuery(queryID string) error {
	return a.querySvc.DeleteQuery(queryID)
}

// =============================================================================
// Performance Methods
// =============================================================================

func (a *App) GetPerformanceMetrics() *PerformanceMetrics {
	return a.performance.GetMetrics()
}

func (a *App) ForceGC() {
	a.performance.ForceGC()
}

// =============================================================================
// Debug Methods
// =============================================================================

func (a *App) SetDebugEnabled(enabled bool) {
	debug.SetEnabled(enabled)
}

func (a *App) SaveDebugLogs(jsonContent, defaultFilename string) error {
	filePath, err := runtime.SaveFileDialog(a.state.Ctx, runtime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Title:           "Save Debug Logs",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to open save dialog: %w", err)
	}
	if filePath == "" {
		return nil // User cancelled
	}

	if !strings.HasSuffix(strings.ToLower(filePath), ".json") {
		filePath += ".json"
	}

	if err := os.WriteFile(filePath, []byte(jsonContent), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// =============================================================================
// Collection Favorites Methods
// =============================================================================

func (a *App) AddFavorite(connID, dbName, collName string) error {
	return a.favoriteSvc.AddFavorite(connID, dbName, collName)
}

func (a *App) RemoveFavorite(connID, dbName, collName string) error {
	return a.favoriteSvc.RemoveFavorite(connID, dbName, collName)
}

func (a *App) ListFavorites() []string {
	return a.favoriteSvc.ListFavorites()
}

// =============================================================================
// Database Favorites Methods
// =============================================================================

func (a *App) AddDatabaseFavorite(connID, dbName string) error {
	return a.favoriteSvc.AddDatabaseFavorite(connID, dbName)
}

func (a *App) RemoveDatabaseFavorite(connID, dbName string) error {
	return a.favoriteSvc.RemoveDatabaseFavorite(connID, dbName)
}

func (a *App) ListDatabaseFavorites() []string {
	return a.favoriteSvc.ListDatabaseFavorites()
}

// =============================================================================
// Authentication Methods
// =============================================================================

// AuthenticateForPasswordReveal prompts the user for OS-level authentication
// to reveal sensitive credentials. Uses a 1-minute grace period.
func (a *App) AuthenticateForPasswordReveal() error {
	return a.auth.Authenticate("MongoPal needs to verify your identity to reveal passwords")
}

// IsAuthenticatedForPasswordReveal checks if the user is authenticated within grace period.
func (a *App) IsAuthenticatedForPasswordReveal() bool {
	return a.auth.IsAuthenticated()
}

// GetAuthGracePeriodRemaining returns seconds remaining in grace period.
func (a *App) GetAuthGracePeriodRemaining() int {
	remaining := a.auth.GracePeriodRemaining()
	return int(remaining.Seconds())
}

// InvalidatePasswordAuth clears authentication state, requiring re-authentication.
func (a *App) InvalidatePasswordAuth() {
	a.auth.InvalidateAuth()
}
