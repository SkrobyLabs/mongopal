import { useState, useEffect, useRef, useMemo, type ReactElement, type MouseEvent as ReactMouseEvent } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import MonacoDiffEditor from './MonacoDiffEditor'
import { useNotification } from './NotificationContext'
import { useConnection } from './contexts/ConnectionContext'
import { useTab, type Tab } from './contexts/TabContext'
import ConfirmDialog from './ConfirmDialog'
import MonacoErrorBoundary from './MonacoErrorBoundary'
import { getErrorSummary } from '../utils/errorParser'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * MongoDB document ID can be various types
 */
export type MongoDocumentId =
  | string
  | { $oid: string }
  | { $binary: { base64: string; subType?: string } }
  | { $uuid: string }
  | Record<string, unknown>

/**
 * Props for the DocumentEditView component
 */
export interface DocumentEditViewProps {
  /** Connection ID */
  connectionId: string
  /** Database name */
  database: string
  /** Collection name */
  collection: string
  /** The document to edit (null for insert mode) */
  document?: Record<string, unknown> | null
  /** Document ID (for edit mode) */
  documentId?: MongoDocumentId | null
  /** Callback after successful save */
  onSave?: () => void
  /** View mode: 'edit', 'insert', or 'view' */
  mode?: 'edit' | 'insert' | 'view'
  /** Callback after successful insert with new document and ID */
  onInsertComplete?: (document: Record<string, unknown>, documentId: string) => void
  /** Tab ID for dirty state tracking */
  tabId?: string
  /** Whether the view is read-only */
  readOnly?: boolean
}

/**
 * Edit history entry structure
 */
interface HistoryEntry {
  /** Content at this history point */
  content: string
  /** Timestamp when saved */
  timestamp: number
  /** Whether this is the baseline (original) entry */
  isBaseline?: boolean
}

/**
 * Formatted timestamp result
 */
interface FormattedTimestamp {
  /** Relative time string (e.g., "5m ago") */
  relative: string
  /** Exact date/time string */
  exact: string
}

/**
 * Icon component props
 */
interface IconProps {
  className?: string
}

/**
 * Go App bindings for document operations.
 * Note: window.go is declared in ConnectionContext.tsx.
 * We use type assertion here to access document-specific methods.
 */
interface DocumentGoBindings {
  GetDocument?: (connectionId: string, database: string, collection: string, documentId: MongoDocumentId) => Promise<string>
  UpdateDocument?: (connectionId: string, database: string, collection: string, documentId: MongoDocumentId, content: string) => Promise<void>
  InsertDocument?: (connectionId: string, database: string, collection: string, content: string) => Promise<string>
}

// =============================================================================
// Constants
// =============================================================================

// Access window.go with type assertion for document-specific methods
const go = (window as { go?: { main?: { App?: DocumentGoBindings } } }).go?.main?.App

/** Maximum number of history entries to keep */
const MAX_HISTORY_ENTRIES = 50

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Recursively sort object keys for consistent comparison
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }
  const sorted: Record<string, unknown> = {}
  // Sort keys alphabetically, but keep _id first if present
  const keys = Object.keys(obj as Record<string, unknown>).sort((a, b) => {
    if (a === '_id') return -1
    if (b === '_id') return 1
    return a.localeCompare(b)
  })
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key])
  }
  return sorted
}

/**
 * Sort JSON string keys for consistent diff comparison.
 * Returns original string if parsing fails (invalid JSON).
 */
function sortJsonString(jsonStr: string): string {
  try {
    const parsed = JSON.parse(jsonStr) as unknown
    return JSON.stringify(sortObjectKeys(parsed), null, 2)
  } catch {
    return jsonStr
  }
}

/**
 * Compute a human-readable diff summary between two JSON documents.
 * Returns a string like "updated name", "added 2 fields", "removed status, updated count".
 * Exported for testing.
 */
