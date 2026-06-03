import React, { useState, useEffect, ReactNode } from 'react'
import CSVExportDialog from '../CSVExportDialog'
import JSONExportDialog from '../JSONExportDialog'
import { TreeNode } from './TreeNode'
import { ServerIcon, DatabaseIcon, CollectionIcon, LockIcon } from './icons'
import { HighlightedText } from './icons'
import { useSidebarContext } from './SidebarContext'
import type {
  ConnectionNodeProps,
  ConnectionStatus,
  DbDataCache,
  ContextMenuItem,
} from './types'
import { go as goBindings } from './types'

export function ConnectionNode({
  connection,
  isConnected,
  isConnecting,
  databases,

  // Per-connection callbacks
  onEdit,
  onDelete,
  onDuplicate,
  onCopyURI,
  onRefresh,
  onShowServerInfo,

  // Drag
  onDragStart,
  onDragEnd,
  level = 0,

  // Search match info
  connectionNameMatched = false,
  matchingDatabases = [],
  matchingCollections = {},
}: ConnectionNodeProps): React.ReactElement {
  const ctx = useSidebarContext()
  const {
    searchQuery,
    selectedItem,
    favorites,
    databaseFavorites,
    onToggleFavorite,
    onToggleDatabaseFavorite,
    dbSortMode,
    focusedNodeId,
    onNodeFocus,
    expandedConnections,
    setExpandedConnections,
    expandedDatabases,
    setExpandedDatabases,
    onShowContextMenu,
    onConnect,
    onDisconnect,
    onDisconnectOthers,
    activeConnections,
    onSelectDatabase,
    onSelectCollection,
    onOpenCollection,
    onViewSchema,
    onShowStats,
    onManageIndexes,
    onDropDatabase,
    onDropCollection,
    onClearCollection,
    onExportDatabases,
    onImportDatabases,
    onExportCollections,
    onExportCollection,
    onImportCollections,
    onCollectionsLoaded,
    onDatabaseAccessed,
    onError,
  } = ctx

  const expanded = expandedConnections?.[connection.id] ?? false
  const setExpanded = (value: boolean | ((prev: boolean) => boolean)): void => {
    const newValue = typeof value === 'function' ? value(expanded) : value
    setExpandedConnections?.(prev => ({ ...prev, [connection.id]: newValue }))
  }

  const getDbExpanded = (dbName: string): boolean => expandedDatabases?.[`${connection.id}:${dbName}`] ?? false
  const setDbExpanded = (dbName: string, value: boolean | ((prev: boolean) => boolean)): void => {
    const key = `${connection.id}:${dbName}`
    const newValue = typeof value === 'function' ? value(getDbExpanded(dbName)) : value
    setExpandedDatabases?.(prev => ({ ...prev, [key]: newValue }))
  }

  const [dbData, setDbData] = useState<DbDataCache>({})
  const [_loading, setLoading] = useState(false)

  // Collection export dialog state (for context menu "Export" submenu)
  const [collectionExport, setCollectionExport] = useState<{ db: string; coll: string; format: 'csv' | 'json' } | null>(null)

  const removeCollection = (dbName: string, collName: string): void => {
    setDbData(prev => {
      const dbEntry = prev[dbName]
      if (!dbEntry?.collections) return prev
      return {
        ...prev,
        [dbName]: {
          ...dbEntry,
          collections: dbEntry.collections.filter(c => c.name !== collName)
        }
      }
    })
  }

  const removeDatabase = (dbName: string): void => {
    setDbExpanded(dbName, false)
    setDbData(prev => {
      const { [dbName]: _, ...rest } = prev
      return rest
    })
  }

  useEffect(() => {
    if (expanded && isConnected && databases.length === 0) {
      loadDatabases()
    }
  }, [expanded, isConnected])

  useEffect(() => {
    if (!isConnected && expanded) {
      setExpanded(false)
    }
  }, [isConnected])

  const loadDatabases = async (): Promise<void> => {
    if (!goBindings?.ListDatabases) return
    setLoading(true)
    try {
      await goBindings.ListDatabases(connection.id)
    } catch (err) {
      console.error('Failed to load databases:', err)
      onError?.(`Failed to load databases: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadCollections = async (dbName: string, forceRefresh = false): Promise<void> => {
    if (!goBindings?.ListCollections) return
    if (!forceRefresh && dbData[dbName]?.collections) return
    try {
      const collections = await goBindings.ListCollections(connection.id, dbName)
      setDbData(prev => ({
        ...prev,
        [dbName]: { ...prev[dbName], collections }
      }))
      onCollectionsLoaded?.(connection.id, dbName, collections)
    } catch (err) {
      console.error('Failed to load collections:', err)
      onError?.(`Failed to load collections: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const toggleDatabase = (dbName: string): void => {
    const wasExpanded = getDbExpanded(dbName)
    setDbExpanded(dbName, !wasExpanded)
    if (!wasExpanded) {
      loadCollections(dbName)
      goBindings?.UpdateDatabaseAccessed?.(connection.id, dbName).catch(() => {})
      onDatabaseAccessed?.(connection.id, dbName)
    }
  }

  useEffect(() => {
    if (!isConnected) return
    databases.forEach(db => {
      const isExpanded = getDbExpanded(db.name)
      const hasCollections = dbData[db.name]?.collections
      if (isExpanded && !hasCollections) {
        loadCollections(db.name)
      }
    })
  }, [expandedDatabases, isConnected, databases])

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const hasOtherConnections = activeConnections.length > 1

    const items: ContextMenuItem[] = isConnected
      ? [
          { label: 'Refresh', onClick: onRefresh },
          { label: 'Server Info...', onClick: onShowServerInfo },
          { type: 'separator' },
          { label: 'Export Databases...', onClick: () => onExportDatabases?.(connection.id, connection.name) },
          { label: 'Import...', onClick: () => onImportDatabases?.(connection.id, connection.name) },
          { type: 'separator' },
          { label: 'Copy Connection URI', onClick: onCopyURI },
          { label: 'Edit Connection...', onClick: onEdit },
          { label: 'Duplicate Connection', onClick: onDuplicate },
          { type: 'separator' },
          { label: 'Disconnect', onClick: () => onDisconnect(connection.id) },
          ...(hasOtherConnections ? [{ label: 'Disconnect Others', onClick: () => onDisconnectOthers(connection.id) }] : []),
          { type: 'separator' },
          { label: 'Delete Connection', onClick: onDelete, danger: true },
        ]
      : isConnecting
      ? [
          { label: 'Connecting...', disabled: true },
          { type: 'separator' },
          { label: 'Copy Connection URI', onClick: onCopyURI },
          { label: 'Edit Connection...', onClick: onEdit, disabled: true },
        ]
      : [
          { label: 'Connect', onClick: () => onConnect(connection.id) },
          { type: 'separator' },
          { label: 'Copy Connection URI', onClick: onCopyURI },
          { label: 'Edit Connection...', onClick: onEdit },
          { label: 'Duplicate Connection', onClick: onDuplicate },
          { type: 'separator' },
          { label: 'Delete Connection', onClick: onDelete, danger: true },
        ]
    onShowContextMenu(e.clientX, e.clientY, items)
  }

  const handleDatabaseContextMenu = (e: React.MouseEvent, dbName: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const isReadOnly = connection.readOnly
    const dbFavoriteKey = `db:${connection.id}:${dbName}`
    const isDbFavorite = databaseFavorites?.includes(dbFavoriteKey)
    const items: ContextMenuItem[] = [
      { label: 'Refresh Collections', onClick: () => {
        loadCollections(dbName, true)
      }},
      { type: 'separator' },
      isDbFavorite
        ? { label: 'Remove from Favorites', onClick: () => onToggleDatabaseFavorite?.(connection.id, dbName) }
        : { label: 'Add to Favorites', onClick: () => onToggleDatabaseFavorite?.(connection.id, dbName) },
      { type: 'separator' },
      { label: 'Export Collections...', onClick: () => onExportCollections?.(connection.id, connection.name, dbName) },
    ]
    if (!isReadOnly) {
      items.push(
        { label: 'Import...', onClick: () => onImportCollections?.(connection.id, connection.name, dbName) },
        { type: 'separator' },
        { label: 'Drop Database...', onClick: () => onDropDatabase(connection.id, dbName, removeDatabase), danger: true },
      )
    }
    onShowContextMenu(e.clientX, e.clientY, items)
  }

  const handleCollectionContextMenu = (e: React.MouseEvent, dbName: string, collName: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const isReadOnly = connection.readOnly
    const favoriteKey = `${connection.id}:${dbName}:${collName}`
    const isFavorite = favorites?.has(favoriteKey)
    const items: ContextMenuItem[] = [
      { label: 'Open Collection', onClick: () => onOpenCollection(connection.id, dbName, collName) },
      { label: 'View Schema...', onClick: () => onViewSchema(connection.id, dbName, collName) },
      { type: 'separator' },
      { label: 'Export', children: [
        { label: 'Export as CSV...', onClick: () => setCollectionExport({ db: dbName, coll: collName, format: 'csv' }) },
        { label: 'Export as JSON...', onClick: () => setCollectionExport({ db: dbName, coll: collName, format: 'json' }) },
        { type: 'separator' },
        { label: 'Export as ZIP...', onClick: () => onExportCollection?.(connection.id, connection.name, dbName, collName) },
      ]},
      { type: 'separator' },
      isFavorite
        ? { label: 'Remove from Favorites', onClick: () => onToggleFavorite?.(connection.id, dbName, collName) }
        : { label: 'Add to Favorites', onClick: () => onToggleFavorite?.(connection.id, dbName, collName) },
      { type: 'separator' },
      { label: 'Show Stats...', onClick: () => onShowStats?.(connection.id, dbName, collName) },
      { label: 'Manage Indexes...', onClick: () => onManageIndexes?.(connection.id, dbName, collName) },
    ]
    if (!isReadOnly) {
      items.push(
        { type: 'separator' },
        { label: 'Clear Collection...', onClick: () => onClearCollection(connection.id, dbName, collName), danger: true },
        { label: 'Drop Collection...', onClick: () => onDropCollection(connection.id, dbName, collName, removeCollection), danger: true },
      )
    }
    onShowContextMenu(e.clientX, e.clientY, items)
  }

  const getLabel = (): ReactNode => {
    const ReadOnlyBadge = connection.readOnly ? (
      <span className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-warning-dark text-warning border border-warning-dark" title="Read-only connection - write operations disabled">
        <LockIcon className="w-2.5 h-2.5" />
        <span>Read-Only</span>
      </span>
    ) : null
    const nameWithHighlight = searchQuery ? (
      <HighlightedText text={connection.name} searchQuery={searchQuery} />
    ) : connection.name
    if (isConnecting) return <>{nameWithHighlight}{ReadOnlyBadge} <span className="text-text-dim">[connecting...]</span></>
    if (isConnected) return <>{nameWithHighlight}{ReadOnlyBadge}</>
    return <>{nameWithHighlight}{ReadOnlyBadge}</>
  }

  const connectionStatus: ConnectionStatus = isConnecting ? 'connecting' : isConnected ? 'connected' : 'disconnected'

  const getStatusTooltip = (): string => {
    if (isConnecting) {
      return `Connecting to ${connection.name}... Please wait`
    }
    if (isConnected) {
      const dbCount = databases.length
      if (dbCount > 0) {
        return `Connected to ${connection.name} (${dbCount} database${dbCount !== 1 ? 's' : ''}) - Right-click for options`
      }
      return `Connected to ${connection.name} - Right-click for options`
    }
    return `Disconnected - Double-click to connect to ${connection.name}`
  }

  const connectionNodeId = `conn:${connection.id}`

  const handleRowDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData('application/x-mongopal-connection', connection.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart?.(connection.id)
  }

  const handleRowDragEnd = (): void => {
    onDragEnd?.()
  }

  return (
    <>
    <TreeNode
      label={getLabel()}
      icon={<ServerIcon />}
      color={connection.color}
      connectionStatus={connectionStatus}
      statusTooltip={getStatusTooltip()}
      level={level}
      expanded={expanded}
      onToggle={() => {
        if (!expanded && !isConnected && !isConnecting) {
          onConnect(connection.id)
        }
        setExpanded(!expanded)
      }}
      onDoubleClick={() => {
        if (!isConnected && !isConnecting) {
          onConnect(connection.id)
        }
        setExpanded(!expanded)
      }}
      onContextMenu={handleContextMenu}
      nodeId={connectionNodeId}
      isFocused={focusedNodeId === connectionNodeId}
      onFocus={() => onNodeFocus?.(connectionNodeId)}
      draggable={true}
      onDragStart={handleRowDragStart}
      onDragEnd={handleRowDragEnd}
    >
      {isConnected ? (
        databases
          .filter(db => {
            if (!searchQuery) return true
            if (connectionNameMatched) return true
            const dbMatchesSearch = matchingDatabases.includes(db.name)
            const hasMatchingCollections = (matchingCollections[db.name] || []).length > 0
            return dbMatchesSearch || hasMatchingCollections
          })
          .sort((a, b) => {
            const aKey = `db:${connection.id}:${a.name}`
            const bKey = `db:${connection.id}:${b.name}`
            const aIsFav = databaseFavorites?.includes(aKey)
            const bIsFav = databaseFavorites?.includes(bKey)

            if (aIsFav !== bIsFav) return aIsFav ? -1 : 1

            if (dbSortMode === 'lastAccessed') {
              const aAccessed = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0
              const bAccessed = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0
              if (aAccessed !== bAccessed) return bAccessed - aAccessed
            }
            return a.name.localeCompare(b.name)
          })
          .map((db, _dbIndex, _filteredDbs) => {
          const dbNodeId = `db:${connection.id}:${db.name}`
          const collections = dbData[db.name]?.collections || []
          const dbMatchesSearch = matchingDatabases.includes(db.name)
          const collectionsMatchingInDb = matchingCollections[db.name] || []

          const dbLabel = searchQuery ? (
            <HighlightedText text={db.name} searchQuery={searchQuery} />
          ) : db.name

          const filteredCollections = searchQuery && !connectionNameMatched && !dbMatchesSearch && collectionsMatchingInDb.length > 0
            ? collections.filter(c => collectionsMatchingInDb.includes(c.name))
            : collections

          const dbFavKey = `db:${connection.id}:${db.name}`
          const isDbFavorite = databaseFavorites?.includes(dbFavKey)

          return (
            <TreeNode
              key={db.name}
              label={dbLabel}
              icon={<DatabaseIcon />}
              color={connection.color}
              level={level + 1}
              expanded={getDbExpanded(db.name)}
              onToggle={() => toggleDatabase(db.name)}
              onDoubleClick={() => {
                onSelectDatabase(db.name)
                toggleDatabase(db.name)
              }}
              onContextMenu={(e) => handleDatabaseContextMenu(e, db.name)}
              nodeId={dbNodeId}
              isFocused={focusedNodeId === dbNodeId}
              onFocus={() => onNodeFocus?.(dbNodeId)}
              isFavorite={isDbFavorite}
              onToggleFavorite={() => onToggleDatabaseFavorite?.(connection.id, db.name)}
            >
              {[...filteredCollections].sort((a, b) => {
                const aKey = `${connection.id}:${db.name}:${a.name}`
                const bKey = `${connection.id}:${db.name}:${b.name}`
                const aFav = favorites?.has(aKey) ? 1 : 0
                const bFav = favorites?.has(bKey) ? 1 : 0
                if (aFav !== bFav) return bFav - aFav
                return a.name.localeCompare(b.name)
              }).map((coll, _collIndex) => {
                const itemKey = `${connection.id}:${db.name}:${coll.name}`
                const collNodeId = `coll:${connection.id}:${db.name}:${coll.name}`
                const isFavorite = favorites?.has(itemKey)

                const collLabel = searchQuery ? (
                  <HighlightedText text={coll.name} searchQuery={searchQuery} />
                ) : coll.name

                return (
                  <TreeNode
                    key={coll.name}
                    label={collLabel}
                    icon={<CollectionIcon />}
                    color={connection.color}
                    count={coll.count}
                    level={level + 2}
                    selected={selectedItem === itemKey}
                    onClick={() => onSelectCollection(connection.id, db.name, coll.name)}
                    onDoubleClick={() => onOpenCollection(connection.id, db.name, coll.name)}
                    onContextMenu={(e) => handleCollectionContextMenu(e, db.name, coll.name)}
                    nodeId={collNodeId}
                    isFocused={focusedNodeId === collNodeId}
                    onFocus={() => onNodeFocus?.(collNodeId)}
                    isFavorite={isFavorite}
                    onToggleFavorite={() => onToggleFavorite?.(connection.id, db.name, coll.name)}
                  />
                )
              })}
            </TreeNode>
          )
        })
      ) : null}
    </TreeNode>

    {/* Collection export dialogs triggered by context menu */}
    {collectionExport?.format === 'csv' && (
      <CSVExportDialog
        open
        connectionId={connection.id}
        database={collectionExport.db}
        collection={collectionExport.coll}
        onClose={() => setCollectionExport(null)}
      />
    )}
    {collectionExport?.format === 'json' && (
      <JSONExportDialog
        open
        connectionId={connection.id}
        database={collectionExport.db}
        collection={collectionExport.coll}
        onClose={() => setCollectionExport(null)}
      />
    )}
    </>
  )
}
