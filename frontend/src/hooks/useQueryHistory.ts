import { useState, useRef, useEffect, useCallback, LegacyRef } from 'react'

// =============================================================================
// Types
// =============================================================================

/**
 * Query history item stored in localStorage
 */
export type QueryEditorMode = 'mongo' | 'sql'

export interface QueryHistoryItem {
  query: string
  collection: string
  timestamp: number
  /** Editor mode this entry was captured in. Absent = 'mongo' (back-compat). */
  mode?: QueryEditorMode
}

export interface UseQueryHistoryOptions {
  /** Connection ID (used for scoping, reserved for future use) */
  connectionId: string
  /** Database name (used in collection label) */
  database: string
  /** Collection name (used in collection label) */
  collection: string
}

export interface UseQueryHistoryReturn {
  /** List of query history items */
  queryHistory: QueryHistoryItem[]
  /** Whether the history dropdown is visible */
  showHistory: boolean
  /** Toggle history dropdown visibility */
  setShowHistory: (show: boolean) => void
  /** Ref to attach to the dropdown container for outside-click detection */
  historyRef: LegacyRef<HTMLDivElement>
  /** Add a query to history */
  addToHistory: (query: string) => void
  /** Set the query history (for direct replacement, e.g., after executeQuery updates) */
  setQueryHistory: React.Dispatch<React.SetStateAction<QueryHistoryItem[]>>
}

// =============================================================================
// Constants
// =============================================================================

const QUERY_HISTORY_KEY = 'mongopal_query_history'
const MAX_HISTORY_ITEMS = 20

// =============================================================================
// Helper Functions
// =============================================================================

export function loadQueryHistory(): QueryHistoryItem[] {
  try {
    const stored = localStorage.getItem(QUERY_HISTORY_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function saveQueryHistory(history: QueryHistoryItem[]): void {
  try {
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)))
  } catch {
    // Ignore storage errors
  }
}

export function addToQueryHistoryList(
  currentHistory: QueryHistoryItem[],
  query: string,
  database: string,
  collection: string,
  mode: QueryEditorMode = 'mongo'
): QueryHistoryItem[] {
  return [
    { query, collection: `${database}.${collection}`, timestamp: Date.now(), mode },
    // De-dupe on the (query, mode) pair so the same text in each mode coexists.
    ...currentHistory.filter((h) => h.query !== query || (h.mode ?? 'mongo') !== mode),
  ].slice(0, MAX_HISTORY_ITEMS)
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing query history with localStorage persistence and
 * outside-click dismissal of the history dropdown.
 */
export function useQueryHistory({
  database,
  collection,
}: UseQueryHistoryOptions): UseQueryHistoryReturn {
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>(() => loadQueryHistory())
  const [showHistory, setShowHistory] = useState<boolean>(false)
  const historyRef = useRef<HTMLDivElement>(null)

  // Close history dropdown on click outside
  useEffect(() => {
    if (!showHistory) return
    const handleClickOutside = (e: Event): void => {
      const mouseEvent = e as globalThis.MouseEvent
      if (historyRef.current && !historyRef.current.contains(mouseEvent.target as Node)) {
        setShowHistory(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showHistory])

  // Add a query to history and persist
  const addToHistory = useCallback(
    (query: string): void => {
      const newHistory = addToQueryHistoryList(queryHistory, query, database, collection)
      setQueryHistory(newHistory)
      saveQueryHistory(newHistory)
    },
    [queryHistory, database, collection]
  )

  return {
    queryHistory,
    showHistory,
    setShowHistory,
    historyRef,
    addToHistory,
    setQueryHistory,
  }
}

export default useQueryHistory
