import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react'
import { useConnection } from './ConnectionContext'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Types of tabs that can be opened in the application
 */
export type TabType = 'collection' | 'document' | 'insert' | 'schema' | 'indexes'

/**
 * Represents a tab in the application.
 * Tabs can be collection views, document editors, schema views, etc.
 */
export interface Tab {
  /** Unique identifier for the tab */
  id: string
  /** Type of tab content */
  type: TabType
  /** Connection ID this tab belongs to */
  connectionId: string
  /** Database name */
  database: string
  /** Collection name */
  collection: string
  /** Display label for the tab */
  label: string
  /** Color for the tab (from connection) */
  color: string
  /** Whether the tab is pinned */
  pinned: boolean
  /** The document content (for document tabs) */
  document?: unknown
  /** The document ID (for document tabs) */
  documentId?: string | null
  /** Whether this tab was restored from session */
  restored?: boolean
  /** Whether the tab has unsaved changes */
  dirty?: boolean
  /** Whether this is a view-only document tab */
  viewOnly?: boolean
}

/**
 * Session data persisted to localStorage
 */
interface SessionData {
  tabs: Array<{
    id: string
    type: TabType
    connectionId: string
    database: string
    collection: string
    label: string
    color: string
    pinned: boolean
    documentId?: string | null
    viewOnly?: boolean
  }>
  activeTab: string | null
  connectedIds: string[]
}

/**
 * Context value containing all tab state and operations
 */
export interface TabContextValue {
  // State
  tabs: Tab[]
  activeTab: string | null
  currentTab: Tab | undefined

  // Tab selection
  setActiveTab: React.Dispatch<React.SetStateAction<string | null>>

  // Tab operations
  openTab: (connectionId: string, database: string, collection: string) => void
  openNewQueryTab: () => void
  openDocumentTab: (connectionId: string, database: string, collection: string, document: unknown, documentId: string) => void
  openViewDocumentTab: (connectionId: string, database: string, collection: string, document: unknown, documentId: string) => void
  openInsertTab: (connectionId: string, database: string, collection: string) => void
  openSchemaTab: (connectionId: string, database: string, collection: string) => void
  openIndexTab: (connectionId: string, database: string, collection: string) => void
  closeTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  renameTab: (tabId: string, newLabel: string) => void
  reorderTabs: (draggedId: string, targetId: string) => void
  convertInsertToDocumentTab: (tabId: string, document: unknown, documentId: string) => void
  convertViewOnlyToEditable: (tabId: string) => void
  setTabDirty: (tabId: string, isDirty: boolean) => void
  markTabActivated: (tabId: string) => void
  updateTabDocument: (tabId: string, document: unknown) => void

  // Bulk close operations
  closeTabsForConnection: (connectionId: string) => void
  closeTabsForDatabase: (connectionId: string, database: string) => void
  closeTabsForCollection: (connectionId: string, database: string, collection: string) => void
  closeAllTabs: () => void
  keepOnlyConnectionTabs: (connectionId: string) => void

  // Tab navigation
  nextTab: () => void
  previousTab: () => void
  goToTab: (number: number) => void
  closeActiveTab: () => void

  // Session persistence
  sessionConnections: string[]
  trackConnection: (connId: string) => void
  untrackConnection: (connId: string) => void
}

/**
 * Props for the TabProvider component
 */
interface TabProviderProps {
  children: React.ReactNode
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ACCENT_COLOR = '#4CC38A'
const SESSION_STORAGE_KEY = 'mongopal-session'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Load session from localStorage
 */
function loadSession(): SessionData | null {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved) as SessionData
    }
  } catch (err) {
    console.error('Failed to load session:', err)
  }
  return null
}

/**
 * Save session to localStorage
 */
function saveSession(session: SessionData): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch (err) {
    console.error('Failed to save session:', err)
  }
}

// =============================================================================
// Context and Provider
// =============================================================================

const TabContext = createContext<TabContextValue | undefined>(undefined)

