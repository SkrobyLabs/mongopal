/**
 * Global type declarations for Wails runtime bindings.
 * This file provides type safety for window.go bindings.
 *
 * Methods are based on the auto-generated wailsjs/go/main/App.d.ts
 * and additional runtime methods used by the application.
 */

import { main } from '../../wailsjs/go/models'
import type { TestConnectionResult } from '../components/connection-form/ConnectionFormTypes'

/**
 * Wails App bindings - all methods exposed from the Go backend
 */
export interface WailsAppBindings {
  // Connection methods
  Connect(connectionId: string): Promise<void>
  Disconnect(connectionId: string): Promise<void>
  DisconnectAll(): Promise<void>
  TestConnection(uri: string, connID: string): Promise<TestConnectionResult>

  // Saved connections
  ListSavedConnections(): Promise<main.SavedConnection[]>
  DeleteSavedConnection(connectionId: string): Promise<void>
  DuplicateConnection(connectionId: string, newName: string): Promise<main.SavedConnection>
  ConnectionFromURI(uri: string): Promise<main.SavedConnection>
  ConnectionToURI(connectionId: string): Promise<string>
  MoveConnectionToFolder(connectionId: string, folderId: string): Promise<void>

  // Extended connections (F074)
  GetExtendedConnection(connectionId: string): Promise<main.ExtendedConnection>
  SaveExtendedConnection(connection: main.ExtendedConnection): Promise<void>

  // Encrypted connection sharing
  ExportEncryptedConnection(connectionId: string): Promise<ConnectionShareResult>
  ExportEncryptedConnectionFromForm(formDataJSON: string): Promise<ConnectionShareResult>
  ExportEncryptedConnections(connectionIds: string[]): Promise<BulkConnectionShareResult>
  DecryptConnectionImport(bundleJSON: string, key: string): Promise<string>

  // Folder methods
  ListFolders(): Promise<main.Folder[]>
  CreateFolder(name: string, parentId: string): Promise<main.Folder>
  UpdateFolder(folderId: string, name: string, parentId: string): Promise<void>
  DeleteFolder(folderId: string): Promise<void>

  // Database methods
  ListDatabases(connectionId: string): Promise<main.DatabaseInfo[]>
  ListCollections(connectionId: string, database: string): Promise<main.CollectionInfo[]>
  DropDatabase(connectionId: string, database: string): Promise<void>
  DropCollection(connectionId: string, database: string, collection: string): Promise<void>
  ClearCollection(connectionId: string, database: string, collection: string): Promise<void>

  // Document methods
  FindDocuments(
    connectionId: string,
    database: string,
    collection: string,
    query: string,
    options: main.QueryOptions
  ): Promise<main.QueryResult>
  // SQL GROUP BY execution (F076): pipeline is an EJSON array string.
  AggregateDocuments(
    connectionId: string,
    database: string,
    collection: string,
    pipeline: string,
    options: main.QueryOptions
  ): Promise<main.QueryResult>
  GetDocument(connectionId: string, database: string, collection: string, documentId: string): Promise<string>
  InsertDocument(connectionId: string, database: string, collection: string, document: string): Promise<string>
  UpdateDocument(
    connectionId: string,
    database: string,
    collection: string,
    documentId: string,
    document: string
  ): Promise<void>
  DeleteDocument(connectionId: string, database: string, collection: string, documentId: string): Promise<void>

  // Index methods
  ListIndexes(connectionId: string, database: string, collection: string): Promise<main.IndexInfo[]>
  CreateIndex?(
    connectionId: string,
    database: string,
    collection: string,
    keys: Record<string, number>,
    options: CreateIndexOptions
  ): Promise<void>
  DropIndex?(
    connectionId: string,
    database: string,
    collection: string,
    indexName: string
  ): Promise<void>

  // Validation
  ValidateJSON(json: string): Promise<void>

  // OS Authentication for password reveal
  AuthenticateForPasswordReveal(): Promise<void>
  IsAuthenticatedForPasswordReveal(): Promise<boolean>

  // Debug
  SetDebugEnabled?(enabled: boolean): void

  // Runtime build metadata
  GetVersionInfo?(): Promise<VersionInfo>

  // Collection profile (health check)
  GetCollectionProfile?(
    connectionId: string,
    database: string,
    collection: string
  ): Promise<CollectionProfile>

  // Collection stats
  GetCollectionStats?(
    connectionId: string,
    database: string,
    collection: string
  ): Promise<CollectionStats>

