import type { ReactNode } from 'react'
import type { SavedConnection, Folder } from '../contexts/ConnectionContext'

// =============================================================================
// Go Bindings
// =============================================================================

/**
 * Database info with access tracking
 */
export interface DatabaseInfoWithAccess {
  name: string
  sizeOnDisk?: number
  empty?: boolean
  lastAccessedAt?: string
}

/**
 * Collection info from backend
 */
export interface CollectionInfo {
  name: string
  type?: string
  count: number
}

/**
 * Go App bindings accessible via window.go.main.App (component-specific)
 */
export interface SidebarGoBindings {
  ListDatabases?: (connId: string) => Promise<DatabaseInfoWithAccess[]>
  ListCollections?: (connId: string, dbName: string) => Promise<CollectionInfo[]>
  ListFavorites?: () => Promise<string[]>
  ListDatabaseFavorites?: () => Promise<string[]>
  AddFavorite?: (connId: string, dbName: string, collName: string) => Promise<void>
  RemoveFavorite?: (connId: string, dbName: string, collName: string) => Promise<void>
  AddDatabaseFavorite?: (connId: string, dbName: string) => Promise<void>
  RemoveDatabaseFavorite?: (connId: string, dbName: string) => Promise<void>
  UpdateDatabaseAccessed?: (connId: string, dbName: string) => Promise<void>
  UpdateFolder?: (folderId: string, name: string, parentId: string) => Promise<void>
}

export const go: SidebarGoBindings | undefined = window.go?.main?.App as SidebarGoBindings | undefined

// =============================================================================
// Data Types
// =============================================================================

/**
 * Database sort mode
 */
export type DbSortMode = 'alpha' | 'lastAccessed'

/**
 * Connection status
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

/**
 * Extended SavedConnection with readOnly and lastAccessedAt
 */
export interface ExtendedSavedConnection extends SavedConnection {
  readOnly?: boolean
  lastAccessedAt?: string
}

// =============================================================================
// Keyboard Navigation
// =============================================================================

/**
 * Visible node for keyboard navigation
 */
export interface VisibleNode {
  id: string
  type: 'folder' | 'connection' | 'database' | 'collection'
  folderId?: string
  folderName?: string
  connectionId?: string
  connectionName?: string
  databaseName?: string
  collectionName?: string
  hasChildren: boolean
  expanded: boolean
  parentId: string | null
  isConnected?: boolean
}

/**
 * Node action for keyboard navigation
 */
export type NodeAction = 'expand' | 'collapse' | 'activate'

export type SelectableNodeType = 'connection' | 'database' | 'collection'

export interface SidebarSelectionItem {
  id: string
  type: SelectableNodeType
  connectionId: string
  connectionName?: string
  databaseName?: string
  collectionName?: string
  readOnly?: boolean
}

// =============================================================================
// Context Menu
// =============================================================================

/**
 * Context menu item
 */
export interface ContextMenuItem {
  type?: 'separator'
  label?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  children?: ContextMenuItem[]
}

/**
 * Context menu state
 */
export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

// =============================================================================
// Confirm Dialog
// =============================================================================

/**
 * Confirm dialog state
 */
export interface ConfirmDialogState {
  title: string
  message: string
  confirmText: string
  confirmStyle: 'danger' | 'primary'
  onConfirm: () => Promise<void>
}

// =============================================================================
// Search
// =============================================================================

/**
 * Search results structure
 */
export interface SearchResults {
  filteredConnections: ExtendedSavedConnection[]
  matchInfo: Record<string, ConnectionMatchInfo>
  autoExpandConnections: Record<string, boolean>
  autoExpandDatabases: Record<string, boolean>
}

/**
 * Connection match info for search
 */
export interface ConnectionMatchInfo {
  matchedConnection: boolean
  matchedDatabases: string[]
  matchedCollections: Record<string, string[]>
}

// =============================================================================
// Folder Helpers
// =============================================================================

/**
 * Folder helpers interface
 */
export interface FolderHelpers {
  rootFolders: Folder[]
  getChildFolders: (parentId: string) => Folder[]
  getDescendantIds: (folderId: string, visited?: Set<string>) => string[]
  getFolderDepth: (folderId: string, depth?: number) => number
}

// =============================================================================
// Icon Props
// =============================================================================

export interface IconProps {
  className?: string
}

export interface StarIconProps extends IconProps {
  filled?: boolean
}

// =============================================================================
// Component Props
// =============================================================================

export interface TreeNodeProps {
  label: ReactNode
  icon: ReactNode
  count?: number
  expanded?: boolean
  onToggle?: () => void
  selected?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  children?: ReactNode
  level?: number
  color?: string
  connectionStatus?: ConnectionStatus
  statusTooltip?: string
  isFavorite?: boolean
  onToggleFavorite?: () => void
  nodeId?: string
  isFocused?: boolean
  onFocus?: () => void
  setSize?: number
  posInSet?: number
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDropTarget?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDragOver?: boolean
  dropIndicator?: 'above' | 'below' | null
  searchQuery?: string
  highlightLabel?: boolean
}

