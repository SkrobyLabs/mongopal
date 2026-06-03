import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  LegacyRef,
} from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, editor } from 'monaco-editor'
import TableView from './TableView'
import BulkActionBar from './BulkActionBar'
import ActionableError from './ActionableError'
import DocumentDiffView from './DocumentDiffView'
import ExplainPanel from './ExplainPanel'
import CollectionExportButton from './CollectionExportButton'
import MonacoErrorBoundary from './MonacoErrorBoundary'
import SavedQueriesDropdown from './SavedQueriesDropdown'
import SaveQueryModal from './SaveQueryModal'
import SavedQueriesManager from './SavedQueriesManager'
import ColumnVisibilityDropdown from './ColumnVisibilityDropdown'
import { loadSettings, AppSettings } from './Settings'
import { useConnection } from './contexts/ConnectionContext'
import { useTab } from './contexts/TabContext'
// Debug context is used by extracted hooks (useQueryExecution)
import { loadHiddenColumns, saveHiddenColumns, MongoDocument } from '../utils/tableViewUtils'
import { parseFilterFromQuery, buildFullQuery, isSimpleFindQuery } from '../utils/queryParser'
import { validateQuery, toMonacoMarkers, QueryDiagnostic, MonacoInstance } from '../utils/queryValidator'
import { validateFilter, fieldWarningsToMonacoDiagnostics, FieldWarning, MonacoDiagnostic } from '../utils/fieldValidator'
import { createQueryCompletionProvider } from '../utils/queryCompletionProvider'
import { useEditorLayout } from '../hooks/useEditorLayout'
import { useQueryHistory, QueryHistoryItem } from '../hooks/useQueryHistory'
import { useQueryExecution } from '../hooks/useQueryExecution'
import { useBulkActions } from '../hooks/useBulkActions'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Props for CollectionView component
 */
export interface CollectionViewProps {
  /** Connection ID this view is associated with */
  connectionId: string
  /** Database name */
  database: string
  /** Collection name */
  collection: string
  /** Tab ID for this view */
  tabId: string
  /** Whether this tab was restored from session */
  restored?: boolean
}

/**
 * View mode options for document display
 */
type ViewMode = 'table' | 'json' | 'explain'

/**
 * Props for icon components
 */
interface IconProps {
  className?: string
}

/**
 * Props for QueryHistoryDropdown component
 */
interface QueryHistoryDropdownProps {
  queryHistory: QueryHistoryItem[]
  onSelect: (query: string) => void
  onClose: () => void
  historyRef: LegacyRef<HTMLDivElement>
}

/**
 * Monaco language info interface for type safety
 */
interface MonacoLanguageInfo {
  id: string
}

// =============================================================================
// Icon Components
// =============================================================================

const PlayIcon = ({ className = 'w-4 h-4' }: IconProps): ReactNode => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
)

const StopIcon = ({ className = 'w-4 h-4' }: IconProps): ReactNode => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
    />
  </svg>
)

const HistoryIcon = ({ className = 'w-4 h-4' }: IconProps): ReactNode => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
)

const PlusIcon = ({ className = 'w-4 h-4' }: IconProps): ReactNode => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const SaveIcon = ({ className = 'w-4 h-4' }: IconProps): ReactNode => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
    />
  </svg>
)

// =============================================================================
// QueryHistoryDropdown Component
// =============================================================================

