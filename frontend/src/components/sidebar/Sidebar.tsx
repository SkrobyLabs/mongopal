import React, { useState, useEffect, useRef, useCallback, useMemo, RefObject, ReactNode } from 'react'
import { useNotification } from '../NotificationContext'
import { useConnection, SavedConnection, Folder } from '../contexts/ConnectionContext'
import { useTab } from '../contexts/TabContext'
import ConfirmDialog from '../ConfirmDialog'
import { getErrorSummary } from '../../utils/errorParser'

import type {
  SidebarProps,
  DatabaseInfoWithAccess,
  CollectionInfo,
  ContextMenuItem,
  ContextMenuState,
  ConfirmDialogState,
  SearchResults,
  ConnectionMatchInfo,
  ExtendedSavedConnection,
  FolderHelpers,
  VisibleNode,
  NodeAction,
  DbSortMode,
  SidebarContextValue,
} from './types'
import { go } from './types'
import { SidebarProvider } from './SidebarContext'
import { ContextMenu } from './ContextMenu'
import { ConnectionNode } from './ConnectionNode'
import { FolderNode } from './FolderNode'
import { useTreeKeyboardNavigation } from './useTreeKeyboardNavigation'
import {
  ServerIcon,
  FolderIcon,
  SearchIcon,
  ClearIcon,
  DisconnectIcon,
  SortAlphaIcon,
  SortClockIcon,
  PlusIcon,
} from './icons'