export function TabProvider({ children }: TabProviderProps): React.JSX.Element {
  const { getConnectionById } = useConnection()

  // Tab state - initialize from session if available
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const session = loadSession()
    if (session?.tabs) {
      // Restore tabs without document content (just metadata)
      // Mark as restored so CollectionView doesn't auto-execute queries
      return session.tabs.map(tab => ({
        ...tab,
        document: null, // Don't restore document content
        documentId: tab.documentId || null,
        restored: true, // Flag for restored tabs - don't auto-execute
        viewOnly: tab.viewOnly || false,
      }))
    }
    return []
  })
  const [activeTab, setActiveTab] = useState<string | null>(() => {
    const session = loadSession()
    return session?.activeTab || null
  })

  // Track connected connections for session
  const [sessionConnections, setSessionConnections] = useState<string[]>(() => {
    const session = loadSession()
    return session?.connectedIds || []
  })

  // Save session when tabs change
  useEffect(() => {
    const session: SessionData = {
      tabs: tabs.map(tab => ({
        id: tab.id,
        type: tab.type,
        connectionId: tab.connectionId,
        database: tab.database,
        collection: tab.collection,
        label: tab.label,
        color: tab.color,
        pinned: tab.pinned,
        documentId: tab.documentId || null,
        viewOnly: tab.viewOnly || undefined,
      })),
      activeTab,
      connectedIds: sessionConnections,
    }
    saveSession(session)
  }, [tabs, activeTab, sessionConnections])

  // Update session connections when a connection is made
  const trackConnection = useCallback((connId: string): void => {
    setSessionConnections(prev => {
      if (prev.includes(connId)) return prev
      return [...prev, connId]
    })
  }, [])

  // Remove connection from session when disconnected
  const untrackConnection = useCallback((connId: string): void => {
    setSessionConnections(prev => prev.filter(id => id !== connId))
  }, [])

  // Derived state
  const currentTab = useMemo(() => tabs.find(t => t.id === activeTab), [tabs, activeTab])

  // Open a collection tab
  const openTab = useCallback((connectionId: string, database: string, collection: string): void => {
    const tabId = `${connectionId}.${database}.${collection}`
    const existingTab = tabs.find(t => t.id === tabId)

    if (existingTab) {
      // If tab was restored from session, clear the flag so it auto-executes
      if (existingTab.restored) {
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, restored: false } : t
        ))
      }
      setActiveTab(tabId)
    } else {
      const conn = getConnectionById(connectionId)
      const newTab: Tab = {
        id: tabId,
        type: 'collection',
        connectionId,
        database,
        collection,
        label: collection,
        color: conn?.color || DEFAULT_ACCENT_COLOR,
        pinned: false,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTab(tabId)
    }
  }, [tabs, getConnectionById])

  // Open a new query tab (for + button)
  const openNewQueryTab = useCallback((): void => {
    const tab = tabs.find(t => t.id === activeTab)
    if (!tab || tab.type === 'document') return

    const { connectionId, database, collection } = tab
    const conn = getConnectionById(connectionId)
    const tabId = `${connectionId}.${database}.${collection}.${Date.now()}`

    const newTab: Tab = {
      id: tabId,
      type: 'collection',
      connectionId,
      database,
      collection,
      label: collection,
      color: conn?.color || DEFAULT_ACCENT_COLOR,
      pinned: false,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTab(tabId)
  }, [tabs, activeTab, getConnectionById])

  // Open document in a new tab
  const openDocumentTab = useCallback((connectionId: string, database: string, collection: string, document: unknown, documentId: string): void => {
    const shortId = typeof documentId === 'string' ? documentId.slice(0, 8) : String(documentId).slice(0, 8)
    const tabId = `doc:${connectionId}.${database}.${collection}.${documentId}`
    const existingTab = tabs.find(t => t.id === tabId)

    if (existingTab) {
      // Clear restored flag if present
      if (existingTab.restored) {
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, restored: false } : t
        ))
      }
      setActiveTab(tabId)
    } else {
      const conn = getConnectionById(connectionId)
      const newTab: Tab = {
        id: tabId,
        type: 'document',
        connectionId,
        database,
        collection,
        document,
        documentId,
        label: `${shortId}...`,
        color: conn?.color || DEFAULT_ACCENT_COLOR,
        pinned: false,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTab(tabId)
    }
  }, [tabs, getConnectionById])

  // Open document in view-only mode
  const openViewDocumentTab = useCallback((connectionId: string, database: string, collection: string, document: unknown, documentId: string): void => {
    const shortId = typeof documentId === 'string' ? documentId.slice(0, 8) : String(documentId).slice(0, 8)
    const tabId = `view:${connectionId}.${database}.${collection}.${documentId}`
    const existingTab = tabs.find(t => t.id === tabId)

    if (existingTab) {
      if (existingTab.restored) {
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, restored: false } : t
        ))
      }
      setActiveTab(tabId)
    } else {
      const conn = getConnectionById(connectionId)
      const newTab: Tab = {
        id: tabId,
        type: 'document',
        connectionId,
        database,
        collection,
        document,
        documentId,
        label: `${shortId}...`,
        color: conn?.color || DEFAULT_ACCENT_COLOR,
        pinned: false,
        viewOnly: true,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTab(tabId)
    }
  }, [tabs, getConnectionById])

  // Open insert tab for new document
  const openInsertTab = useCallback((connectionId: string, database: string, collection: string): void => {
    const conn = getConnectionById(connectionId)
    const tabId = `insert:${connectionId}.${database}.${collection}.${Date.now()}`

    const newTab: Tab = {
      id: tabId,
      type: 'insert',
      connectionId,
      database,
      collection,
      label: 'New Document',
      color: conn?.color || DEFAULT_ACCENT_COLOR,
      pinned: false,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTab(tabId)
  }, [getConnectionById])

  // Open schema view tab
  const openSchemaTab = useCallback((connectionId: string, database: string, collection: string): void => {
    const tabId = `schema:${connectionId}.${database}.${collection}`
    const existingTab = tabs.find(t => t.id === tabId)

    if (existingTab) {
      // Clear restored flag if present
      if (existingTab.restored) {
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, restored: false } : t
        ))
      }
      setActiveTab(tabId)
    } else {
      const conn = getConnectionById(connectionId)
      const newTab: Tab = {
        id: tabId,
        type: 'schema',
        connectionId,
        database,
        collection,
        label: `Schema: ${collection}`,
        color: conn?.color || DEFAULT_ACCENT_COLOR,
        pinned: false,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTab(tabId)
    }
  }, [tabs, getConnectionById])

  // Open index manager tab
  const openIndexTab = useCallback((connectionId: string, database: string, collection: string): void => {
    const tabId = `indexes:${connectionId}.${database}.${collection}`
    const existingTab = tabs.find(t => t.id === tabId)

    if (existingTab) {
      // Clear restored flag if present
      if (existingTab.restored) {
        setTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, restored: false } : t
        ))
      }
      setActiveTab(tabId)
    } else {
      const conn = getConnectionById(connectionId)
      const newTab: Tab = {
        id: tabId,
        type: 'indexes',
        connectionId,
        database,
        collection,
        label: collection,
        color: conn?.color || DEFAULT_ACCENT_COLOR,
        pinned: false,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTab(tabId)
    }
  }, [tabs, getConnectionById])

  // Convert insert tab to document tab after successful insert
  const convertInsertToDocumentTab = useCallback((tabId: string, document: unknown, documentId: string): void => {
    const tab = tabs.find(t => t.id === tabId)
    if (!tab) return

    const shortId = typeof documentId === 'string' ? documentId.slice(0, 8) : String(documentId).slice(0, 8)
    const newTabId = `doc:${tab.connectionId}.${tab.database}.${tab.collection}.${documentId}`

    setTabs(prev => prev.map(t => {
      if (t.id === tabId) {
        return {
          ...t,
          id: newTabId,
          type: 'document' as TabType,
          document,
          documentId,
          label: `${shortId}...`,
        }
      }
      return t
    }))
    setActiveTab(newTabId)
  }, [tabs])

  const convertViewOnlyToEditable = useCallback((tabId: string): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId && t.type === 'document' && t.viewOnly
        ? { ...t, viewOnly: false, restored: false }
        : t
    ))
  }, [])

  const closeTab = useCallback((tabId: string): void => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId)
      // Use functional update for activeTab to avoid stale closure
      setActiveTab(currentActiveTab => {
        if (currentActiveTab === tabId && filtered.length > 0) {
          return filtered[filtered.length - 1]?.id || null
        } else if (filtered.length === 0) {
          return null
        }
        return currentActiveTab
      })
      return filtered
    })
  }, [])

  const pinTab = useCallback((tabId: string): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, pinned: !t.pinned } : t
    ))
  }, [])

  const renameTab = useCallback((tabId: string, newLabel: string): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, label: newLabel } : t
    ))
  }, [])

  // Set dirty state for a tab (for unsaved changes indicator)
  const setTabDirty = useCallback((tabId: string, isDirty: boolean): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, dirty: isDirty } : t
    ))
  }, [])

  // Mark a restored tab as activated (clears restored flag)
  // Called when user explicitly runs a query on a restored tab
  const markTabActivated = useCallback((tabId: string): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, restored: false } : t
    ))
  }, [])

  // Update a tab's document (for document edit tabs after loading)
  const updateTabDocument = useCallback((tabId: string, document: unknown): void => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, document, restored: false } : t
    ))
  }, [])

  const reorderTabs = useCallback((draggedId: string, targetId: string): void => {
    setTabs(prev => {
      const newTabs = [...prev]
      const draggedIndex = newTabs.findIndex(t => t.id === draggedId)
      const targetIndex = newTabs.findIndex(t => t.id === targetId)
      if (draggedIndex === -1 || targetIndex === -1) return prev

      const [dragged] = newTabs.splice(draggedIndex, 1)
      newTabs.splice(targetIndex, 0, dragged)
      return newTabs
    })
  }, [])

  // Close tabs for a specific connection (used when disconnecting)
  const closeTabsForConnection = useCallback((connectionId: string): void => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.connectionId !== connectionId)
      setActiveTab(currentActiveTab => {
        if (currentActiveTab && !filtered.find(t => t.id === currentActiveTab)) {
          return filtered.length > 0 ? filtered[filtered.length - 1].id : null
        }
        return currentActiveTab
      })
      return filtered
    })
  }, [])

  // Close tabs for a specific database (used when dropping database)
  const closeTabsForDatabase = useCallback((connectionId: string, database: string): void => {
    setTabs(prev => {
      const filtered = prev.filter(t => !(t.connectionId === connectionId && t.database === database))
      setActiveTab(currentActiveTab => {
        if (currentActiveTab && !filtered.find(t => t.id === currentActiveTab)) {
          return filtered.length > 0 ? filtered[filtered.length - 1].id : null
        }
        return currentActiveTab
      })
      return filtered
    })
  }, [])

  // Close tabs for a specific collection (used when dropping collection)
  const closeTabsForCollection = useCallback((connectionId: string, database: string, collection: string): void => {
    setTabs(prev => {
      const filtered = prev.filter(t => !(t.connectionId === connectionId && t.database === database && t.collection === collection))
      setActiveTab(currentActiveTab => {
        if (currentActiveTab && !filtered.find(t => t.id === currentActiveTab)) {
          return filtered.length > 0 ? filtered[filtered.length - 1].id : null
        }
        return currentActiveTab
      })
      return filtered
    })
  }, [])

  // Close all tabs (used when disconnecting all)
  const closeAllTabs = useCallback((): void => {
    setTabs([])
    setActiveTab(null)
  }, [])

  // Keep only tabs for a specific connection (used when disconnecting others)
  const keepOnlyConnectionTabs = useCallback((connectionId: string): void => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.connectionId === connectionId)
      setActiveTab(currentActiveTab => {
        if (currentActiveTab && !filtered.find(t => t.id === currentActiveTab)) {
          return filtered.length > 0 ? filtered[filtered.length - 1].id : null
        }
        return currentActiveTab
      })
      return filtered
    })
  }, [])

  // Navigate to next tab
  const nextTab = useCallback((): void => {
    if (tabs.length === 0) return
    const currentIndex = tabs.findIndex(t => t.id === activeTab)
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabs.length : 0
    setActiveTab(tabs[nextIndex].id)
  }, [tabs, activeTab])

  // Navigate to previous tab
  const previousTab = useCallback((): void => {
    if (tabs.length === 0) return
    const currentIndex = tabs.findIndex(t => t.id === activeTab)
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1
    setActiveTab(tabs[prevIndex].id)
  }, [tabs, activeTab])

  // Jump to tab by number (1-9)
  const goToTab = useCallback((number: number): void => {
    if (number < 1 || number > tabs.length) return
    setActiveTab(tabs[number - 1].id)
  }, [tabs])

  // Close current active tab
  const closeActiveTab = useCallback((): void => {
    if (!activeTab) return
    const tab = tabs.find(t => t.id === activeTab)
    // Don't close pinned tabs
    if (tab?.pinned) return
    closeTab(activeTab)
  }, [activeTab, tabs, closeTab])

  const value: TabContextValue = useMemo(() => ({
    // State
    tabs,
    activeTab,
    currentTab,

    // Tab selection
    setActiveTab,

    // Tab operations
    openTab,
    openNewQueryTab,
    openDocumentTab,
    openViewDocumentTab,
    openInsertTab,
    openSchemaTab,
    openIndexTab,
    closeTab,
    pinTab,
    renameTab,
    reorderTabs,
    convertInsertToDocumentTab,
    convertViewOnlyToEditable,
    setTabDirty,
    markTabActivated,
    updateTabDocument,

    // Bulk close operations
    closeTabsForConnection,
    closeTabsForDatabase,
    closeTabsForCollection,
    closeAllTabs,
    keepOnlyConnectionTabs,

    // Tab navigation
    nextTab,
    previousTab,
    goToTab,
    closeActiveTab,

    // Session persistence
    sessionConnections,
    trackConnection,
    untrackConnection,
  }), [
    tabs, activeTab, currentTab,
    openTab, openNewQueryTab, openDocumentTab, openViewDocumentTab, openInsertTab, openSchemaTab, openIndexTab,
    closeTab, pinTab, renameTab, reorderTabs, convertInsertToDocumentTab, convertViewOnlyToEditable,
    setTabDirty, markTabActivated, updateTabDocument,
    closeTabsForConnection, closeTabsForDatabase, closeTabsForCollection,
    closeAllTabs, keepOnlyConnectionTabs,
    nextTab, previousTab, goToTab, closeActiveTab,
    sessionConnections, trackConnection, untrackConnection,
  ])

  return (
    <TabContext.Provider value={value}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab(): TabContextValue {
  const context = useContext(TabContext)
  if (context === undefined) {
    throw new Error('useTab must be used within TabProvider')
  }
  return context
}

export default TabContext