function QueryHistoryDropdown({
  queryHistory,
  onSelect,
  onClose,
  historyRef,
}: QueryHistoryDropdownProps): ReactNode {
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [filterText, setFilterText] = useState<string>('')
  const filterInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter history based on search text
  const filteredHistory = useMemo(() => {
    if (!filterText.trim()) return queryHistory
    const lowerFilter = filterText.toLowerCase()
    return queryHistory.filter(
      (item) =>
        item.query.toLowerCase().includes(lowerFilter) ||
        item.collection.toLowerCase().includes(lowerFilter)
    )
  }, [queryHistory, filterText])

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(filteredHistory.length > 0 ? 0 : -1)
  }, [filterText, filteredHistory.length])

  // Focus filter input when dropdown opens
  useEffect(() => {
    if (filterInputRef.current) {
      filterInputRef.current.focus()
    }
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-history-item]')
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((prev) => (prev < filteredHistory.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < filteredHistory.length) {
          onSelect(filteredHistory[highlightedIndex].query)
          onClose()
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      ref={historyRef}
      className="absolute right-0 top-full mt-1 w-[500px] bg-surface border border-border rounded-lg shadow-xl z-[100] flex flex-col max-h-72 isolate"
      onKeyDown={handleKeyDown}
    >
      {/* Filter input */}
      <div className="flex-shrink-0 p-2 border-b border-border">
        <input
          ref={filterInputRef}
          type="text"
          className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm text-text-light placeholder-text-dim focus:outline-none focus:border-border-light"
          placeholder="Type to filter history..."
          value={filterText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setFilterText(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
      {/* History list */}
      <div ref={listRef} className="flex-1 overflow-auto">
        {filteredHistory.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-dim">
            {queryHistory.length === 0 ? 'No query history' : 'No matching queries'}
          </div>
        ) : (
          filteredHistory.map((item, idx) => (
            <button
              key={idx}
              data-history-item
              className={`w-full px-3 py-2 text-left border-b border-border last:border-0 transition-colors ${
                idx === highlightedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'
              }`}
              onClick={() => {
                onSelect(item.query)
                onClose()
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
            >
              <div className="font-mono text-sm text-text-light truncate">{item.query}</div>
              <div className="text-xs text-text-dim">{item.collection}</div>
            </button>
          ))
        )}
      </div>
      {/* Keyboard hints */}
      <div className="flex-shrink-0 px-3 py-1.5 border-t border-border text-xs text-text-dim flex gap-3">
        <span>
          <kbd className="px-1 py-0.5 bg-surface-hover rounded text-text-muted">up/down</kbd> navigate
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-surface-hover rounded text-text-muted">Enter</kbd> select
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-surface-hover rounded text-text-muted">Esc</kbd> close
        </span>
      </div>
    </div>
  )
}

// =============================================================================
// Main CollectionView Component
// =============================================================================

export default function CollectionView({
  connectionId,
  database,
  collection,
  tabId,
  restored,
}: CollectionViewProps): ReactNode {
  const { connect } = useConnection()
  const { openDocumentTab, openViewDocumentTab, openInsertTab, markTabActivated } = useTab()

  // --- Extracted Hooks ---

  const queryExec = useQueryExecution({
    connectionId,
    database,
    collection,
    tabId,
    restored,
  })

  const {
    showHistory,
    setShowHistory,
    historyRef,
  } = useQueryHistory({ connectionId, database, collection })

  const { editorHeight, resizerProps } = useEditorLayout({ storageKey: 'mongopal_editor_height' })

  const bulkActions = useBulkActions({
    connectionId,
    database,
    collection,
    documents: queryExec.documents,
    onRefresh: queryExec.executeQuery,
    query: queryExec.query,
    skip: queryExec.skip,
    limit: queryExec.limit,
  })

  // --- Remaining local state ---

  const [viewMode, setViewMode] = useState<ViewMode>('table')

  // Monaco editor refs
  const monacoRef = useRef<MonacoInstance | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const validationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullMonacoRef = useRef<any>(null)
  const completionDisposableRef = useRef<{ dispose(): void } | null>(null)

  // Saved queries state
  const [showSaveQueryModal, setShowSaveQueryModal] = useState<boolean>(false)
  const [showSavedQueriesManager, setShowSavedQueriesManager] = useState<boolean>(false)
  const [savedQueriesRefreshKey, setSavedQueriesRefreshKey] = useState<number>(0)

  // Hidden columns state - persisted per collection
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() =>
    loadHiddenColumns(connectionId, database, collection)
  )
  // Track all available columns (for showing in visibility dropdown even when hidden)
  const columnCapAppliedRef = useRef<string>('')

  // Update hidden columns when collection changes
  useEffect(() => {
    setHiddenColumns(loadHiddenColumns(connectionId, database, collection))
  }, [connectionId, database, collection])

  // Handle hidden columns change
  const handleHiddenColumnsChange = useCallback(
    (newHiddenColumns: Set<string>) => {
      setHiddenColumns(newHiddenColumns)
      saveHiddenColumns(connectionId, database, collection, newHiddenColumns)
    },
    [connectionId, database, collection]
  )

  // Toggle single column visibility (for dropdown)
  const handleToggleColumn = useCallback(
    (column: string) => {
      const newHidden = new Set(hiddenColumns)
      if (newHidden.has(column)) {
        newHidden.delete(column)
      } else {
        newHidden.add(column)
      }
      handleHiddenColumnsChange(newHidden)
    },
    [hiddenColumns, handleHiddenColumnsChange]
  )

  // Show all columns (for dropdown "Show All" button)
  const handleShowAllColumns = useCallback(() => {
    handleHiddenColumnsChange(new Set())
  }, [handleHiddenColumnsChange])

  // Hide all columns (for dropdown "Hide All" button, LDH-07)
  const handleHideAllColumns = useCallback(
    (columns: string[]) => {
      handleHiddenColumnsChange(new Set(columns))
    },
    [handleHiddenColumnsChange]
  )

  // Columns for the visibility dropdown
  const dropdownColumns = queryExec.allAvailableColumns

  // Column count for the always-visible indicator
  const columnCountInfo = useMemo(() => {
    if (queryExec.allAvailableColumns.length === 0) return null
    const effectiveHidden = queryExec.allAvailableColumns.filter((col) => hiddenColumns.has(col)).length
    if (effectiveHidden === 0) return null
    return { visible: queryExec.allAvailableColumns.length - effectiveHidden, total: queryExec.allAvailableColumns.length }
  }, [queryExec.allAvailableColumns, hiddenColumns])

  // Auto-hide columns beyond the cap when new data arrives (LDH-02)
  useEffect(() => {
    if (queryExec.allAvailableColumns.length === 0) return
    const collKey = `${connectionId}/${database}/${collection}`
    if (columnCapAppliedRef.current === collKey) return
    columnCapAppliedRef.current = collKey

    const settings: AppSettings = loadSettings()
    const maxVisible = settings.ldhMaxVisibleColumns || 30
    const visibleCount = queryExec.allAvailableColumns.filter((col) => !hiddenColumns.has(col)).length
    if (visibleCount > maxVisible) {
      const newHidden = new Set(hiddenColumns)
      let shown = 0
      for (const col of queryExec.allAvailableColumns) {
        if (newHidden.has(col)) continue
        shown++
        if (shown > maxVisible) {
          newHidden.add(col)
        }
      }
      handleHiddenColumnsChange(newHidden)
    }
  }, [queryExec.allAvailableColumns, hiddenColumns, connectionId, database, collection, handleHiddenColumnsChange])

  // Reset column cap when collection changes
  useEffect(() => {
    columnCapAppliedRef.current = ''
  }, [connectionId, database, collection])

  // Memoize JSON stringified documents for JSON view with size guard (LDH-06)
  const documentsJson = useMemo(() => {
    const MAX_JSON_VIEW_BYTES = 5 * 1024 * 1024 // 5 MB
    const json = JSON.stringify(queryExec.documents, null, 2)
    if (json.length > MAX_JSON_VIEW_BYTES) {
      return json.slice(0, MAX_JSON_VIEW_BYTES) + '\n\n// ... Truncated (showing first 5 MB of ' + (json.length / 1024 / 1024).toFixed(1) + ' MB). Use table view for full navigation.'
    }
    return json
  }, [queryExec.documents])

  // Field validation warnings (computed from query and schema)
  const fieldWarnings = useMemo<FieldWarning[]>(() => {
    if (!isSimpleFindQuery(queryExec.query)) return []
    const schemaFields = queryExec.getFieldNames(connectionId, database, collection)
    if (!schemaFields || schemaFields.size === 0) return []
    const filter = parseFilterFromQuery(queryExec.query)
    return validateFilter(filter, schemaFields)
  }, [queryExec.query, connectionId, database, collection, queryExec.getFieldNames])

  // Debounced query validation for Monaco editor
  useEffect(() => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current)
    }

    if (!monacoRef.current || !editorRef.current) {
      return
    }

    validationTimeoutRef.current = setTimeout(() => {
      const model = editorRef.current?.getModel()
      if (!model || !monacoRef.current) return

      const syntaxDiagnostics = validateQuery(queryExec.query)
      const fieldDiagnostics = fieldWarningsToMonacoDiagnostics(queryExec.query, fieldWarnings)
      const allDiagnostics: (QueryDiagnostic | MonacoDiagnostic)[] = [...syntaxDiagnostics, ...fieldDiagnostics]
      const markers = toMonacoMarkers(monacoRef.current, allDiagnostics as QueryDiagnostic[])

      ;(monacoRef.current as unknown as { editor: typeof MonacoEditor }).editor.setModelMarkers(
        model,
        'queryValidator',
        markers
      )
    }, 300)

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current)
      }
    }
  }, [queryExec.query, fieldWarnings])

  // Register query completion provider (re-registers when collection changes)
  useEffect(() => {
    if (!fullMonacoRef.current) return
    completionDisposableRef.current?.dispose()
    const provider = createQueryCompletionProvider({
      getSchema: () => queryExec.getCachedSchema(connectionId, database, collection),
      getFieldNames: () => queryExec.getFieldNames(connectionId, database, collection),
    })
    completionDisposableRef.current = fullMonacoRef.current.languages.registerCompletionItemProvider(
      'mongoquery',
      provider
    )
    return () => { completionDisposableRef.current?.dispose() }
  }, [connectionId, database, collection, queryExec.getCachedSchema, queryExec.getFieldNames])

  // Helper to open insert tab
  const handleInsertDocument = useCallback((): void => {
    openInsertTab(connectionId, database, collection)
  }, [openInsertTab, connectionId, database, collection])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      // Cmd+N: Open insert tab
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleInsertDocument()
      }
      // Escape: Close modals
      if (e.key === 'Escape') {
        if (bulkActions.showBulkDeleteModal && !bulkActions.bulkDeleting) {
          bulkActions.setShowBulkDeleteModal(false)
        } else if (bulkActions.deleteDoc && !bulkActions.deleting) {
          bulkActions.setDeleteDoc(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    bulkActions.showBulkDeleteModal,
    bulkActions.bulkDeleting,
    bulkActions.deleteDoc,
    bulkActions.deleting,
    handleInsertDocument,
    bulkActions,
  ])

  // Open document in a new tab
  const handleEdit = useCallback(
    (doc: MongoDocument): void => {
      const docId = bulkActions.getDocIdForApi(doc)
      if (docId) {
        openDocumentTab(connectionId, database, collection, doc, docId)
      }
    },
    [bulkActions.getDocIdForApi, openDocumentTab, connectionId, database, collection, bulkActions]
  )

  // Open document in view-only mode
  const handleView = useCallback(
    (doc: MongoDocument): void => {
      const docId = bulkActions.getDocIdForApi(doc)
      if (docId) {
        openViewDocumentTab(connectionId, database, collection, doc, docId)
      }
    },
    [bulkActions.getDocIdForApi, openViewDocumentTab, connectionId, database, collection, bulkActions]
  )

  // Monaco editor mount handlers
  const handleEditorBeforeMount: BeforeMount = useCallback((monaco) => {
    if (!monaco.languages.getLanguages().some((lang: MonacoLanguageInfo) => lang.id === 'mongoquery')) {
      monaco.languages.register({ id: 'mongoquery' })

      monaco.languages.setMonarchTokensProvider('mongoquery', {
        defaultToken: '',
        tokenPostfix: '.mongoquery',
        keywords: ['db', 'true', 'false', 'null', 'new', 'Date', 'ObjectId', 'ISODate', 'NumberInt', 'NumberLong', 'NumberDecimal', 'UUID', 'Timestamp'],
        operators: [
          '=',
          '>',
          '<',
          '!',
          '~',
          '?',
          ':',
          '==',
          '<=',
          '>=',
          '!=',
          '&&',
          '||',
          '+',
          '-',
          '*',
          '/',
          '&',
          '|',
          '^',
          '%',
        ],
        symbols: /[=><!~?&|+\-*^%]+/,
        escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
        tokenizer: {
          root: [
            [/\$[a-zA-Z_][a-zA-Z0-9_]*/, 'keyword.operator'],
            [
              /[a-zA-Z_][a-zA-Z0-9_]*/,
              {
                cases: {
                  '@keywords': 'keyword',
                  '@default': 'identifier',
                },
              },
            ],
            { include: '@whitespace' },
            [/[{}()[\]]/, '@brackets'],
            [/:/, 'delimiter'],
            [/[<>](?!@symbols)/, '@brackets'],
            // Regex literal: / not followed by / or * (those are comments)
            [/\/(?![/*])/, { token: 'regexp.slash', bracket: '@open', next: '@regexp' }],
            [
              /@symbols/,
              {
                cases: {
                  '@operators': 'operator',
                  '@default': '',
                },
              },
            ],
            [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            [/\d+/, 'number'],
            [/[;,.]/, 'delimiter'],
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/"/, { token: 'string.quote', bracket: '@open', next: '@string_double' }],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/'/, { token: 'string.quote', bracket: '@open', next: '@string_single' }],
          ],
          string_double: [
            [/[^\\"]+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
          ],
          string_single: [
            [/[^\\']+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/'/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
          ],
          regexp: [
            [/[^/\\]+/, 'regexp'],
            [/\\./, 'regexp.escape'],
            [/\/[gimsuy]*/, { token: 'regexp.slash', bracket: '@close', next: '@pop' }],
          ],
          whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\*/, 'comment', '@comment'],
            [/\/\/.*$/, 'comment'],
          ],
          comment: [
            [/[^/*]+/, 'comment'],
            [/\/\*/, 'comment', '@push'],
            ['\\*/', 'comment', '@pop'],
            [/[/*]/, 'comment'],
          ],
        },
      })
    }
  }, [])

  const handleEditorMount: OnMount = useCallback(
    (editorInstance, monaco) => {
      editorRef.current = editorInstance
      monacoRef.current = monaco as unknown as MonacoInstance
      fullMonacoRef.current = monaco

      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => queryExec.executeQuery())

      const model = editorInstance.getModel()
      if (model && monacoRef.current) {
        const syntaxDiagnostics = validateQuery(queryExec.query)
        const fieldDiagnostics = fieldWarningsToMonacoDiagnostics(queryExec.query, fieldWarnings)
        const allDiagnostics: (QueryDiagnostic | MonacoDiagnostic)[] = [...syntaxDiagnostics, ...fieldDiagnostics]
        const markers = toMonacoMarkers(monacoRef.current, allDiagnostics as QueryDiagnostic[])
        monaco.editor.setModelMarkers(model, 'queryValidator', markers)
      }
    },
    [queryExec.executeQuery, queryExec.query, fieldWarnings]
  )

  return (
    <div className="h-full flex flex-col">
      {/* Query bar - overflow-visible for dropdown */}
      <div className="flex-shrink-0 p-2 border-b border-border bg-surface-secondary overflow-visible">
        <div className="flex flex-col gap-2">
          {/* Buttons row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {queryExec.loading ? (
                <button
                  className="btn btn-secondary flex items-center gap-1.5 text-error hover:text-red-300"
                  onClick={queryExec.cancelQuery}
                >
                  <StopIcon className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  className={`btn btn-primary flex items-center gap-1.5 ${
                    !queryExec.isConnected ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  onClick={() => {
                    if (!queryExec.isConnected) return
                    if (queryExec.isRestoredTab) {
                      markTabActivated(tabId)
                      queryExec.setIsRestoredTab(false)
                    } else {
                      queryExec.executeQuery()
                    }
                  }}
                  disabled={!queryExec.isConnected}
                  title={!queryExec.isConnected ? 'Connect to database first' : 'Run query (Cmd+Enter)'}
                >
                  <PlayIcon className="w-4 h-4" />
                  <span>Run</span>
                </button>
              )}
              <button
                className={`btn btn-secondary flex items-center gap-1.5 ${
                  queryExec.readOnly || !queryExec.isConnected ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                onClick={handleInsertDocument}
                disabled={queryExec.readOnly || !queryExec.isConnected}
                title={queryExec.readOnly ? 'Read-only mode' : 'Insert new document (Cmd+N)'}
              >
                <PlusIcon className="w-4 h-4" />
                <span>Insert</span>
              </button>
            </div>
            <div className="flex items-center gap-1 overflow-visible">
              <SavedQueriesDropdown
                connectionId={connectionId}
                database={database}
                collection={collection}
                onSelectQuery={(q: string) => queryExec.setQuery(buildFullQuery(collection, q))}
                onManageQueries={() => setShowSavedQueriesManager(true)}
                refreshTrigger={savedQueriesRefreshKey}
              />
              <button
                className="icon-btn p-1.5 hover:bg-surface-hover text-text-muted hover:text-primary"
                onClick={() => setShowSaveQueryModal(true)}
                title="Save current query"
              >
                <SaveIcon className="w-4 h-4" />
              </button>
              <div className="relative z-40">
                <button
                  className="icon-btn p-1.5 hover:bg-surface-hover text-text-muted hover:text-text-light"
                  onClick={() => setShowHistory(!showHistory)}
                  title="Query history"
                >
                  <HistoryIcon className="w-4 h-4" />
                </button>
                {showHistory && (
                  <QueryHistoryDropdown
                    queryHistory={queryExec.queryHistory}
                    onSelect={queryExec.setQuery}
                    onClose={() => setShowHistory(false)}
                    historyRef={historyRef}
                  />
                )}
              </div>
              <CollectionExportButton
                connectionId={connectionId}
                database={database}
                collection={collection}
                currentFilter={parseFilterFromQuery(queryExec.query)}
                disabled={!queryExec.isConnected}
              />
            </div>
          </div>
          {/* Monaco Editor with resizable height */}
          <div className="border border-border rounded overflow-visible">
            <Editor
              height={`${editorHeight}px`}
              defaultLanguage="mongoquery"
              theme="mongopal-dark"
              value={queryExec.query}
              onChange={(value) => queryExec.setQuery(value || '')}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'on',
                glyphMargin: true,
                folding: false,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 2,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 13,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
                padding: { top: 8, bottom: 8 },
                overviewRulerLanes: 1,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                fixedOverflowWidgets: true,
                hover: { enabled: true, delay: 300 },
                quickSuggestions: { other: true, comments: false, strings: true },
                suggestOnTriggerCharacters: true,
                codeLens: false,
                lightbulb: { enabled: 'off' as unknown as editor.ShowLightbulbIconMode },
                inlayHints: { enabled: 'off' as 'off' | 'on' | 'offUnlessPressed' | 'onUnlessPressed' },
                links: false,
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'hidden',
                  verticalScrollbarSize: 8,
                },
              }}
              beforeMount={handleEditorBeforeMount}
              onMount={handleEditorMount}
            />
          </div>
          {/* Resize handle */}
          <div
            className="h-1.5 cursor-ns-resize bg-transparent hover:bg-surface-active transition-colors -mt-1 rounded-b"
            {...resizerProps}
            title="Drag to resize editor"
          />
        </div>
      </div>

      {/* Read-only indicator */}
      {queryExec.readOnly && (
        <div className="flex-shrink-0 px-3 py-1 bg-warning-dark/20 border-b border-amber-800 text-warning text-xs flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-10V4a1 1 0 00-1-1H9a1 1 0 00-1 1v3M5 8h14M5 8a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V10a2 2 0 00-2-2M5 8V6a2 2 0 012-2h2"
            />
          </svg>
          Read-only mode - Write operations are disabled for this connection
        </div>
      )}

      {/* View mode tabs and info */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface text-sm">
        <div className="flex items-center gap-3">
          <div className="flex gap-1" role="tablist" aria-label="View mode">
            {(['table', 'json', 'explain'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                className={`view-mode-btn px-2 py-1 rounded text-xs capitalize ${
                  viewMode === mode
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:text-text-light hover:bg-surface'
                } ${mode === 'explain' && queryExec.explaining ? 'animate-pulse' : ''} ${mode === 'explain' && !queryExec.isConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => {
                  if (mode === 'explain') {
                    if (!queryExec.isConnected) return
                    setViewMode('explain')
                    queryExec.explainQuery()
                  } else {
                    setViewMode(mode)
                  }
                }}
                disabled={mode === 'explain' && !queryExec.isConnected}
                role="tab"
                aria-selected={viewMode === mode}
              >
                {mode}
              </button>
            ))}
          </div>

          {queryExec.queryTime !== null && (
            <span className="text-text-muted text-xs">Query: {queryExec.queryTime}ms</span>
          )}
        </div>

        {/* Pagination controls — hidden in explain mode */}
        <div
          className={`flex items-center gap-2 text-text-muted text-xs ${
            queryExec.paginationResetHighlight ? 'pagination-reset-highlight' : ''
          } ${viewMode === 'explain' ? 'invisible' : ''}`}
        >
          {/* Page size selector */}
          <select
            className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-text-secondary"
            value={queryExec.userLimit}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const newLimit = parseInt(e.target.value, 10)
              queryExec.setUserLimit(newLimit)
              queryExec.setSkip(0)
            }}
          >
            {queryExec.hasLargeDocWarning && (
              <>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={5}>5</option>
              </>
            )}
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span>per page</span>

          <span className="mx-1 text-text-dim">|</span>

          <span>
            {queryExec.total > 0 ? `${queryExec.skip + 1}-${Math.min(queryExec.skip + queryExec.limit, queryExec.total)}` : '0'} of {queryExec.total}
          </span>

          <span className="mx-1 text-text-dim">|</span>

          {/* Navigation buttons */}
          <div className="flex gap-0.5">
            <button
              className="pagination-btn px-1.5 py-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => queryExec.setSkip(0)}
              disabled={queryExec.skip === 0}
              title="First page"
            >
              &#xAB;&#xAB;
            </button>
            <button
              className="pagination-btn px-1.5 py-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => queryExec.setSkip(Math.max(0, queryExec.skip - queryExec.limit))}
              disabled={queryExec.skip === 0}
              title="Previous page"
            >
              &#xAB;
            </button>

            {/* Page number input */}
            <div className="flex items-center gap-1 mx-1">
              <input
                type="text"
                className="w-10 px-1.5 py-0.5 bg-surface border border-border rounded text-center text-xs"
                value={queryExec.goToPage || queryExec.currentPage}
                onChange={(e: ChangeEvent<HTMLInputElement>) => queryExec.setGoToPage(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') {
                    const page = parseInt(queryExec.goToPage, 10)
                    if (page >= 1 && page <= queryExec.totalPages) {
                      queryExec.setSkip((page - 1) * queryExec.limit)
                    }
                    queryExec.setGoToPage('')
                  }
                }}
                onBlur={() => queryExec.setGoToPage('')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <span>/ {queryExec.totalPages || 1}</span>
            </div>

            <button
              className="pagination-btn px-1.5 py-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => queryExec.setSkip(queryExec.skip + queryExec.limit)}
              disabled={queryExec.skip + queryExec.limit >= queryExec.total}
              title="Next page"
            >
              &#xBB;
            </button>
            <button
              className="pagination-btn px-1.5 py-0.5 rounded hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => queryExec.setSkip((queryExec.totalPages - 1) * queryExec.limit)}
              disabled={queryExec.skip + queryExec.limit >= queryExec.total}
              title="Last page"
            >
              &#xBB;&#xBB;
            </button>
          </div>

          {/* Column visibility toggle - only in table view */}
          {viewMode === 'table' && (
            <>
              <span className="mx-1 text-text-dim">|</span>
              {columnCountInfo && (
                <span className="text-xs text-text-muted">
                  {columnCountInfo.visible} / {columnCountInfo.total} columns
                </span>
              )}
              <ColumnVisibilityDropdown
                allColumns={dropdownColumns}
                hiddenColumns={hiddenColumns}
                onToggleColumn={handleToggleColumn}
                onShowAll={handleShowAllColumns}
                onHideAll={handleHideAllColumns}
              />
            </>
          )}
        </div>
      </div>

      {/* Error message */}
      {queryExec.error && (
        <div className="flex-shrink-0 px-3 py-2 border-b border-red-800">
          <ActionableError error={queryExec.error} onDismiss={() => queryExec.setError(null)} compact />
        </div>
      )}

      {/* Health check warning banner (LDH-01) */}
      {queryExec.healthWarnings.length > 0 && (
        <div className="flex-shrink-0 px-3 py-2 bg-warning-dark/20 border-b border-amber-800/50">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <div className="text-sm text-amber-300 font-medium">Large Collection Warning</div>
              {queryExec.healthWarnings.map((w, i) => (
                <div key={i} className="text-xs text-warning/80 mt-0.5">{w}</div>
              ))}
            </div>
            <button
              className="text-warning/60 hover:text-amber-300 p-0.5 flex-shrink-0"
              onClick={() => queryExec.setHealthWarningDismissed(true)}
              title="Dismiss warning for this session"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Auto-projection info bar (LDH-03) */}
      {queryExec.autoProjectionInfo && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-info-dark/20 border-b border-blue-800/40 flex items-center gap-2 text-xs">
          <svg className="w-3.5 h-3.5 text-info flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-blue-300">
            Showing {queryExec.autoProjectionInfo.fieldCount} of {queryExec.autoProjectionInfo.totalFields} fields (auto-projected). Edit the query to change.
          </span>
          <button
            className="text-info hover:text-blue-200 underline"
            onClick={queryExec.handleShowAllFields}
          >
            Show All Fields
          </button>
        </div>
      )}

      {/* Adaptive page size info (LDH-05) */}
      {queryExec.isAdaptive && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-info-dark/15 border-b border-blue-800/30 flex items-center gap-2 text-xs">
          <svg className="w-3.5 h-3.5 text-info flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-blue-300/80">{queryExec.adaptiveInfo}</span>
          <span className="text-text-dim">Adjust in pagination controls.</span>
        </div>
      )}

      {/* Response size warning (LDH-04) */}
      {queryExec.responseSizeWarning && (
        <div className="flex-shrink-0 px-3 py-2 bg-error-dark/20 border-b border-red-800/50">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-error mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="flex-1">
              <div className="text-sm text-red-300">
                Estimated response: ~{queryExec.responseSizeWarning.estimatedMB} MB for {queryExec.limit} documents. This may cause slowness.
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <button
                  className="px-2 py-1 text-xs bg-surface-hover hover:bg-surface-active text-text-light rounded"
                  onClick={() => {
                    queryExec.responseSizeBypassRef.current = true
                    queryExec.setResponseSizeWarning(null)
                    queryExec.executeQuery()
                  }}
                >
                  Continue Anyway
                </button>
                <button
                  className="px-2 py-1 text-xs bg-primary/20 hover:bg-primary/30 text-primary rounded"
                  onClick={() => {
                    queryExec.setResponseSizeWarning(null)
                    queryExec.setUserLimit(queryExec.responseSizeWarning!.suggestedPageSize)
                    queryExec.setSkip(0)
                  }}
                >
                  Reduce to {queryExec.responseSizeWarning.suggestedPageSize} docs
                </button>
                <button
                  className="px-2 py-1 text-xs text-text-muted hover:text-text-light"
                  onClick={() => queryExec.setResponseSizeWarning(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document list with bulk action bar overlay */}
      <div className="flex-1 overflow-auto relative">
        {/* Connection states */}
        {!queryExec.isConnected && !queryExec.isConnecting ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4">
            <svg
              className="w-12 h-12 text-text-dim"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
              />
            </svg>
            <span>Not connected to database</span>
            <button
              onClick={() => connect(connectionId)}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium"
            >
              Connect
            </button>
          </div>
        ) : queryExec.isConnecting ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
            <div className="spinner" />
            <span>Connecting to database...</span>
          </div>
        ) : queryExec.isRestoredTab && queryExec.documents.length === 0 && !queryExec.loading && !queryExec.error ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-4">
            <svg
              className="w-12 h-12 text-text-dim"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
              />
            </svg>
            <span>Session restored</span>
            <p className="text-sm text-text-dim">Click Run to execute query</p>
            <button
              onClick={() => {
                markTabActivated(tabId)
                queryExec.setIsRestoredTab(false)
              }}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-background rounded-lg font-medium flex items-center gap-2"
            >
              <PlayIcon className="w-4 h-4" />
              Run Query
            </button>
          </div>
        ) : queryExec.loading ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3">
            <div className="spinner" />
            <span>Loading documents...</span>
          </div>
        ) : viewMode === 'explain' ? (
          <ExplainPanel result={queryExec.explainResult} explaining={queryExec.explaining} />
        ) : queryExec.documents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted">
            <span>No documents found</span>
          </div>
        ) : viewMode === 'table' ? (
          <TableView
            documents={queryExec.documents}
            onView={handleView}
            onEdit={handleEdit}
            onDelete={bulkActions.handleDelete}
            selectedIds={bulkActions.selectedIds}
            onSelectionChange={bulkActions.setSelectedIds}
            onCompareSource={bulkActions.setCompareSourceDoc}
            onCompareTo={(doc: MongoDocument) => {
              bulkActions.setDiffTargetDoc(doc)
              bulkActions.setShowDiffView(true)
            }}
            compareSourceDoc={bulkActions.compareSourceDoc}
            readOnly={queryExec.readOnly}
            connectionId={connectionId}
            database={database}
            collection={collection}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={handleHiddenColumnsChange}
            allAvailableColumns={queryExec.allAvailableColumns}
          />
        ) : (
          <MonacoErrorBoundary>
            <Editor
              height="100%"
              language="json"
              theme="mongopal-dark"
              value={documentsJson}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                folding: true,
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </MonacoErrorBoundary>
        )}

        {/* Bulk Action Bar - positioned at bottom of scroll container */}
        {bulkActions.selectedIds.size > 0 && (
          <div className="sticky bottom-0 left-0 right-0 z-20">
            <BulkActionBar
              selectedCount={bulkActions.selectedIds.size}
              onClear={() => bulkActions.setSelectedIds(new Set())}
              onDelete={() => bulkActions.setShowBulkDeleteModal(true)}
              onExport={bulkActions.handleExport}
              isDeleting={bulkActions.bulkDeleting}
              isExporting={bulkActions.exporting}
            />
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {bulkActions.deleteDoc && (
        <div className="fixed inset-0 bg-black/70 z-50 p-[5%]">
          <div className="h-full w-full bg-surface border border-border rounded-lg flex flex-col shadow-2xl">
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <h3 className="text-lg font-medium text-text">Delete Document</h3>
              <p className="text-sm text-text-muted">
                {database} &gt; {collection}
              </p>
            </div>
            <div className="flex-1 p-4 overflow-auto select-text">
              <div className="mb-4">
                <p className="text-text-secondary mb-2">
                  This will execute the following delete operation:
                </p>
                <div className="bg-background border border-border rounded p-3 font-mono text-sm">
                  <span className="text-text-dim">db.</span>
                  <span className="text-warning">{collection}</span>
                  <span className="text-text-dim">.deleteOne(</span>
                  <span className="text-success">{'{ "_id": '}</span>
                  <span className="text-purple-400">
                    {bulkActions.formatIdForShell(bulkActions.getDocIdForApi(bulkActions.deleteDoc) || '')}
                  </span>
                  <span className="text-success">{' }'}</span>
                  <span className="text-text-dim">)</span>
                </div>
              </div>
              <div className="mb-4">
                <p className="text-text-muted mb-2 text-sm">Document to delete:</p>
                <pre className="bg-background border border-border rounded p-3 font-mono text-sm text-text-secondary overflow-auto max-h-[50vh]">
                  {JSON.stringify(bulkActions.deleteDoc, null, 2)}
                </pre>
              </div>
            </div>
            <div className="flex-shrink-0 px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => bulkActions.setDeleteDoc(null)}
                disabled={bulkActions.deleting}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                onClick={bulkActions.handleConfirmDelete}
                disabled={bulkActions.deleting}
              >
                {bulkActions.deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkActions.showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/70 z-50 p-[5%]">
          <div className="h-full w-full bg-surface border border-border rounded-lg flex flex-col shadow-2xl">
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <h3 className="text-lg font-medium text-text">
                Delete {bulkActions.selectedIds.size} Document{bulkActions.selectedIds.size !== 1 ? 's' : ''}
              </h3>
              <p className="text-sm text-text-muted">
                {database} &gt; {collection}
              </p>
            </div>
            <div className="flex-1 p-4 overflow-hidden flex flex-col">
              <p className="text-text-secondary mb-2 flex-shrink-0">
                This will execute the following delete operation:
              </p>
              <div className="bg-background border border-border rounded p-3 font-mono text-sm flex-1 overflow-auto mb-4">
                <span className="text-text-dim">db.</span>
                <span className="text-warning">{collection}</span>
                <span className="text-text-dim">.deleteMany(</span>
                <span className="text-success">{'{ "_id": { "$in": ['}</span>
                <br />
                {Array.from(bulkActions.selectedIds).map((id, idx) => (
                  <span key={id}>
                    <span className="text-text-dim"> </span>
                    <span className="text-purple-400">{bulkActions.formatIdForShell(id)}</span>
                    {idx < bulkActions.selectedIds.size - 1 && <span className="text-text-dim">,</span>}
                    <br />
                  </span>
                ))}
                <span className="text-success">{'] } }'}</span>
                <span className="text-text-dim">)</span>
              </div>

              {/* Progress indicator during deletion */}
              {bulkActions.bulkDeleting && (
                <div className="mb-4 flex-shrink-0">
                  <div className="flex items-center justify-between text-sm text-text-muted mb-2">
                    <span>Deleting documents...</span>
                    <span>
                      {bulkActions.bulkDeleteProgress.done} / {bulkActions.bulkDeleteProgress.total}
                    </span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{
                        width: `${(bulkActions.bulkDeleteProgress.done / bulkActions.bulkDeleteProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="bg-error-dark/20 border border-red-800 rounded p-3 text-error text-sm flex-shrink-0">
                This action cannot be undone. All selected documents will be permanently deleted.
              </div>
            </div>
            <div className="flex-shrink-0 px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => bulkActions.setShowBulkDeleteModal(false)}
                disabled={bulkActions.bulkDeleting}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                onClick={bulkActions.handleBulkDelete}
                disabled={bulkActions.bulkDeleting}
              >
                {bulkActions.bulkDeleting
                  ? `Deleting ${bulkActions.bulkDeleteProgress.done}/${bulkActions.bulkDeleteProgress.total}...`
                  : `Delete ${bulkActions.selectedIds.size} Document${bulkActions.selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Diff View */}
      {bulkActions.showDiffView && bulkActions.compareSourceDoc && bulkActions.diffTargetDoc && (
        <DocumentDiffView
          sourceDocument={bulkActions.compareSourceDoc}
          targetDocument={bulkActions.diffTargetDoc}
          onClose={() => {
            bulkActions.setShowDiffView(false)
            bulkActions.setDiffTargetDoc(null)
          }}
          onSwap={() => {
            const temp = bulkActions.compareSourceDoc
            bulkActions.setCompareSourceDoc(bulkActions.diffTargetDoc)
            bulkActions.setDiffTargetDoc(temp)
          }}
        />
      )}

      {/* Save Query Modal */}
      <SaveQueryModal
        isOpen={showSaveQueryModal}
        onClose={() => setShowSaveQueryModal(false)}
        connectionId={connectionId}
        database={database}
        collection={collection}
        query={parseFilterFromQuery(queryExec.query)}
        onSaved={() => setSavedQueriesRefreshKey((k) => k + 1)}
      />

      {/* Saved Queries Manager Modal */}
      <SavedQueriesManager
        isOpen={showSavedQueriesManager}
        onClose={() => setShowSavedQueriesManager(false)}
        connectionId={connectionId}
        database={database}
        collection={collection}
        onQuerySelected={(savedQuery: { collection: string; query: string }) => {
          queryExec.setQuery(buildFullQuery(savedQuery.collection, savedQuery.query))
        }}
        onQueriesChanged={() => setSavedQueriesRefreshKey((k) => k + 1)}
      />
    </div>
  )
}