export default function Sidebar({
  onManageConnections,
  onEditConnection,
  onDeleteConnection,
  onExportDatabases,
  onImportDatabases,
  onExportCollections,
  onExportCollection,
  onImportCollections,
  onShowStats,
  onManageIndexes,
  onShowServerInfo,
}: SidebarProps): React.ReactElement {
  const { notify } = useNotification()
  const {
    connections,
    folders,
    activeConnections,
    isConnecting,
    connect,
    disconnect,
    disconnectAll,
    disconnectOthers,
    setSelectedConnection,
    setSelectedDatabase,
    setSelectedCollection,
    duplicateConnection,
    refreshConnection,
    dropDatabase,
    dropCollection,
    clearCollection,
    createFolder,
    deleteFolder,
    moveConnectionToFolder,
    moveFolderToFolder,
    loadConnections,
  } = useConnection()

  const {
    openTab,
    openSchemaTab,
    closeTabsForConnection,
    closeTabsForDatabase,
    closeTabsForCollection,
    closeAllTabs,
    keepOnlyConnectionTabs,
  } = useTab()

  const [searchQuery, setSearchQuery] = useState('')
  const [databases, setDatabases] = useState<Record<string, DatabaseInfoWithAccess[]>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderValue, setRenameFolderValue] = useState('')
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [isDisconnectingAll, setIsDisconnectingAll] = useState(false)
  const [draggingConnectionId, setDraggingConnectionId] = useState<string | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const draggingFolderIdRef = useRef<string | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [newSubfolderParentId, setNewSubfolderParentId] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [databaseFavorites, setDatabaseFavorites] = useState<string[]>([])
  const [dbSortMode, setDbSortMode] = useState<DbSortMode>(() => {
    try {
      return (localStorage.getItem('mongopal-db-sort-mode') as DbSortMode) || 'alpha'
    } catch {
      return 'alpha'
    }
  })

  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({})
  const [expandedDatabases, setExpandedDatabases] = useState<Record<string, boolean>>({})
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const lastAccessedDbNodeRef = useRef<string | null>(null)

  const [collectionsMap, setCollectionsMap] = useState<Record<string, CollectionInfo[]>>({})

  const folderHelpers = useMemo((): FolderHelpers => {
    const sortFolders = (folderList: Folder[]): Folder[] =>
      [...folderList].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    const rootFolders = sortFolders(folders.filter(f => !f.parentId))

    const getChildFolders = (parentId: string): Folder[] => sortFolders(folders.filter(f => f.parentId === parentId))

    const getDescendantIds = (folderId: string, visited = new Set<string>()): string[] => {
      if (visited.has(folderId)) return []
      visited.add(folderId)
      const children = getChildFolders(folderId)
      let descendants = children.map(c => c.id)
      children.forEach(child => {
        descendants = [...descendants, ...getDescendantIds(child.id, visited)]
      })
      return descendants
    }

    const getFolderDepth = (folderId: string, depth = 0): number => {
      const folder = folders.find(f => f.id === folderId)
      if (!folder || !folder.parentId) return depth
      return getFolderDepth(folder.parentId, depth + 1)
    }

    return { rootFolders, getChildFolders, getDescendantIds, getFolderDepth }
  }, [folders])

  useEffect(() => {
    activeConnections.forEach(connId => {
      if (!databases[connId] && go?.ListDatabases) {
        go.ListDatabases(connId).then(dbs => {
          setDatabases(prev => ({ ...prev, [connId]: dbs }))
        }).catch(console.error)
      }
    })
  }, [activeConnections])

  useEffect(() => {
    if (go?.ListFavorites) {
      go.ListFavorites().then(keys => {
        setFavorites(new Set(keys || []))
      }).catch(err => {
        console.error('Failed to load favorites:', err)
      })
    }
    if (go?.ListDatabaseFavorites) {
      go.ListDatabaseFavorites().then(keys => {
        setDatabaseFavorites(keys || [])
      }).catch(err => {
        console.error('Failed to load database favorites:', err)
      })
    }
  }, [])

  const handleToggleFavorite = useCallback(async (connId: string, dbName: string, collName: string): Promise<void> => {
    const key = `${connId}:${dbName}:${collName}`
    const isFavorite = favorites.has(key)
    try {
      if (isFavorite) {
        await go?.RemoveFavorite?.(connId, dbName, collName)
        setFavorites(prev => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
        notify.success(`Removed "${collName}" from favorites`)
      } else {
        await go?.AddFavorite?.(connId, dbName, collName)
        setFavorites(prev => new Set([...prev, key]))
        notify.success(`Added "${collName}" to favorites`)
      }
    } catch (err) {
      notify.error(`Failed to update favorites: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [favorites, notify])

  const handleToggleDatabaseFavorite = useCallback(async (connId: string, dbName: string): Promise<void> => {
    const key = `db:${connId}:${dbName}`
    const isFavorite = databaseFavorites.includes(key)
    try {
      if (isFavorite) {
        await go?.RemoveDatabaseFavorite?.(connId, dbName)
        setDatabaseFavorites(prev => prev.filter(k => k !== key))
        notify.success(`Removed "${dbName}" from favorites`)
      } else {
        await go?.AddDatabaseFavorite?.(connId, dbName)
        setDatabaseFavorites(prev => [...prev, key])
        notify.success(`Added "${dbName}" to favorites`)
      }
    } catch (err) {
      notify.error(`Failed to update database favorites: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [databaseFavorites, notify])

  const toggleDbSortMode = (): void => {
    const newMode: DbSortMode = dbSortMode === 'alpha' ? 'lastAccessed' : 'alpha'
    setDbSortMode(newMode)
    try {
      localStorage.setItem('mongopal-db-sort-mode', newMode)
    } catch {
      // Ignore localStorage errors
    }
  }

  const searchResults = useMemo((): SearchResults => {
    const query = searchQuery.toLowerCase().trim()

    if (!query) {
      return {
        filteredConnections: connections as ExtendedSavedConnection[],
        matchInfo: {},
        autoExpandConnections: {},
        autoExpandDatabases: {},
      }
    }

    const filteredConnections: ExtendedSavedConnection[] = []
    const matchInfo: Record<string, ConnectionMatchInfo> = {}
    const autoExpandConnections: Record<string, boolean> = {}
    const autoExpandDatabases: Record<string, boolean> = {}

    connections.forEach(conn => {
      const connNameMatches = conn.name.toLowerCase().includes(query)
      const connDatabases = databases[conn.id] || []

      const matchedDatabases: string[] = []
      const matchedCollections: Record<string, string[]> = {}

      connDatabases.forEach(db => {
        const dbNameMatches = db.name.toLowerCase().includes(query)
        const dbCollections = collectionsMap[`${conn.id}:${db.name}`] || []

        const matchedCollsInDb = dbCollections
          .filter(coll => coll.name.toLowerCase().includes(query))
          .map(coll => coll.name)

        if (dbNameMatches) {
          matchedDatabases.push(db.name)
        }

        if (matchedCollsInDb.length > 0) {
          matchedCollections[db.name] = matchedCollsInDb
          autoExpandDatabases[`${conn.id}:${db.name}`] = true
        }
      })

      const hasMatchingDb = matchedDatabases.length > 0
      const hasMatchingColl = Object.keys(matchedCollections).length > 0

      if (connNameMatches || hasMatchingDb || hasMatchingColl) {
        filteredConnections.push(conn as ExtendedSavedConnection)

        matchInfo[conn.id] = {
          matchedConnection: connNameMatches,
          matchedDatabases,
          matchedCollections,
        }

        if ((hasMatchingDb || hasMatchingColl) && !connNameMatches) {
          autoExpandConnections[conn.id] = true
        }
      }
    })

    return {
      filteredConnections,
      matchInfo,
      autoExpandConnections,
      autoExpandDatabases,
    }
  }, [searchQuery, connections, databases, collectionsMap])

  const { filteredConnections, matchInfo, autoExpandConnections, autoExpandDatabases } = searchResults

  useEffect(() => {
    if (!searchQuery.trim()) return

    Object.keys(autoExpandConnections).forEach(connId => {
      if (autoExpandConnections[connId] && !expandedConnections[connId]) {
        setExpandedConnections(prev => ({ ...prev, [connId]: true }))
      }
    })

    Object.keys(autoExpandDatabases).forEach(key => {
      if (autoExpandDatabases[key] && !expandedDatabases[key]) {
        setExpandedDatabases(prev => ({ ...prev, [key]: true }))
      }
    })
  }, [searchQuery, autoExpandConnections, autoExpandDatabases])

  const sortConnections = (connList: ExtendedSavedConnection[]): ExtendedSavedConnection[] =>
    [...connList].sort((a, b) => {
      const aTime = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0
      const bTime = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0
      if (aTime !== bTime) return bTime - aTime
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

  const rootConnections = sortConnections(filteredConnections.filter(c => !c.folderId))
  const connectionsByFolder = useMemo(() => {
    const byFolder: Record<string, ExtendedSavedConnection[]> = {}
    filteredConnections.forEach(conn => {
      if (conn.folderId) {
        if (!byFolder[conn.folderId]) {
          byFolder[conn.folderId] = []
        }
        byFolder[conn.folderId].push(conn)
      }
    })
    Object.keys(byFolder).forEach(folderId => {
      byFolder[folderId] = sortConnections(byFolder[folderId])
    })
    return byFolder
  }, [filteredConnections])

  const visibleNodes = useMemo((): VisibleNode[] => {
    const nodes: VisibleNode[] = []

    const getChildFolders = (parentId: string): Folder[] =>
      folders.filter(f => f.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    const addFolder = (folder: Folder, _index: number, _totalSiblings: number, parentNodeId: string | null = null): void => {
      const folderNodeId = `folder:${folder.id}`
      const isExpanded = expandedFolders[folder.id]
      const folderConnections = connectionsByFolder[folder.id] || []
      const childFolders = getChildFolders(folder.id)
      const hasChildren = folderConnections.length > 0 || childFolders.length > 0

      nodes.push({
        id: folderNodeId,
        type: 'folder',
        folderId: folder.id,
        folderName: folder.name,
        hasChildren,
        expanded: isExpanded ?? false,
        parentId: parentNodeId,
      })

      if (isExpanded) {
        childFolders.forEach((childFolder, childIndex) => {
          addFolder(childFolder, childIndex, childFolders.length + folderConnections.length, folderNodeId)
        })
        folderConnections.forEach((conn, connIndex) => {
          addConnection(conn, childFolders.length + connIndex, childFolders.length + folderConnections.length, folderNodeId)
        })
      }
    }

    const addConnection = (conn: ExtendedSavedConnection, _index: number, _totalConnections: number, parentId: string | null = null): void => {
      const connNodeId = `conn:${conn.id}`
      const isConnected = activeConnections.includes(conn.id)
      const connDatabases = databases[conn.id] || []
      const isExpanded = expandedConnections[conn.id]

      nodes.push({
        id: connNodeId,
        type: 'connection',
        connectionId: conn.id,
        connectionName: conn.name,
        hasChildren: isConnected && connDatabases.length > 0,
        expanded: isExpanded ?? false,
        parentId,
        isConnected,
      })

      if (isExpanded && isConnected) {
        // Sort databases the same way as visual display for consistent keyboard navigation
        const sortedDatabases = [...connDatabases].sort((a, b) => {
          const aKey = `db:${conn.id}:${a.name}`
          const bKey = `db:${conn.id}:${b.name}`
          const aIsFav = databaseFavorites?.includes(aKey)
          const bIsFav = databaseFavorites?.includes(bKey)

          // Favorites first
          if (aIsFav !== bIsFav) return aIsFav ? -1 : 1

          // Then by sort mode
          if (dbSortMode === 'lastAccessed') {
            const aAccessed = a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0
            const bAccessed = b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0
            if (aAccessed !== bAccessed) return bAccessed - aAccessed
          }
          return a.name.localeCompare(b.name)
        })

        sortedDatabases.forEach((db, dbIndex) => {
          addDatabase(conn.id, db, dbIndex, sortedDatabases.length, connNodeId)
        })
      }
    }

    const addDatabase = (connId: string, db: DatabaseInfoWithAccess, _index: number, _totalDbs: number, parentId: string): void => {
      const dbNodeId = `db:${connId}:${db.name}`
      const dbExpandKey = `${connId}:${db.name}`
      const isExpanded = expandedDatabases[dbExpandKey]
      const collections = collectionsMap[dbExpandKey] || []
      const hasCollections = collections.length > 0

      nodes.push({
        id: dbNodeId,
        type: 'database',
        connectionId: connId,
        databaseName: db.name,
        hasChildren: hasCollections || true,
        expanded: isExpanded ?? false,
        parentId,
      })

      if (isExpanded && collections.length > 0) {
        collections.forEach((coll) => {
          const collNodeId = `coll:${connId}:${db.name}:${coll.name}`
          nodes.push({
            id: collNodeId,
            type: 'collection',
            connectionId: connId,
            databaseName: db.name,
            collectionName: coll.name,
            hasChildren: false,
            expanded: false,
            parentId: dbNodeId,
          })
        })
      }
    }

    const rootFolders = folders.filter(f => !f.parentId)
    rootFolders.forEach((folder, idx) => addFolder(folder, idx, rootFolders.length + rootConnections.length))

    rootConnections.forEach((conn, idx) => addConnection(conn, rootFolders.length + idx, rootFolders.length + rootConnections.length))

    return nodes
  }, [
    folders,
    rootConnections,
    connectionsByFolder,
    activeConnections,
    databases,
    expandedFolders,
    expandedConnections,
    expandedDatabases,
    collectionsMap,
    dbSortMode,
    databaseFavorites,
  ])

  // Scroll last accessed database into view after reordering
  useEffect(() => {
    if (lastAccessedDbNodeRef.current && dbSortMode === 'lastAccessed') {
      const nodeId = lastAccessedDbNodeRef.current
      // Wait for DOM to update after reordering
      requestAnimationFrame(() => {
        const element = treeRef.current?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
        lastAccessedDbNodeRef.current = null
      })
    }
  }, [visibleNodes, dbSortMode])

  const handleNodeAction = useCallback((node: VisibleNode, action: NodeAction): void => {
    if (!node) return

    switch (action) {
      case 'expand':
        if (node.type === 'folder' && node.folderId) {
          setExpandedFolders(prev => ({ ...prev, [node.folderId!]: true }))
        } else if (node.type === 'connection' && node.connectionId) {
          setExpandedConnections(prev => ({ ...prev, [node.connectionId!]: true }))
          if (!node.isConnected) {
            connect(node.connectionId)
          }
        } else if (node.type === 'database' && node.connectionId && node.databaseName) {
          setExpandedDatabases(prev => ({ ...prev, [`${node.connectionId}:${node.databaseName}`]: true }))
        }
        break

      case 'collapse':
        if (node.type === 'folder' && node.folderId) {
          setExpandedFolders(prev => ({ ...prev, [node.folderId!]: false }))
        } else if (node.type === 'connection' && node.connectionId) {
          setExpandedConnections(prev => ({ ...prev, [node.connectionId!]: false }))
        } else if (node.type === 'database' && node.connectionId && node.databaseName) {
          setExpandedDatabases(prev => ({ ...prev, [`${node.connectionId}:${node.databaseName}`]: false }))
        }
        break

      case 'activate':
        if (node.type === 'folder' && node.folderId) {
          setExpandedFolders(prev => ({ ...prev, [node.folderId!]: !prev[node.folderId!] }))
        } else if (node.type === 'connection' && node.connectionId) {
          if (!node.isConnected) {
            connect(node.connectionId)
          }
          setExpandedConnections(prev => ({ ...prev, [node.connectionId!]: !prev[node.connectionId!] }))
        } else if (node.type === 'database' && node.connectionId && node.databaseName) {
          setExpandedDatabases(prev => ({ ...prev, [`${node.connectionId}:${node.databaseName}`]: !prev[`${node.connectionId}:${node.databaseName}`] }))
        } else if (node.type === 'collection' && node.connectionId && node.databaseName && node.collectionName) {
          openTab(node.connectionId, node.databaseName, node.collectionName)
        }
        break
    }
  }, [connect, openTab])

  const { handleKeyDown: handleTreeKeyDown } = useTreeKeyboardNavigation(
    treeRef as RefObject<HTMLDivElement>,
    visibleNodes,
    handleNodeAction,
    focusedNodeId,
    setFocusedNodeId
  )

  const toggleFolder = (folderId: string): void => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }))
  }

  const handleCreateFolder = async (parentId = ''): Promise<void> => {
    if (!newFolderName.trim()) return
    try {
      await createFolder(newFolderName.trim(), parentId)
      setNewFolderName('')
      setShowNewFolderInput(false)
      setNewSubfolderParentId(null)
      notify.success('Folder created')
      if (parentId) {
        setExpandedFolders(prev => ({ ...prev, [parentId]: true }))
      }
    } catch (err) {
      notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
    }
  }

  const handleDeleteFolder = async (folderId: string): Promise<void> => {
    try {
      await deleteFolder(folderId)
      notify.success('Folder deleted')
    } catch (err) {
      notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
    }
  }

  const handleRenameFolder = async (folderId: string, newName: string): Promise<void> => {
    if (!newName.trim()) return
    try {
      const folder = folders.find(f => f.id === folderId)
      if (go?.UpdateFolder) {
        await go.UpdateFolder(folderId, newName.trim(), folder?.parentId || '')
        await loadConnections()
        notify.success('Folder renamed')
      }
    } catch (err) {
      notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
    } finally {
      setRenamingFolderId(null)
      setRenameFolderValue('')
    }
  }

  const handleConnectionDragStart = (connId: string): void => {
    setDraggingConnectionId(connId)
  }

  const handleConnectionDragEnd = (): void => {
    setDraggingConnectionId(null)
    setDragOverFolderId(null)
  }

  const handleFolderDragStart = (folderId: string): void => {
    draggingFolderIdRef.current = folderId
    setDraggingFolderId(folderId)
  }

  const handleFolderDragEnd = (): void => {
    draggingFolderIdRef.current = null
    setDraggingFolderId(null)
    setDragOverFolderId(null)
  }

  const handleFolderDragOver = (e: React.DragEvent, folderId: string | null): void => {
    e.preventDefault()
    e.stopPropagation()

    if (draggingFolderIdRef.current === folderId) {
      e.dataTransfer.dropEffect = 'none'
      return
    }

    if (draggingConnectionId || draggingFolderIdRef.current) {
      if (draggingFolderIdRef.current && folderId) {
        const descendants = folderHelpers.getDescendantIds(draggingFolderIdRef.current)
        if (descendants.includes(folderId)) {
          e.dataTransfer.dropEffect = 'none'
          return
        }
      }
      e.dataTransfer.dropEffect = 'move'
      setDragOverFolderId(folderId || 'root')
    }
  }

  const handleFolderDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    const relatedTarget = e.relatedTarget as Node | null
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverFolderId(null)
    }
  }

  const handleFolderDrop = async (e: React.DragEvent, targetFolderId: string | null): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()

    const connId = e.dataTransfer.getData('application/x-mongopal-connection')
    if (connId && connId !== '') {
      const conn = connections.find(c => c.id === connId)
      const targetId = targetFolderId || ''
      const currentFolderId = conn?.folderId || ''
      if (conn && currentFolderId !== targetId) {
        try {
          await moveConnectionToFolder(connId, targetId)
          const folderName = targetFolderId
            ? folders.find(f => f.id === targetFolderId)?.name || 'folder'
            : 'root'
          notify.success(`Moved connection to ${folderName}`)
        } catch (err) {
          notify.error(`Failed to move connection: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    const sourceFolderId = e.dataTransfer.getData('application/x-mongopal-folder')
    if (sourceFolderId && sourceFolderId !== '') {
      const sourceFolder = folders.find(f => f.id === sourceFolderId)
      const targetId = targetFolderId || ''
      const currentParentId = sourceFolder?.parentId || ''

      if (sourceFolderId === targetFolderId) {
        draggingFolderIdRef.current = null
        setDraggingFolderId(null)
        setDragOverFolderId(null)
        return
      }
      const descendants = folderHelpers.getDescendantIds(sourceFolderId)
      if (targetFolderId && descendants.includes(targetFolderId)) {
        notify.warning('Cannot move folder into its own subfolder')
        draggingFolderIdRef.current = null
        setDraggingFolderId(null)
        setDragOverFolderId(null)
        return
      }

      if (sourceFolder && currentParentId !== targetId) {
        try {
          await moveFolderToFolder(sourceFolderId, targetId)
          const folderName = targetFolderId
            ? folders.find(f => f.id === targetFolderId)?.name || 'folder'
            : 'root'
          notify.success(`Moved folder to ${folderName}`)
        } catch (err) {
          notify.error(`Failed to move folder: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    setDraggingConnectionId(null)
    draggingFolderIdRef.current = null
    setDraggingFolderId(null)
    setDragOverFolderId(null)
  }

  const showContextMenu = (x: number, y: number, items: ContextMenuItem[]): void => {
    setContextMenu({ x, y, items })
  }

  const handleCopyURI = async (conn: SavedConnection): Promise<void> => {
    try {
      await navigator.clipboard.writeText(conn.uri)
      notify.success('Connection URI copied to clipboard')
    } catch (err) {
      console.error('Failed to copy URI:', err)
      notify.error('Failed to copy URI to clipboard')
    }
  }

  const handleDisconnect = async (connId: string): Promise<void> => {
    await disconnect(connId, closeTabsForConnection)
  }

  const handleDisconnectAll = async (): Promise<void> => {
    if (isDisconnectingAll) {
      return
    }

    setIsDisconnectingAll(true)
    try {
      await disconnectAll(closeAllTabs)
      setDatabases({})
      setCollectionsMap({})
      setExpandedConnections({})
      setExpandedDatabases({})
      setSelectedItem(null)
      setFocusedNodeId(null)
      setSelectedConnection(null)
      setSelectedDatabase(null)
      setSelectedCollection(null)
      lastAccessedDbNodeRef.current = null
    } finally {
      setIsDisconnectingAll(false)
    }
  }

  const handleDisconnectOthers = async (keepConnId: string): Promise<void> => {
    await disconnectOthers(keepConnId, keepOnlyConnectionTabs)
  }

  const handleDropDatabase = (connId: string, dbName: string, removeFromState: (dbName: string) => void): void => {
    setConfirmDialog({
      title: `Drop Database "${dbName}"?`,
      message: `This will permanently delete the database "${dbName}" and ALL its collections. This action cannot be undone.`,
      confirmText: 'Drop Database',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await dropDatabase(connId, dbName)
          closeTabsForDatabase(connId, dbName)
          removeFromState?.(dbName)
          setDatabases(prev => ({
            ...prev,
            [connId]: (prev[connId] || []).filter(db => db.name !== dbName)
          }))
          notify.success(`Database "${dbName}" dropped`)
          setConfirmDialog(null)
        } catch (err) {
          notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
        }
      },
    })
  }

  const handleDropCollection = (connId: string, dbName: string, collName: string, removeFromState: (dbName: string, collName: string) => void): void => {
    setConfirmDialog({
      title: `Drop Collection "${collName}"?`,
      message: `This will permanently delete the collection "${collName}" and ALL its documents. This action cannot be undone.`,
      confirmText: 'Drop Collection',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await dropCollection(connId, dbName, collName)
          closeTabsForCollection(connId, dbName, collName)
          removeFromState?.(dbName, collName)
          notify.success(`Collection "${collName}" dropped`)
          setConfirmDialog(null)
        } catch (err) {
          notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
        }
      },
    })
  }

  const handleClearCollection = (connId: string, dbName: string, collName: string): void => {
    setConfirmDialog({
      title: `Clear Collection "${collName}"?`,
      message: `This will delete ALL documents in the collection "${collName}". The collection structure will be preserved. This action cannot be undone.`,
      confirmText: 'Clear Collection',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await clearCollection(connId, dbName, collName)
          notify.success(`Collection "${collName}" cleared`)
          setConfirmDialog(null)
        } catch (err) {
          notify.error(getErrorSummary(err instanceof Error ? err.message : String(err)))
        }
      },
    })
  }

  const handleSelectCollection = (connId: string, dbName: string, collName: string): void => {
    setSelectedItem(`${connId}:${dbName}:${collName}`)
    setSelectedCollection(collName)
  }

  const handleOpenCollection = (connId: string, dbName: string, collName: string): void => {
    setSelectedCollection(collName)
    openTab(connId, dbName, collName)
  }

  // Build the context value for SidebarProvider
  const sidebarContextValue = useMemo((): SidebarContextValue => ({
    searchQuery,
    selectedItem,
    favorites,
    databaseFavorites,
    onToggleFavorite: handleToggleFavorite,
    onToggleDatabaseFavorite: handleToggleDatabaseFavorite,
    dbSortMode,
    focusedNodeId,
    onNodeFocus: setFocusedNodeId,
    expandedConnections,
    setExpandedConnections,
    expandedDatabases,
    setExpandedDatabases,
    onShowContextMenu: showContextMenu,
    onConnect: connect,
    onDisconnect: handleDisconnect,
    onDisconnectOthers: handleDisconnectOthers,
    activeConnections,
    onSelectDatabase: setSelectedDatabase,
    onSelectCollection: handleSelectCollection,
    onOpenCollection: handleOpenCollection,
    onViewSchema: openSchemaTab,
    onShowStats,
    onManageIndexes,
    onDropDatabase: handleDropDatabase,
    onDropCollection: handleDropCollection,
    onClearCollection: handleClearCollection,
    onExportDatabases,
    onImportDatabases,
    onExportCollections,
    onExportCollection,
    onImportCollections,
    onCollectionsLoaded: (connId: string, dbName: string, collections: CollectionInfo[]) => {
      const key = `${connId}:${dbName}`
      setCollectionsMap(prev => ({ ...prev, [key]: collections }))
    },
    onDatabaseAccessed: (connId: string, dbName: string) => {
      lastAccessedDbNodeRef.current = `db:${connId}:${dbName}`
      setDatabases(prev => ({
        ...prev,
        [connId]: (prev[connId] || []).map(db =>
          db.name === dbName ? { ...db, lastAccessedAt: new Date().toISOString() } : db
        )
      }))
    },
    onError: (msg: string) => notify.error(msg),
  }), [
    searchQuery,
    selectedItem,
    favorites,
    databaseFavorites,
    handleToggleFavorite,
    handleToggleDatabaseFavorite,
    dbSortMode,
    focusedNodeId,
    expandedConnections,
    expandedDatabases,
    activeConnections,
    connect,
    handleDisconnect,
    handleDisconnectOthers,
    setSelectedDatabase,
    openSchemaTab,
    onShowStats,
    onManageIndexes,
    onExportDatabases,
    onImportDatabases,
    onExportCollections,
    onExportCollection,
    onImportCollections,
    notify,
  ])

  const renderFolderNode = (folder: Folder, _index: number, _siblings: number, level = 0): ReactNode => {
    const folderConnections = connectionsByFolder[folder.id] || []
    const childFolders = folderHelpers.getChildFolders(folder.id)

    if (renamingFolderId === folder.id) {
      return (
        <div key={folder.id} className="px-2 py-1" style={{ paddingLeft: `${level * 12 + 8}px` }}>
          <div className="flex items-center gap-1">
            <span className="text-text-muted"><FolderIcon /></span>
            <input
              type="text"
              className="input py-0.5 px-2 text-sm flex-1"
              value={renameFolderValue}
              onChange={(e) => setRenameFolderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameFolder(folder.id, renameFolderValue)
                if (e.key === 'Escape') {
                  setRenamingFolderId(null)
                  setRenameFolderValue('')
                }
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onBlur={() => {
                if (renameFolderValue.trim() && renameFolderValue !== folder.name) {
                  handleRenameFolder(folder.id, renameFolderValue)
                } else {
                  setRenamingFolderId(null)
                  setRenameFolderValue('')
                }
              }}
              autoFocus
            />
          </div>
        </div>
      )
    }

    const handleContextMenu = (e: React.MouseEvent): void => {
      e.preventDefault()
      const menuItems: ContextMenuItem[] = [
        { label: 'Rename', onClick: () => {
          setRenamingFolderId(folder.id)
          setRenameFolderValue(folder.name)
        }},
        { label: 'New Subfolder', onClick: () => {
          setNewSubfolderParentId(folder.id)
          setNewFolderName('')
          setShowNewFolderInput(true)
          setExpandedFolders(prev => ({ ...prev, [folder.id]: true }))
        }},
      ]
      if (folder.parentId) {
        menuItems.push({ label: 'Move to Root', onClick: async () => {
          try {
            await moveFolderToFolder(folder.id, '')
            notify.success('Moved folder to root')
          } catch (err) {
            notify.error(`Failed to move folder: ${err instanceof Error ? err.message : String(err)}`)
          }
        }})
      }
      menuItems.push({ type: 'separator' })
      menuItems.push({ label: 'Delete Folder', onClick: () => handleDeleteFolder(folder.id), danger: true })
      showContextMenu(e.clientX, e.clientY, menuItems)
    }

    return (
      <FolderNode
        key={folder.id}
        folder={folder}
        level={level}
        childFolders={childFolders}
        folderConnections={folderConnections}
        expanded={expandedFolders[folder.id] ?? false}
        onToggle={() => toggleFolder(folder.id)}
        onContextMenu={handleContextMenu}
        focusedNodeId={focusedNodeId}
        onNodeFocus={setFocusedNodeId}
        onDragStart={handleFolderDragStart}
        onDragEnd={handleFolderDragEnd}
        onDragOver={(e) => handleFolderDragOver(e, folder.id)}
        onDragLeave={handleFolderDragLeave}
        onDrop={(e) => handleFolderDrop(e, folder.id)}
        isDragOver={dragOverFolderId === folder.id}
        renderFolderNode={renderFolderNode}
        renderConnectionNode={renderConnectionNode}
      />
    )
  }

  const renderConnectionNode = (conn: ExtendedSavedConnection, _index: number, _totalConnections: number, level = 0): ReactNode => {
    const connMatchInfo = matchInfo[conn.id] || {
      matchedConnection: false,
      matchedDatabases: [],
      matchedCollections: {},
    }

    return (
      <ConnectionNode
        key={conn.id}
        connection={conn}
        isConnected={activeConnections.includes(conn.id)}
        isConnecting={isConnecting(conn.id)}
        databases={databases[conn.id] || []}
        onEdit={() => onEditConnection(conn)}
        onDelete={() => onDeleteConnection(conn.id)}
        onDuplicate={() => duplicateConnection(conn.id)}
        onCopyURI={() => handleCopyURI(conn)}
        onRefresh={() => refreshConnection(conn.id)}
        onShowServerInfo={() => onShowServerInfo?.(conn.id, conn.name)}
        onDragStart={handleConnectionDragStart}
        onDragEnd={handleConnectionDragEnd}
        level={level}
        connectionNameMatched={connMatchInfo.matchedConnection}
        matchingDatabases={connMatchInfo.matchedDatabases}
        matchingCollections={connMatchInfo.matchedCollections}
      />
    )
  }

  return (
    <SidebarProvider value={sidebarContextValue}>
      <div className="h-full flex flex-col bg-surface">
        {/* Search bar - draggable header area */}
        <div className="p-2 border-b border-border titlebar-drag">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim pointer-events-none" />
            <input
              type="text"
              placeholder="Search connections, databases, collections..."
              className="input py-1.5 text-sm titlebar-no-drag"
              style={{ paddingLeft: '2.5rem', paddingRight: searchQuery ? '2.5rem' : '0.75rem' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-dim hover:text-text-secondary rounded hover:bg-surface-hover titlebar-no-drag"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <ClearIcon className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Action buttons - draggable with no-drag on buttons */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border titlebar-drag">
          <button
            className="icon-btn p-1.5 hover:bg-surface-hover text-text-muted hover:text-text-light titlebar-no-drag"
            onClick={onManageConnections}
            title="Manage Connections"
          >
            <ServerIcon className="w-4 h-4" />
          </button>
          <button
            className="icon-btn p-1.5 hover:bg-surface-hover text-text-muted hover:text-text-light titlebar-no-drag"
            onClick={() => setShowNewFolderInput(true)}
            title="New Folder"
          >
            <FolderIcon className="w-4 h-4" />
          </button>
          <button
            className="icon-btn p-1.5 hover:bg-surface-hover text-text-muted hover:text-text-light ml-auto titlebar-no-drag"
            onClick={toggleDbSortMode}
            title={dbSortMode === 'alpha' ? 'Sort by Name (click for Recent)' : 'Sort by Recent (click for Name)'}
          >
            {dbSortMode === 'alpha' ? <SortAlphaIcon className="w-4 h-4" /> : <SortClockIcon className="w-4 h-4" />}
          </button>
          {activeConnections.length > 0 && (
            <button
              type="button"
              className={`icon-btn p-1.5 titlebar-no-drag ${
                isDisconnectingAll
                  ? 'text-text-dim opacity-50 cursor-not-allowed'
                  : 'hover:bg-surface-hover text-text-muted hover:text-text-light'
              }`}
              onClick={handleDisconnectAll}
              title={`Disconnect All (${activeConnections.length})`}
              aria-label="Disconnect all connections"
              disabled={isDisconnectingAll}
            >
              <DisconnectIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New folder input (inline) */}
        {showNewFolderInput && (
          <div className="px-2 py-1.5 border-b border-border">
            {newSubfolderParentId && (
              <div className="text-xs text-text-muted mb-1">
                New subfolder in: {folders.find(f => f.id === newSubfolderParentId)?.name}
              </div>
            )}
            <div className="flex gap-1">
              <input
                type="text"
                className="input py-1 px-2 flex-1 text-sm"
                placeholder={newSubfolderParentId ? "Subfolder name" : "Folder name"}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder(newSubfolderParentId || '')
                  if (e.key === 'Escape') {
                    setShowNewFolderInput(false)
                    setNewFolderName('')
                    setNewSubfolderParentId(null)
                  }
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
              />
              <button className="btn btn-ghost p-1" onClick={() => handleCreateFolder(newSubfolderParentId || '')}>
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Connection tree */}
        <div
          ref={treeRef}
          className="flex-1 overflow-y-auto py-1"
          tabIndex={visibleNodes.length > 0 ? 0 : -1}
          onKeyDown={handleTreeKeyDown}
          onFocus={(e) => {
            if (e.target === treeRef.current && visibleNodes.length > 0 && !focusedNodeId) {
              setFocusedNodeId(visibleNodes[0].id)
              const firstNode = treeRef.current?.querySelector(`[data-node-id="${visibleNodes[0].id}"]`) as HTMLElement | null
              firstNode?.focus()
            }
          }}
        >
          {filteredConnections.length === 0 && folders.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6 py-8">
              {connections.length === 0 ? (
                <div className="space-y-5 text-center max-w-[220px]">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <ServerIcon className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-text font-semibold text-base mb-2">Welcome to MongoPal</h3>
                    <p className="text-text-muted text-sm leading-relaxed">
                      Get started by adding your first MongoDB connection to explore databases and collections.
                    </p>
                  </div>
                  <button
                    className="btn btn-primary w-full py-2.5"
                    onClick={onManageConnections}
                  >
                    <ServerIcon className="w-4 h-4 mr-2" />
                    Manage Connections
                  </button>
                  <p className="text-text-dim text-xs">
                    Tip: You can also press Ctrl+N to add a connection
                  </p>
                </div>
              ) : (
                <p className="text-text-muted text-sm">No matching connections</p>
              )}
            </div>
          ) : (
            <>
              {/* Folders (only root folders, children rendered recursively) */}
              {folderHelpers.rootFolders.map((folder, folderIndex) =>
                renderFolderNode(folder, folderIndex, folderHelpers.rootFolders.length + rootConnections.length, 0)
              )}

              {/* Root connections (no folder) - also a drop zone */}
              <div
                className={`root-drop-zone ${dragOverFolderId === 'root' ? 'drag-over' : ''}`}
                onDragOver={(e) => handleFolderDragOver(e, null)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, null)}
              >
                {rootConnections.map((conn, connIndex) =>
                  renderConnectionNode(conn, folderHelpers.rootFolders.length + connIndex, folderHelpers.rootFolders.length + rootConnections.length)
                )}
                {/* Show drop indicator when dragging something from inside a folder */}
                {((draggingConnectionId && connections.find(c => c.id === draggingConnectionId)?.folderId) ||
                  (draggingFolderId && folders.find(f => f.id === draggingFolderId)?.parentId)) && (
                  <div
                    className={`px-4 py-2 text-xs text-text-muted italic border border-dashed rounded mx-2 my-1 transition-colors ${
                      dragOverFolderId === 'root'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border-light'
                    }`}
                  >
                    Drop here to move to root
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Confirmation Dialog */}
        {confirmDialog && (
          <ConfirmDialog
            open={true}
            title={confirmDialog.title}
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmText}
            danger={confirmDialog.confirmStyle === 'danger'}
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
      </div>
    </SidebarProvider>
  )
}

// Also export as named for backward compatibility
export { Sidebar }