export function computeDiffSummary(oldContent: unknown, newContent: unknown): string {
  try {
    const oldDoc = typeof oldContent === 'string' ? JSON.parse(oldContent) as Record<string, unknown> : oldContent as Record<string, unknown>
    const newDoc = typeof newContent === 'string' ? JSON.parse(newContent) as Record<string, unknown> : newContent as Record<string, unknown>

    const added: string[] = []
    const removed: string[] = []
    const updated: string[] = []

    // Get all keys from both documents (excluding _id which shouldn't change)
    const oldKeys = new Set(Object.keys(oldDoc).filter(k => k !== '_id'))
    const newKeys = new Set(Object.keys(newDoc).filter(k => k !== '_id'))

    // Find added fields (in new but not in old)
    for (const key of newKeys) {
      if (!oldKeys.has(key)) {
        added.push(key)
      }
    }

    // Find removed fields (in old but not in new)
    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        removed.push(key)
      }
    }

    // Find updated fields (in both but with different values)
    for (const key of oldKeys) {
      if (newKeys.has(key)) {
        const oldVal = JSON.stringify(sortObjectKeys(oldDoc[key]))
        const newVal = JSON.stringify(sortObjectKeys(newDoc[key]))
        if (oldVal !== newVal) {
          updated.push(key)
        }
      }
    }

    // No changes
    if (added.length === 0 && removed.length === 0 && updated.length === 0) {
      return 'no changes'
    }

    // Build summary parts
    const parts: string[] = []

    // If total changes are small (<=2), show field names
    const totalChanges = added.length + removed.length + updated.length
    if (totalChanges <= 2) {
      if (updated.length > 0) parts.push(`updated ${updated.join(', ')}`)
      if (added.length > 0) parts.push(`added ${added.join(', ')}`)
      if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`)
    } else {
      // Many changes - show counts
      if (updated.length > 0) parts.push(`${updated.length} updated`)
      if (added.length > 0) parts.push(`${added.length} added`)
      if (removed.length > 0) parts.push(`${removed.length} removed`)
    }

    return parts.join(', ')
  } catch {
    return 'changes detected'
  }
}

/**
 * Format document ID for display (handles ObjectId, Binary, etc.)
 */
function formatDocId(docId: MongoDocumentId | null | undefined): string {
  if (!docId) return 'unknown'
  if (typeof docId === 'string') return docId
  if (typeof docId === 'object') {
    if ('$oid' in docId && typeof docId.$oid === 'string') return docId.$oid
    if ('$binary' in docId && typeof docId.$binary === 'object' && docId.$binary) {
      const binary = docId.$binary as { base64: string; subType?: string }
      return `Binary(${binary.subType || ''})`
    }
    if ('$uuid' in docId && typeof docId.$uuid === 'string') return docId.$uuid
  }
  return JSON.stringify(docId)
}

// =============================================================================
// Icon Components
// =============================================================================

const SaveIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
  </svg>
)

const CheckIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const CopyIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
)

const FormatIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
  </svg>
)

const SearchIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const RefreshIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
)

const HistoryIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const RevertIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  </svg>
)

const PlusIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const EditIcon = ({ className = "w-4 h-4" }: IconProps): ReactElement => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
)

// =============================================================================
// Main Component
// =============================================================================

export default function DocumentEditView({
  connectionId,
  database,
  collection,
  document,
  documentId,
  onSave,
  mode = 'edit',
  onInsertComplete,
  tabId,
  readOnly = false,
}: DocumentEditViewProps): ReactElement {
  const { notify } = useNotification()
  const { activeConnections, connectingIds, connect } = useConnection()
  const { setTabDirty, updateTabDocument, convertViewOnlyToEditable, tabs } = useTab()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)

  // Get current tab to check if it was restored from session
  const currentTab = tabs.find((t: Tab) => t.id === tabId)
  const isRestoredTab = currentTab?.restored === true

  // Connection state
  const isConnected = activeConnections.includes(connectionId)
  const isConnecting = connectingIds.has(connectionId)

  const isInsertMode = mode === 'insert'
  const isViewMode = mode === 'view'
  const [content, setContent] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)
  const [saved, setSaved] = useState<boolean>(false)
  const [inserting, setInserting] = useState<boolean>(false)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [hasChanges, setHasChanges] = useState<boolean>(false)
  const [originalContent, setOriginalContent] = useState<string>('')
  const [showRefreshConfirm, setShowRefreshConfirm] = useState<boolean>(false)

  // Document loading state (for restored sessions)
  const [loadingDocument, setLoadingDocument] = useState<boolean>(false)
  const [loadedDocument, setLoadedDocument] = useState<Record<string, unknown> | null>(null)
  const [documentNotFound, setDocumentNotFound] = useState<boolean>(false)

  // Edit history state
  const [editHistory, setEditHistory] = useState<HistoryEntry[]>([])
  const [baselineEntry, setBaselineEntry] = useState<HistoryEntry | null>(null)
  const [hasSavedOnce, setHasSavedOnce] = useState<boolean>(false)
  const [showHistoryDropdown, setShowHistoryDropdown] = useState<boolean>(false)
  const [previewHistoryIndex, setPreviewHistoryIndex] = useState<number | null>(null)
  const [historyDiffSideBySide, setHistoryDiffSideBySide] = useState<boolean>(true)
  const baselineSetRef = useRef<boolean>(false)
  const lastDocumentIdRef = useRef<MongoDocumentId | null | undefined>(documentId)

  // Reset baseline tracking when document ID changes (different document opened)
  useEffect(() => {
    if (documentId !== lastDocumentIdRef.current) {
      baselineSetRef.current = false
      lastDocumentIdRef.current = documentId
    }
  }, [documentId])

  // Close history dropdown on click outside
  useEffect(() => {
    if (!showHistoryDropdown) return
    // Guard against document being null/undefined in Wails WebKit
    if (typeof window === 'undefined' || !window.document) return
    const handleClickOutside = (e: globalThis.MouseEvent): void => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setShowHistoryDropdown(false)
        setPreviewHistoryIndex(null)
      }
    }
    window.document.addEventListener('mousedown', handleClickOutside)
    return () => window.document.removeEventListener('mousedown', handleClickOutside)
  }, [showHistoryDropdown])

  // Generate storage key for document history
  const getHistoryStorageKey = (): string => {
    const docIdStr = typeof documentId === 'object'
      ? JSON.stringify(documentId)
      : String(documentId)
    return `mongopal:history:${connectionId}:${database}:${collection}:${docIdStr}`
  }

  // Load history from storage on mount
  useEffect(() => {
    if (!connectionId || !database || !collection || !documentId) return

    try {
      const key = getHistoryStorageKey()
      const stored = sessionStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryEntry[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setEditHistory(parsed)
          setHasSavedOnce(true)
        }
      }
    } catch (err) {
      console.warn('[DocumentEditView] Failed to load history from storage:', err)
    }
  }, [connectionId, database, collection, documentId])

  // Save history to storage when it changes
  useEffect(() => {
    if (!connectionId || !database || !collection || !documentId) return
    if (editHistory.length === 0) return

    try {
      const key = getHistoryStorageKey()
      sessionStorage.setItem(key, JSON.stringify(editHistory))
    } catch (err) {
      console.warn('[DocumentEditView] Failed to save history to storage:', err)
    }
  }, [editHistory, connectionId, database, collection, documentId])

  // Add saved content to history (called from handleSave after successful save)
  const addToHistory = (savedContent: string): void => {
    if (!savedContent) return

    setEditHistory(prev => {
      // Don't add duplicate entries (same content as most recent save)
      if (prev.length > 0 && prev[0].content === savedContent) {
        return prev
      }
      const newEntry: HistoryEntry = {
        content: savedContent,
        timestamp: Date.now(),
      }
      // Keep one slot for baseline, so limit to MAX_HISTORY_ENTRIES - 1
      return [newEntry, ...prev].slice(0, MAX_HISTORY_ENTRIES - 1)
    })
  }

  // Format timestamp for display - returns { relative, exact } for tooltip support
  const formatTimestamp = (ts: number): FormattedTimestamp => {
    const date = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    let relative: string
    if (diffMins < 1) relative = 'Just now'
    else if (diffMins < 60) relative = `${diffMins}m ago`
    else if (diffHours < 24) relative = `${diffHours}h ago`
    else if (diffDays < 7) relative = `${diffDays}d ago`
    else relative = date.toLocaleDateString()

    const exact = date.toLocaleString()
    return { relative, exact }
  }

  // Get version label for history entry (V2, V3, etc. - Baseline is handled separately)
  const getVersionLabel = (index: number, total: number): string => {
    const version = total - index
    return `V${version}`
  }

  // Combined history entries - only include baseline if there are saved versions
  const allHistoryEntries = useMemo((): HistoryEntry[] => {
    if (!baselineEntry) return editHistory
    if (!hasSavedOnce) return []
    return [...editHistory, baselineEntry]
  }, [editHistory, baselineEntry, hasSavedOnce])

  // Revert to a history entry
  const revertToHistory = (index: number): void => {
    const entry = allHistoryEntries[index]
    if (entry) {
      setContent(entry.content)
      editorRef.current?.setValue(entry.content)
      setShowHistoryDropdown(false)
      setPreviewHistoryIndex(null)
      notify.info(entry.isBaseline ? 'Reverted to baseline' : 'Reverted to previous state')
    }
  }

  // Load document from database (for restored sessions or when connection restored)
  const loadDocument = async (): Promise<void> => {
    if (!documentId || !go?.GetDocument) return

    setLoadingDocument(true)
    setDocumentNotFound(false)
    try {
      const jsonStr = await go.GetDocument(connectionId, database, collection, documentId)
      const doc = JSON.parse(jsonStr) as Record<string, unknown>
      setLoadedDocument(doc)
      // Store in tab context so it persists across tab switches
      if (updateTabDocument && tabId) updateTabDocument(tabId, doc)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg.toLowerCase().includes('not found') || errorMsg.toLowerCase().includes('no document')) {
        setDocumentNotFound(true)
        notify.error('Document not found in database')
      } else {
        notify.error(getErrorSummary(errorMsg))
      }
    } finally {
      setLoadingDocument(false)
    }
  }

  // Format the document ID for display
  const displayId = isInsertMode ? 'New Document' : formatDocId(documentId)

  // Use the document from props, or loaded document for restored sessions
  const effectiveDocument = document || loadedDocument

  // Initialize content from document or empty for insert mode
  useEffect(() => {
    if (isInsertMode) {
      const initial = '{\n  \n}'
      setContent(initial)
      setOriginalContent(initial)
      setHasChanges(false)
      // Set baseline only once for insert mode
      if (!baselineSetRef.current) {
        setBaselineEntry({ content: initial, timestamp: Date.now(), isBaseline: true })
        baselineSetRef.current = true
      }
    } else if (effectiveDocument) {
      const formatted = JSON.stringify(effectiveDocument, null, 2)
      setContent(formatted)
      setOriginalContent(formatted)
      setHasChanges(false)
      // Set baseline only once when document first loads
      if (!baselineSetRef.current) {
        setBaselineEntry({ content: formatted, timestamp: Date.now(), isBaseline: true })
        baselineSetRef.current = true
      }
    }
  }, [effectiveDocument, isInsertMode])

  // Track changes and update tab dirty state (skip in view mode)
  useEffect(() => {
    if (isViewMode) return
    const isDirty = content !== originalContent
    setHasChanges(isDirty)
    // Update tab dirty indicator if tabId is provided
    if (tabId && setTabDirty) {
      setTabDirty(tabId, isDirty)
    }
  }, [content, originalContent, tabId, setTabDirty, isViewMode])

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Apply the dynamic theme (already defined in monacoConfig.ts and regenerated by ThemeContext)
    monaco.editor.setTheme('mongopal-dark')

    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      folding: true,
      renderWhitespace: 'selection',
      wordWrap: 'on',
      automaticLayout: true,
    })

    if (isInsertMode) {
      // Add Cmd+Enter insert shortcut
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        () => handleInsert()
      )
    } else if (!isViewMode) {
      // Add Cmd+S save shortcut
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => handleSave()
      )
    }
  }

  const handleSave = async (): Promise<void> => {
    const currentContent = editorRef.current?.getValue() || content

    try {
      JSON.parse(currentContent)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      notify.error(`Invalid JSON: ${errorMsg}`)
      return
    }

    setSaving(true)
    try {
      if (go?.UpdateDocument && documentId) {
        await go.UpdateDocument(connectionId, database, collection, documentId, currentContent)
        notify.success('Document saved')
        // Add the PREVIOUS saved version to history (what we're replacing)
        if (originalContent && originalContent !== baselineEntry?.content) {
          addToHistory(originalContent)
        }
        setHasSavedOnce(true)
        setOriginalContent(currentContent)
        setHasChanges(false)
        setSaving(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
        if (onSave) onSave()
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMsg))
      setSaving(false)
    }
  }

  const handleInsert = async (): Promise<void> => {
    const currentContent = editorRef.current?.getValue() || content

    try {
      JSON.parse(currentContent)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      notify.error(`Invalid JSON: ${errorMsg}`)
      return
    }

    setInserting(true)
    try {
      if (go?.InsertDocument) {
        const newId = await go.InsertDocument(connectionId, database, collection, currentContent)
        notify.success(`Document inserted: ${newId}`)

        // Fetch the inserted document and convert tab to edit mode
        if (go?.GetDocument && onInsertComplete) {
          const docJson = await go.GetDocument(connectionId, database, collection, newId)
          const doc = JSON.parse(docJson) as Record<string, unknown>
          onInsertComplete(doc, newId)
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMsg))
    } finally {
      setInserting(false)
    }
  }

  const handleFormat = (): void => {
    const currentContent = editorRef.current?.getValue() || content
    try {
      const parsed = JSON.parse(currentContent) as unknown
      const formatted = JSON.stringify(parsed, null, 2)
      setContent(formatted)
      editorRef.current?.setValue(formatted)
    } catch {
      notify.error(`Cannot format: Invalid JSON`)
    }
  }

  const doRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      if (go?.GetDocument && documentId) {
        const jsonStr = await go.GetDocument(connectionId, database, collection, documentId)
        const formatted = JSON.stringify(JSON.parse(jsonStr), null, 2)
        setContent(formatted)
        setOriginalContent(formatted)
        editorRef.current?.setValue(formatted)
        setHasChanges(false)
        notify.success('Document refreshed')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      notify.error(getErrorSummary(errorMsg))
    } finally {
      setRefreshing(false)
    }
  }

  const handleRefresh = (): void => {
    if (hasChanges) {
      setShowRefreshConfirm(true)
    } else {
      doRefresh()
    }
  }

  const handleCopy = async (): Promise<void> => {
    const currentContent = editorRef.current?.getValue() || content
    try {
      await navigator.clipboard.writeText(currentContent)
      notify.success('Copied to clipboard')
    } catch {
      notify.error('Failed to copy')
    }
  }

  const openFind = (): void => {
    // Trigger Monaco's built-in find widget
    editorRef.current?.getAction('actions.find')?.run()
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center justify-between gap-4 bg-surface-secondary">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-text-muted truncate max-w-[150px]" title={database}>{database}</span>
          <span className="text-text-dim flex-shrink-0">&gt;</span>
          <span className="text-text-muted truncate max-w-[150px]" title={collection}>{collection}</span>
          <span className="text-text-dim flex-shrink-0">&gt;</span>
          <span className="text-text-light font-mono truncate max-w-[200px]" title={displayId}>{displayId}</span>
          {hasChanges && !isViewMode && (
            <span className="text-warning text-xs flex-shrink-0">(modified)</span>
          )}
          {isViewMode && (
            <span className="text-info text-xs flex-shrink-0">(view only)</span>
          )}
          {isViewMode && tabId && !readOnly && (
            <button
              className="btn btn-ghost p-1"
              onClick={() => convertViewOnlyToEditable(tabId)}
              title="Make editable"
              aria-label="Make editable"
            >
              <EditIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost p-1.5"
            onClick={openFind}
            title="Find (Cmd+F)"
          >
            <SearchIcon className="w-4 h-4" />
          </button>
          <button
            className="btn btn-ghost p-1.5"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            <CopyIcon className="w-4 h-4" />
          </button>
          <button
            className="btn btn-ghost p-1.5"
            onClick={handleFormat}
            title="Format JSON"
          >
            <FormatIcon className="w-4 h-4" />
          </button>
          {!isInsertMode && !isViewMode && (
            <>
              <div className="relative" ref={historyDropdownRef}>
                <button
                  className={`btn btn-ghost p-1.5 flex items-center gap-1 ${allHistoryEntries.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => allHistoryEntries.length > 0 && setShowHistoryDropdown(!showHistoryDropdown)}
                  disabled={allHistoryEntries.length === 0}
                  title={allHistoryEntries.length > 0 ? `${allHistoryEntries.length} history entries` : 'No history yet'}
                >
                  <HistoryIcon className="w-4 h-4" />
                  {allHistoryEntries.length > 0 && (
                    <span className="text-xs text-text-muted">({allHistoryEntries.length})</span>
                  )}
                </button>

                {showHistoryDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-80 bg-surface border border-border rounded-lg shadow-xl z-50 max-h-64 overflow-auto">
                    <div className="px-3 py-2 border-b border-border text-xs text-text-muted sticky top-0 bg-surface">
                      Edit History - Click to preview, double-click to revert
                    </div>
                    {allHistoryEntries.map((entry, idx) => {
                      const ts = entry.isBaseline ? null : formatTimestamp(entry.timestamp)
                      const versionLabel = entry.isBaseline ? 'Baseline' : getVersionLabel(idx, allHistoryEntries.length)
                      return (
                        <button
                          key={idx}
                          className={`w-full px-3 py-2 text-left text-sm border-b border-border last:border-0 hover:bg-surface-hover ${previewHistoryIndex === idx ? 'bg-surface-active' : ''}`}
                          onClick={() => {
                            const newIndex = previewHistoryIndex === idx ? null : idx
                            setPreviewHistoryIndex(newIndex)
                            // Close dropdown when opening preview
                            if (newIndex !== null) {
                              setShowHistoryDropdown(false)
                            }
                          }}
                          onDoubleClick={() => revertToHistory(idx)}
                          title={ts ? ts.exact : 'Original document state'}
                        >
                          <div className="flex items-center justify-between">
                            <span className={entry.isBaseline ? 'text-warning font-medium' : 'text-text-secondary'}>
                              {versionLabel}
                            </span>
                            <span className="text-xs text-text-dim">
                              {ts ? ts.relative : ''}
                            </span>
                          </div>
                          <div className="text-xs text-text-dim truncate mt-0.5">
                            {computeDiffSummary(entry.content, content)}
                          </div>
                          {previewHistoryIndex === idx && (
                            <div className="mt-1 flex justify-end">
                              <button
                                className="p-1 hover:bg-surface-active rounded flex items-center gap-1 text-xs text-primary"
                                onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                                  e.stopPropagation()
                                  revertToHistory(idx)
                                }}
                                title="Revert to this state"
                              >
                                <RevertIcon className="w-3.5 h-3.5" />
                                Revert
                              </button>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* History diff preview */}
                {previewHistoryIndex !== null && allHistoryEntries[previewHistoryIndex] && (() => {
                  const previewEntry = allHistoryEntries[previewHistoryIndex]
                  const previewTs = previewEntry.isBaseline ? null : formatTimestamp(previewEntry.timestamp)
                  const previewVersionLabel = previewEntry.isBaseline ? 'Baseline' : getVersionLabel(previewHistoryIndex, allHistoryEntries.length)
                  return (
                  <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={() => setPreviewHistoryIndex(null)}>
                    <div className="w-full max-w-5xl h-[70vh] bg-background text-text border border-border rounded-lg shadow-2xl flex flex-col" onClick={(e: ReactMouseEvent<HTMLDivElement>) => e.stopPropagation()}>
                      <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-medium text-text-light">History Preview</h3>
                          <span className="text-xs text-text-dim" title={previewTs ? previewTs.exact : 'Original document state'}>
                            {previewVersionLabel}{previewTs ? ` (${previewTs.relative})` : ''} vs Current
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* View mode toggle */}
                          <div className="flex items-center bg-surface rounded-md p-0.5">
                            <button
                              className={`p-1 rounded text-xs ${historyDiffSideBySide ? 'bg-surface-active text-text' : 'text-text-muted hover:text-text'}`}
                              onClick={() => setHistoryDiffSideBySide(true)}
                              title="Side by side"
                            >
                              Side
                            </button>
                            <button
                              className={`p-1 rounded text-xs ${!historyDiffSideBySide ? 'bg-surface-active text-text' : 'text-text-muted hover:text-text'}`}
                              onClick={() => setHistoryDiffSideBySide(false)}
                              title="Stacked"
                            >
                              Stacked
                            </button>
                          </div>
                          <button
                            className="btn btn-primary text-xs flex items-center gap-1"
                            onClick={() => revertToHistory(previewHistoryIndex)}
                          >
                            <RevertIcon className="w-3.5 h-3.5" />
                            Restore this version
                          </button>
                          <button
                            className="icon-btn p-1.5 hover:bg-surface-hover"
                            onClick={() => setPreviewHistoryIndex(null)}
                            title="Close preview (Escape)"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {historyDiffSideBySide && (
                        <div className="flex-shrink-0 flex border-b border-border text-xs text-text-muted">
                          <div className="flex-1 px-4 py-1.5 border-r border-border bg-error-dark/10">
                            <span className="text-error">Previous</span>
                            <span className="ml-2">{previewVersionLabel}{previewTs ? ` (${previewTs.relative})` : ''}</span>
                          </div>
                          <div className="flex-1 px-4 py-1.5 bg-success-dark/10">
                            <span className="text-success">Current</span>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 overflow-hidden">
                        <MonacoDiffEditor
                          key={`diff-${previewHistoryIndex}-${historyDiffSideBySide}`}
                          original={sortJsonString(previewEntry.content)}
                          modified={sortJsonString(content)}
                          language="json"
                          renderSideBySide={historyDiffSideBySide}
                        />
                      </div>
                    </div>
                  </div>
                  )
                })()}
              </div>

              <button
                className="btn btn-ghost p-1.5"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Reload from database"
              >
                <RefreshIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
          {isInsertMode ? (
            <button
              className={`btn btn-primary flex items-center gap-1.5 text-xs ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={handleInsert}
              disabled={inserting || readOnly}
              title={readOnly ? 'Read-only mode' : 'Insert document (Cmd+Enter)'}
            >
              <PlusIcon className="w-3.5 h-3.5" />
              {inserting ? 'Inserting...' : 'Insert'}
            </button>
          ) : !isViewMode ? (
            <button
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                readOnly
                  ? 'bg-surface-hover text-text-dim cursor-not-allowed'
                  : saved
                  ? 'bg-green-600 text-white'
                  : hasChanges && !saving
                  ? 'bg-primary text-background hover:bg-primary/90'
                  : 'bg-surface-hover text-text-muted cursor-not-allowed'
              }`}
              onClick={handleSave}
              disabled={saving || saved || !hasChanges || readOnly}
              title={readOnly ? 'Read-only mode' : 'Save (Cmd+S)'}
            >
              {saved ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" />
                  Saved
                </>
              ) : (
                <>
                  <SaveIcon className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : readOnly ? 'Read-only' : 'Save'}
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* Monaco Editor or Connection States */}
      <div className="flex-1 overflow-hidden">
        {/* Connection states for edit mode (not insert mode) */}
        {!isInsertMode && !isConnected && !isConnecting ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4">
            <svg className="w-12 h-12 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <span>Not connected to database</span>
            <button
              onClick={() => connect(connectionId)}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium"
            >
              Connect
            </button>
          </div>
        ) : !isInsertMode && isConnecting ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
            <div className="spinner" />
            <span>Connecting to database...</span>
          </div>
        ) : !isInsertMode && documentNotFound ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4">
            <svg className="w-12 h-12 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Document not found</span>
            <p className="text-sm text-text-dim">The document may have been deleted</p>
          </div>
        ) : !isInsertMode && loadingDocument ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
            <div className="spinner" />
            <span>Loading document...</span>
          </div>
        ) : !isInsertMode && !effectiveDocument ? (
          // Connected but document not loaded yet (restored session or connection was restored externally)
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4">
            <svg className="w-12 h-12 text-text-dim" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>{isRestoredTab ? 'Session restored' : 'Document not loaded'}</span>
            <p className="text-sm text-text-dim">Click Load to fetch document from database</p>
            <button
              onClick={loadDocument}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium flex items-center gap-2"
            >
              <RefreshIcon className="w-4 h-4" />
              Load Document
            </button>
          </div>
        ) : (
          <MonacoErrorBoundary value={content} onChange={(value: string) => setContent(value || '')} readOnly={(isInsertMode && saving) || isViewMode}>
            <Editor
              height="100%"
              language="json"
              theme="mongopal-dark"
              value={content}
              onChange={(value: string | undefined) => { if (!isViewMode) setContent(value || '') }}
              onMount={handleEditorDidMount}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                folding: true,
                renderWhitespace: 'selection',
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                formatOnPaste: true,
                readOnly: isViewMode,
              }}
            />
          </MonacoErrorBoundary>
        )}
      </div>

      {/* Refresh confirmation dialog */}
      <ConfirmDialog
        open={showRefreshConfirm}
        title="Discard Changes?"
        message="You have unsaved changes. Refreshing will discard them."
        confirmLabel="Refresh"
        cancelLabel="Cancel"
        danger={true}
        onConfirm={() => {
          setShowRefreshConfirm(false)
          doRefresh()
        }}
        onCancel={() => setShowRefreshConfirm(false)}
      />
    </div>
  )
}