  // Schema methods (may be added via backend)
  InferCollectionSchema?(
    connectionId: string,
    database: string,
    collection: string,
    sampleSize: number
  ): Promise<SchemaResult>
  ExportSchemaAsJSON?(content: string, filename: string): Promise<void>

  // Export methods (may be added via backend)
  ExportCollectionAsCSV?(
    connectionId: string,
    database: string,
    collection: string,
    query: string,
    fields: string[],
    filePath: string
  ): Promise<void>
  CancelExport?(exportId: string): Promise<void>

  // Saved queries methods (may be added via backend)
  ListSavedQueries?(connectionId: string, database: string, collection: string): Promise<SavedQuery[]>
  SaveQuery?(query: SavedQueryInput): Promise<SavedQuery>
  DeleteSavedQuery?(queryId: string): Promise<void>
  UpdateSavedQuery?(query: SavedQueryInput): Promise<SavedQuery>

  // Favorites methods (may be added via backend)
  GetFavorites?(): Promise<string[]>
  AddFavorite?(connectionId: string, database: string, collection: string): Promise<void>
  RemoveFavorite?(connectionId: string, database: string, collection: string): Promise<void>
  IsFavorite?(path: string): Promise<boolean>
  ListFavorites?(): Promise<string[]>
  ListDatabaseFavorites?(): Promise<string[]>
  AddDatabaseFavorite?(connectionId: string, database: string): Promise<void>
  RemoveDatabaseFavorite?(connectionId: string, database: string): Promise<void>

  // Database tracking methods
  UpdateDatabaseAccessed?(connectionId: string, database: string): Promise<void>

  // Aggregation methods (may be added via backend)
  RunAggregation?(
    connectionId: string,
    database: string,
    collection: string,
    pipeline: string
  ): Promise<AggregationResult>
  ExplainAggregation?(
    connectionId: string,
    database: string,
    collection: string,
    pipeline: string
  ): Promise<ExplainResult>

  // Query explain methods
  ExplainQuery?(
    connectionId: string,
    database: string,
    collection: string,
    query: string
  ): Promise<ExplainResult>

  // Script execution methods (mongosh)
  ExecuteScriptWithDatabase?(
    connectionId: string,
    database: string,
    script: string
  ): Promise<ScriptExecutionResult>
  CheckMongoshAvailable?(): Promise<[boolean, string]>

  // JSON export methods
  ExportCollectionAsJSON?(
    connectionId: string,
    database: string,
    collection: string,
    defaultFilename: string,
    options: JSONExportOptions
  ): Promise<void>
  GetJSONSavePath?(defaultFilename: string): Promise<string | null>
  GetZipSavePath?(defaultFilename: string): Promise<string | null>
  GetBSONSavePath?(defaultFilename: string): Promise<string | null>

  // JSON import methods
  GetImportFilePath?(): Promise<string>
  DetectFileFormat?(filePath: string): Promise<string>
  PreviewJSONFile?(filePath: string): Promise<JSONImportPreview>
  ImportJSON?(
    connectionId: string,
    database: string,
    collection: string,
    options: JSONImportOptions
  ): Promise<ImportResult>
  DryRunImportJSON?(
    connectionId: string,
    database: string,
    collection: string,
    options: JSONImportOptions
  ): Promise<ImportResult>

  // CSV import methods
  PreviewCSVFile?(options: CSVImportPreviewOptions): Promise<CSVImportPreview>
  ImportCSV?(
    connectionId: string,
    database: string,
    collection: string,
    options: CSVImportOptions
  ): Promise<ImportResult>
  DryRunImportCSV?(
    connectionId: string,
    database: string,
    collection: string,
    options: CSVImportOptions
  ): Promise<ImportResult>

  // Selective database export (partial collection selection)
  ExportSelectiveDatabases?(connectionId: string, dbCollections: Record<string, string[]>, savePath: string): Promise<void>

  // Selective database import (partial collection selection)
  ImportSelectiveDatabases?(connectionId: string, dbCollections: Record<string, string[]>, mode: string, filePath: string): Promise<void>
  DryRunSelectiveImport?(connectionId: string, dbCollections: Record<string, string[]>, mode: string, filePath: string): Promise<void>