export interface FolderNodeProps {
  folder: Folder
  level?: number
  childFolders: Folder[]
  folderConnections: ExtendedSavedConnection[]
  expanded: boolean
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  focusedNodeId: string | null
  onNodeFocus: (nodeId: string) => void
  setSize?: number
  posInSet?: number
  onDragStart?: (folderId: string) => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  isDragOver?: boolean
  renderFolderNode: (folder: Folder, index: number, siblings: number, level: number) => ReactNode
  renderConnectionNode: (conn: ExtendedSavedConnection, index: number, totalConnections: number, level: number) => ReactNode
}

/**
 * Sidebar context - shared callbacks to reduce prop drilling in ConnectionNode
 */
export interface SidebarContextValue {
  // Search
  searchQuery: string

  // Selection
  selectedItems: SidebarSelectionItem[]
  selectedItemIds: Set<string>
  onSelectItem: (item: SidebarSelectionItem, event: React.MouseEvent) => void
  getContextSelection: (item: SidebarSelectionItem) => SidebarSelectionItem[]

  // Favorites
  favorites: Set<string>
  databaseFavorites: string[]
  onToggleFavorite: (connId: string, dbName: string, collName: string) => void
  onToggleDatabaseFavorite: (connId: string, dbName: string) => void

  // Database sort
  dbSortMode: DbSortMode

  // Focus
  focusedNodeId: string | null
  onNodeFocus: (nodeId: string) => void

  // Expansion state
  expandedConnections: Record<string, boolean>
  setExpandedConnections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  expandedDatabases: Record<string, boolean>
  setExpandedDatabases: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  collectionsMap: Record<string, CollectionInfo[]>

  // Context menu
  onShowContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void

  // Connection operations
  onConnect: (connId: string) => void
  onDisconnect: (connId: string) => void
  onDisconnectOthers: (connId: string) => void
  activeConnections: string[]
  onConnectConnections: (items: SidebarSelectionItem[]) => void
  onDisconnectConnections: (items: SidebarSelectionItem[]) => void
  onRefreshConnections: (items: SidebarSelectionItem[]) => void
  onDeleteConnections: (items: SidebarSelectionItem[]) => void

  // Navigation
  onSelectDatabase: (dbName: string) => void
  onSelectCollection: (connId: string, dbName: string, collName: string) => void
  onOpenCollection: (connId: string, dbName: string, collName: string) => void

  // Schema / stats
  onViewSchema: (connId: string, dbName: string, collName: string) => void
  onShowStats?: (connId: string, dbName: string, collName: string) => void
  onManageIndexes?: (connId: string, dbName: string, collName: string) => void

  // Drop operations
  onDropDatabase: (connId: string, dbName: string, removeFromState: (dbName: string) => void) => void
  onDropCollection: (connId: string, dbName: string, collName: string, removeFromState: (dbName: string, collName: string) => void) => void
  onClearCollection: (connId: string, dbName: string, collName: string) => void
  onDropDatabases: (items: SidebarSelectionItem[]) => void
  onDropCollections: (items: SidebarSelectionItem[]) => void
  onClearCollections: (items: SidebarSelectionItem[]) => void

  // Export/Import (connId/connName provided by ConnectionNode)
  onExportDatabases?: (connId: string, connName: string) => void
  onImportDatabases?: (connId: string, connName: string) => void
  onExportCollections?: (connId: string, connName: string, dbName: string) => void
  onExportCollection?: (connId: string, connName: string, dbName: string, collName: string) => void
  onImportCollections?: (connId: string, connName: string, dbName: string) => void

  // Callbacks
  onCollectionsLoaded?: (connId: string, dbName: string, collections: CollectionInfo[]) => void
  onDatabaseAccessed?: (connId: string, dbName: string) => void
  onError?: (msg: string) => void
}

export interface ConnectionNodeProps {
  connection: ExtendedSavedConnection
  isConnected: boolean
  isConnecting: boolean
  databases: DatabaseInfoWithAccess[]

  // Per-connection callbacks
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onCopyURI: () => void
  onRefresh: () => void
  onShowServerInfo?: () => void

  // Drag
  onDragStart?: (connId: string) => void
  onDragEnd?: () => void
  level?: number

  // Search match info
  connectionNameMatched?: boolean
  matchingDatabases?: string[]
  matchingCollections?: Record<string, string[]>
}

export interface SidebarProps {
  onManageConnections: () => void
  onEditConnection: (conn: SavedConnection) => void
  onDeleteConnection: (connId: string) => void
  onExportDatabases?: (connId: string, connName: string) => void
  onImportDatabases?: (connId: string, connName: string) => void
  onExportCollections?: (connId: string, connName: string, dbName: string) => void
  onExportCollection?: (connId: string, connName: string, dbName: string, collName: string) => void
  onImportCollections?: (connId: string, connName: string, dbName: string) => void
  onShowStats?: (connId: string, dbName: string, collName: string) => void
  onManageIndexes?: (connId: string, dbName: string, collName: string) => void
  onShowServerInfo?: (connId: string, connName: string) => void
}
