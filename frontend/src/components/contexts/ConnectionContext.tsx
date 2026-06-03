import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { useNotification } from '../NotificationContext'
import { useDebugLog, DEBUG_CATEGORIES } from './DebugContext'
import { getErrorSummary } from '../../utils/errorParser'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Represents a saved connection (matches Go types.SavedConnection)
 */
export interface SavedConnection {
  id: string
  name: string
  folderId?: string
  uri: string
  color: string
  createdAt: string | Date
}

/**
 * Represents a folder for organizing connections (matches Go types.Folder)
 */
export interface Folder {
  id: string
  name: string
  parentId?: string
}

/**
 * Go bindings interface for connection operations (local partial type)
 */
interface ConnectionAppBindings {
  // Connection management
  ListSavedConnections?: () => Promise<SavedConnection[]>
  Connect?: (connId: string) => Promise<void>
  Disconnect?: (connId: string) => Promise<void>
  DisconnectAll?: () => Promise<void>
  DeleteSavedConnection?: (connId: string) => Promise<void>
  DuplicateConnection?: (connId: string, newName: string) => Promise<SavedConnection>

  // Folder management
  ListFolders?: () => Promise<Folder[]>
  CreateFolder?: (name: string, parentId: string) => Promise<Folder>
  DeleteFolder?: (folderId: string) => Promise<void>
  MoveConnectionToFolder?: (connId: string, folderId: string) => Promise<void>
  UpdateFolder?: (folderId: string, name: string, parentId: string) => Promise<void>

  // Database/collection operations
  ListDatabases?: (connId: string) => Promise<{ name: string; sizeOnDisk: number; empty: boolean }[]>
  DropDatabase?: (connId: string, dbName: string) => Promise<void>
  DropCollection?: (connId: string, dbName: string, collName: string) => Promise<void>
  ClearCollection?: (connId: string, dbName: string, collName: string) => Promise<void>
}

/**
 * Interface for the connection context value.
 * Contains all state and methods for managing MongoDB connections.
 */
export interface ConnectionContextValue {
  // State
  connections: SavedConnection[]
  folders: Folder[]
  activeConnections: string[]
  connectingIds: Set<string>
  selectedConnection: string | null
  selectedDatabase: string | null
  selectedCollection: string | null

  // Selection setters
  setSelectedConnection: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedDatabase: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedCollection: React.Dispatch<React.SetStateAction<string | null>>

  // Connection actions
  connect: (connId: string) => Promise<void>
  disconnect: (connId: string, onTabsClose?: (connId: string) => void) => Promise<void>
  disconnectAll: (onAllTabsClose?: () => void) => Promise<void>
  disconnectOthers: (keepConnId: string, onOtherTabsClose?: (keepConnId: string) => void) => Promise<void>
  deleteConnection: (connId: string) => Promise<boolean>
  duplicateConnection: (connId: string) => Promise<void>
  refreshConnection: (connId: string) => Promise<void>

  // Database/collection actions
  dropDatabase: (connId: string, dbName: string) => Promise<void>
  dropCollection: (connId: string, dbName: string, collName: string) => Promise<void>
  clearCollection: (connId: string, dbName: string, collName: string) => Promise<void>

  // Folder actions
  createFolder: (name: string, parentId?: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveConnectionToFolder: (connId: string, folderId: string | null) => Promise<void>
  moveFolderToFolder: (folderId: string, parentId: string | null) => Promise<void>

  // Helpers
  getConnectionById: (connId: string) => SavedConnection | undefined
  loadConnections: () => Promise<void>
  isConnecting: (connId: string) => boolean
}

/**
 * Props for the ConnectionProvider component.
 */
interface ConnectionProviderProps {
  children: React.ReactNode
}

// =============================================================================
// Helper Functions
// =============================================================================

// Get go bindings at runtime (for testability)
const getGo = (): ConnectionAppBindings | undefined => window.go?.main?.App as ConnectionAppBindings | undefined

// =============================================================================
// Context and Provider
// =============================================================================

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined)