  // BSON (mongodump/mongorestore) methods
  CheckToolAvailability?(): Promise<ToolAvailability>
  ExportWithMongodump?(connectionId: string, options: MongodumpOptions): Promise<void>
  ImportWithMongorestore?(connectionId: string, options: MongorestoreOptions): Promise<ImportResult>
  GetBSONImportDirPath?(): Promise<string>
  ScanImportDir?(dirPath: string): Promise<ImportDirEntry[]>
  PreviewArchive?(connectionId: string, archivePath: string): Promise<ArchivePreview>

  // Document export methods
  ExportDocumentsAsZip?(
    entries: ExportEntry[],
    filename: string
  ): Promise<void>

  // Server info
  GetServerInfo?(connectionId: string): Promise<ServerInfo>

  // Theme methods
  GetThemes?(): Promise<Theme[]>
  GetCurrentTheme?(): Promise<Theme>
  SetTheme?(themeId: string): Promise<void>
  ReloadThemes?(): Promise<void>
  GetThemesDir?(): Promise<string>
  OpenThemesDir?(): Promise<void>
}

/**
 * Collection profile for pre-query health checks
 */
export interface CollectionProfile {
  avgDocSizeBytes: number
  docCount: number
  fieldCount: number
  totalFieldPaths: number
  maxNestingDepth: number
  topFields: string[]
}

export interface VersionInfo {
  version: string
  commit: string
  shortCommit: string
  isDirty: boolean
  isDev: boolean
  isRelease: boolean
}

/**
 * Collection statistics from collStats command
 */
export interface CollectionStats {
  namespace: string
  count: number
  size: number
  storageSize: number
  avgObjSize: number
  indexCount: number
  totalIndexSize: number
  capped: boolean
}

/**
 * Schema inference result
 */
export interface SchemaResult {
  fields: SchemaField[]
  documentCount: number
  sampleSize: number
}

export interface SchemaField {
  path: string
  types: TypeInfo[]
  frequency: number
  nullable: boolean
}

export interface TypeInfo {
  type: string
  count: number
  percentage: number
}

/**
 * Saved query types
 */
export interface SavedQuery {
  id: string
  name: string
  description?: string
  connectionId: string
  database: string
  collection: string
  query: string
  createdAt: string
  updatedAt: string
}

export interface SavedQueryInput {
  id?: string
  name: string
  description?: string
  connectionId: string
  database: string
  collection: string
  query: string
}

/**
 * Aggregation result types
 */
export interface AggregationResult {
  documents: string[]
  executionTimeMs: number
}

/**
 * Query/Aggregation explain result
 */
export interface ExplainResult {
  winningPlan: string
  indexUsed: string
  isCollectionScan: boolean
  rawExplain: string
  executionStats?: ExecutionStats
}

export interface ExecutionStats {
  executionTimeMs: number
  totalDocsExamined: number
  totalKeysExamined: number
  nReturned: number
}

/**
 * Index creation options
 */
export interface CreateIndexOptions {
  unique: boolean
  sparse: boolean
  background: boolean
  name: string
  expireAfterSeconds: number
}

/**
 * Script execution result from Go backend (mongosh)
 */
export interface ScriptExecutionResult {
  output: string
  exitCode: number
  error?: string
}

/**
 * Document entry for export
 */
export interface ExportEntry {
  database: string
  collection: string
  docId: string
  json: string
}

/**
 * Encrypted connection sharing result
 */
export interface ConnectionShareResult {
  bundle: string
  key: string
}

export interface BulkConnectionShareResult {
  version: number
  connections: Array<{ name: string; bundle: string }>
  key: string
}

/**
 * Theme color tokens (27 colors)
 */
export interface ThemeColors {
  background: string
  surface: string
  surfaceHover: string
  surfaceActive: string
  textDim: string
  textMuted: string
  textSecondary: string
  textLight: string
  text: string
  border: string
  borderLight: string
  borderHover: string
  primary: string
  primaryHover: string
  primaryMuted: string
  error: string
  errorDark: string
  warning: string
  warningDark: string
  success: string
  successDark: string
  info: string
  infoDark: string
  scrollbarTrack: string
  scrollbarThumb: string
  scrollbarThumbHover: string
}

/**
 * Theme font tokens
 */
export interface ThemeFonts {
  ui: string
  mono: string
}

/**
 * Complete theme definition
 */
export interface Theme {
  id: string
  name: string
  author?: string
  builtin: boolean
  colors: ThemeColors
  fonts?: ThemeFonts
}

/**
 * Server info diagnostics
 */
export interface ServerInfo {
  serverVersion: string
  gitVersion: string
  modules: string[]
  openSSLVersion: string
  topology: string
  maxBsonSize: number
  maxMsgSize: number
  maxWriteBatch: number
  readOnly: boolean
  fcv: string
  fcvError?: string
  host?: ServerHostInfo
  status?: ServerStatusInfo
  replicaSet?: ReplicaSetInfo
  rawServerStatus?: string
  rawReplStatus?: string
  errors?: Record<string, string>
}

export interface ServerHostInfo {
  hostname: string
  os: string
  arch: string
  cpus: number
  memoryMB: number
}

export interface ServerStatusInfo {
  uptime: number
  connsActive: number
  connsCurrent: number
  connsAvailable: number
  connsTotalCreated: number
  opsInsert: number
  opsQuery: number
  opsUpdate: number
  opsDelete: number
  opsGetmore: number
  opsCommand: number
  memResident: number
  memVirtual: number
  networkBytesIn: number
  networkBytesOut: number
  networkRequests: number
  storageEngine: string
}

export interface ReplicaSetInfo {
  name: string
  members: ReplicaSetMember[]
}

export interface ReplicaSetMember {
  id: number
  name: string
  stateStr: string
  health: number
  uptime: number
  optimeDate: string
  syncSource?: string
  self: boolean
}

/**
 * JSON export options
 */
export interface JSONExportOptions {
  filter?: string
  filePath?: string
  pretty?: boolean
  array?: boolean
}

/**
 * JSON import options
 */
export interface JSONImportOptions {
  filePath: string
  mode: 'skip' | 'override'
}

/**
 * JSON import preview
 */
export interface JSONImportPreview {
  filePath: string
  format: 'ndjson' | 'jsonarray'
  documentCount: number
  fileSize: number
  sampleDoc: string
}

/**
 * Import result (shared across import types)
 */
export interface ImportResult {
  databases: DatabaseImportResult[]
  documentsInserted: number
  documentsSkipped: number
  documentsFailed?: number
  documentsParseError?: number
  documentsDropped?: number
  errors: string[]
  cancelled?: boolean
}

export interface DatabaseImportResult {
  name: string
  collections: CollectionImportResult[]
  currentCount?: number
}

export interface CollectionImportResult {
  name: string
  documentsInserted: number
  documentsSkipped: number
  documentsParseError?: number
  currentCount?: number
  indexErrors?: string[]
}

/**
 * CSV import preview options
 */
export interface CSVImportPreviewOptions {
  filePath: string
  delimiter?: string
  maxRows?: number
}

/**
 * CSV import options
 */
export interface CSVImportOptions {
  filePath: string
  delimiter?: string
  hasHeaders: boolean
  fieldNames?: string[]
  typeInference: boolean
  mode: 'skip' | 'override'
}

/**
 * CSV import preview result
 */
export interface CSVImportPreview {
  filePath: string
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  fileSize: number
  delimiter: string
}

/**
 * BSON tool availability
 */
export interface ToolAvailability {
  mongodump: boolean
  mongodumpVersion?: string
  mongorestore: boolean
  mongorestoreVersion?: string
}

/**
 * Mongodump export options
 */
export interface MongodumpOptions {
  databases?: string[]
  database?: string
  collections?: string[]
  excludeCollections?: string[]
  databaseCollections?: Record<string, string[]>
  outputPath: string
}

/**
 * Mongorestore import options
 */
export interface MongorestoreOptions {
  inputPath: string
  database?: string
  collection?: string
  drop?: boolean
  dryRun?: boolean
  files?: string[]
  nsInclude?: string[]
}

/**
 * A file entry returned by ScanImportDir
 */
export interface ImportDirEntry {
  name: string
  size: number
}

/**
 * Archive preview from mongorestore --dryRun
 */
export interface ArchivePreview {
  databases: ArchivePreviewDatabase[]
}

export interface ArchivePreviewDatabase {
  name: string
  collections: ArchivePreviewCollection[]
}

export interface ArchivePreviewCollection {
  name: string
  documents: number
}

/**
 * Wails main module structure
 */
export interface WailsMainModule {
  App?: WailsAppBindings
}

/**
 * Wails Go bindings structure
 */
export interface WailsGoBindings {
  main?: WailsMainModule
}

/**
 * Extend the Window interface to include Wails bindings
 */
declare global {
  interface Window {
    go?: WailsGoBindings
  }
}

export {}