export function ConnectionProvider({ children }: ConnectionProviderProps): React.JSX.Element {
  const { notify } = useNotification()
  const { log } = useDebugLog(DEBUG_CATEGORIES.CONNECTION)

  // Connection state
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeConnections, setActiveConnections] = useState<string[]>([])

  // Navigation state
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null)
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null)
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null)

  // UI state - track multiple simultaneous connections
  const [connectingIds, setConnectingIds] = useState<Set<string>>(new Set())

  // Load saved connections on mount
  useEffect(() => {
    loadConnections()
  }, [])

  const loadConnections = useCallback(async (): Promise<void> => {
    try {
      const go = getGo()
      if (go?.ListSavedConnections) {
        const saved = await go.ListSavedConnections()
        setConnections(saved || [])
      }
      if (go?.ListFolders) {
        const savedFolders = await go.ListFolders()
        setFolders(savedFolders || [])
      }
    } catch (err) {
      console.error('Failed to load connections:', err)
    }
  }, [])

  const connect = useCallback(async (connId: string): Promise<void> => {
    if (connectingIds.has(connId)) return // This connection already in progress
    const conn = connections.find(c => c.id === connId)
    const connName = conn?.name || 'Unknown'
    log(`Connecting to "${connName}"`, { connectionId: connId })
    setConnectingIds(prev => new Set(prev).add(connId))
    const startTime = performance.now()
    try {
      const go = getGo()
      if (go?.Connect) {
        await go.Connect(connId)
        setActiveConnections(prev => [...prev, connId])
        const duration = Math.round(performance.now() - startTime)
        log(`Connected to "${connName}" (${duration}ms)`, { connectionId: connId, duration })
        notify.success(`Connected to ${connName}`, { silent: true })
      }
    } catch (err) {
      const duration = Math.round(performance.now() - startTime)
      const errorMessage = err instanceof Error ? err.message : String(err)
      log(`Failed to connect to "${connName}" (${duration}ms)`, { connectionId: connId, error: errorMessage, duration })
      console.error('Failed to connect:', err)
      notify.error(`${connName}: ${getErrorSummary(errorMessage)}`)
    } finally {
      setConnectingIds(prev => {
        const next = new Set(prev)
        next.delete(connId)
        return next
      })
    }
  }, [connections, connectingIds, notify, log])

  const disconnect = useCallback(async (connId: string, onTabsClose?: (connId: string) => void): Promise<void> => {
    const conn = connections.find(c => c.id === connId)
    const connName = conn?.name || 'Unknown'
    log(`Disconnecting from "${connName}"`, { connectionId: connId })
    try {
      const go = getGo()
      if (go?.Disconnect) {
        await go.Disconnect(connId)
        setActiveConnections(prev => prev.filter(id => id !== connId))
        log(`Disconnected from "${connName}"`, { connectionId: connId })
        onTabsClose?.(connId)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log(`Failed to disconnect from "${connName}"`, { connectionId: connId, error: errorMessage })
      console.error('Failed to disconnect:', err)
      notify.error(getErrorSummary(errorMessage))
    }
  }, [connections, notify, log])

  const disconnectAll = useCallback(async (onAllTabsClose?: () => void): Promise<void> => {
    try {
      const go = getGo()
      if (go?.DisconnectAll) {
        await go.DisconnectAll()
      }
      setActiveConnections([])
      setSelectedConnection(null)
      setSelectedDatabase(null)
      setSelectedCollection(null)
      onAllTabsClose?.()
    } catch (err) {
      console.error('Failed to disconnect all:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMessage))
      throw err
    }
  }, [notify])

  const disconnectOthers = useCallback(async (keepConnId: string, onOtherTabsClose?: (keepConnId: string) => void): Promise<void> => {
    try {
      const go = getGo()
      for (const connId of activeConnections) {
        if (connId !== keepConnId && go?.Disconnect) {
          await go.Disconnect(connId)
        }
      }
      setActiveConnections([keepConnId])
      onOtherTabsClose?.(keepConnId)
      notify.success('Other connections disconnected', { silent: true })
    } catch (err) {
      console.error('Failed to disconnect others:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMessage))
    }
  }, [activeConnections, notify])

  const deleteConnection = useCallback(async (connId: string): Promise<boolean> => {
    try {
      const go = getGo()
      if (go?.DeleteSavedConnection) {
        await go.DeleteSavedConnection(connId)
        await loadConnections()
        notify.success('Connection deleted')
        return true
      }
    } catch (err) {
      console.error('Failed to delete connection:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMessage))
    }
    return false
  }, [loadConnections, notify])

  const duplicateConnection = useCallback(async (connId: string): Promise<void> => {
    try {
      const conn = connections.find(c => c.id === connId)
      const go = getGo()
      if (conn && go?.DuplicateConnection) {
        await go.DuplicateConnection(connId, `${conn.name} (copy)`)
        await loadConnections()
        notify.success('Connection duplicated')
      }
    } catch (err) {
      console.error('Failed to duplicate connection:', err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMessage))
    }
  }, [connections, loadConnections, notify])

  const refreshConnection = useCallback(async (connId: string): Promise<void> => {
    const go = getGo()
    if (go?.ListDatabases) {
      try {
        await go.ListDatabases(connId)
        notify.info('Connection refreshed')
      } catch (err) {
        console.error('Failed to refresh:', err)
        const errorMessage = err instanceof Error ? err.message : String(err)
        notify.error(getErrorSummary(errorMessage))
      }
    }
  }, [notify])

  const dropDatabase = useCallback(async (connId: string, dbName: string): Promise<void> => {
    const go = getGo()
    if (go?.DropDatabase) {
      await go.DropDatabase(connId, dbName)
    }
  }, [])

  const dropCollection = useCallback(async (connId: string, dbName: string, collName: string): Promise<void> => {
    const go = getGo()
    if (go?.DropCollection) {
      await go.DropCollection(connId, dbName, collName)
    }
  }, [])

  const clearCollection = useCallback(async (connId: string, dbName: string, collName: string): Promise<void> => {
    const go = getGo()
    if (go?.ClearCollection) {
      await go.ClearCollection(connId, dbName, collName)
    }
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string = ''): Promise<void> => {
    try {
      const go = getGo()
      if (go?.CreateFolder) {
        await go.CreateFolder(name, parentId)
        await loadConnections()
      }
    } catch (err) {
      console.error('Failed to create folder:', err)
      throw err
    }
  }, [loadConnections])

  const deleteFolder = useCallback(async (folderId: string): Promise<void> => {
    try {
      const go = getGo()
      if (go?.DeleteFolder) {
        await go.DeleteFolder(folderId)
        await loadConnections()
      }
    } catch (err) {
      console.error('Failed to delete folder:', err)
      throw err
    }
  }, [loadConnections])

  const moveConnectionToFolder = useCallback(async (connId: string, folderId: string | null): Promise<void> => {
    try {
      const go = getGo()
      if (go?.MoveConnectionToFolder) {
        await go.MoveConnectionToFolder(connId, folderId || '')
        await loadConnections()
      }
    } catch (err) {
      console.error('Failed to move connection:', err)
      throw err
    }
  }, [loadConnections])

  const moveFolderToFolder = useCallback(async (folderId: string, parentId: string | null): Promise<void> => {
    try {
      const go = getGo()
      if (go?.UpdateFolder) {
        // Pass empty string for name to keep existing name
        await go.UpdateFolder(folderId, '', parentId || '')
        await loadConnections()
      }
    } catch (err) {
      console.error('Failed to move folder:', err)
      throw err
    }
  }, [loadConnections])

  const getConnectionById = useCallback((connId: string): SavedConnection | undefined => {
    return connections.find(c => c.id === connId)
  }, [connections])

  const isConnecting = useCallback((connId: string): boolean => {
    return connectingIds.has(connId)
  }, [connectingIds])

  const value: ConnectionContextValue = useMemo(() => ({
    // State
    connections,
    folders,
    activeConnections,
    connectingIds,
    selectedConnection,
    selectedDatabase,
    selectedCollection,

    // Selection setters
    setSelectedConnection,
    setSelectedDatabase,
    setSelectedCollection,

    // Connection actions
    connect,
    disconnect,
    disconnectAll,
    disconnectOthers,
    deleteConnection,
    duplicateConnection,
    refreshConnection,

    // Database/collection actions
    dropDatabase,
    dropCollection,
    clearCollection,

    // Folder actions
    createFolder,
    deleteFolder,
    moveConnectionToFolder,
    moveFolderToFolder,

    // Helpers
    getConnectionById,
    loadConnections,
    isConnecting,
  }), [
    connections, folders, activeConnections, connectingIds,
    selectedConnection, selectedDatabase, selectedCollection,
    connect, disconnect, disconnectAll, disconnectOthers,
    deleteConnection, duplicateConnection, refreshConnection,
    dropDatabase, dropCollection, clearCollection,
    createFolder, deleteFolder, moveConnectionToFolder, moveFolderToFolder,
    getConnectionById, loadConnections, isConnecting,
  ])

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext)
  if (context === undefined) {
    throw new Error('useConnection must be used within ConnectionProvider')
  }
  return context
}

export default ConnectionContext
