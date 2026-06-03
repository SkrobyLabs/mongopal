import { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  getDocId,
  formatValue as formatValueUtil,
  getRawValue,
  getNestedValue,
  extractColumns,
  columnHasExpandableObjects,
  getDefaultColumnWidth,
  MongoDocument,
  FormattedValue,
} from '../utils/tableViewUtils'
import { loadSettings, AppSettings } from './Settings'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Context menu state for document actions
 */
interface DocumentContextMenu {
  x: number
  y: number
  doc: MongoDocument
  cellKey: string | null
  cellValue: unknown
}

/**
 * Viewport-aware render position for document context menu
 */
interface MenuPlacement {
  left: number
  top: number
  maxHeight?: number
}

/**
 * Context menu state for header/column actions
 */
interface HeaderContextMenu {
  x: number
  y: number
  column: string
}

/**
 * Column resize tracking state
 */
interface ResizeState {
  column: string
  startX: number
  startWidth: number
}

/**
 * Column widths mapping
 */
interface ColumnWidths {
  [column: string]: number
}

/**
 * Storage structure for frozen/masked columns
 */
interface ColumnStorageData {
  [key: string]: string[]
}

/**
 * Props for icon components
 */
interface IconProps {
  className?: string
}

/**
 * Props for the TableView component
 */
export interface TableViewProps {
  /** Array of MongoDB documents to display */
  documents: MongoDocument[]
  /** Callback when viewing a document (read-only) */
  onView?: (doc: MongoDocument) => void
  /** Callback when editing a document */
  onEdit?: (doc: MongoDocument) => void
  /** Callback when deleting a document */
  onDelete?: (doc: MongoDocument) => void
  /** Set of selected document IDs */
  selectedIds?: Set<string>
  /** Callback when selection changes */
  onSelectionChange?: (ids: Set<string>) => void
  /** Callback to set compare source document */
  onCompareSource?: (doc: MongoDocument | null) => void
  /** Callback when selecting a compare target document */
  onCompareTo?: (doc: MongoDocument) => void
  /** Current compare source document */
  compareSourceDoc?: MongoDocument | null
  /** Whether the connection is in read-only mode */
  readOnly?: boolean
  /** Connection ID for persistence */
  connectionId?: string
  /** Database name for persistence */
  database?: string
  /** Collection name for persistence */
  collection?: string
  /** Set of hidden column names */
  hiddenColumns?: Set<string>
  /** Callback when hidden columns change */
  onHiddenColumnsChange?: (columns: Set<string>) => void
  /** All available columns (including hidden) */
  allAvailableColumns?: string[]
}

// =============================================================================
// Constants
// =============================================================================

// Virtual scrolling constants
const ROW_HEIGHT = 37 // Height of each row in pixels
const BUFFER_ROWS = 10 // Number of rows to render above/below viewport

// localStorage key for frozen columns per collection
const FROZEN_COLUMNS_KEY = 'mongopal-frozen-columns'

// localStorage key for masked columns per collection
const MASKED_COLUMNS_KEY = 'mongopal-masked-columns'

// Viewport margin used when clamping fixed-position menus
const MENU_VIEWPORT_MARGIN = 8


// Masked value display constant
const MASKED_VALUE_DISPLAY = '\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF' // 8 filled circles

// =============================================================================
// Storage Functions
// =============================================================================

/**
 * Load frozen columns from localStorage for a specific collection
 */
function loadFrozenColumns(connectionId: string, database: string, collection: string): Set<string> {
  try {
    const stored = localStorage.getItem(FROZEN_COLUMNS_KEY)
    if (stored) {
      const data: ColumnStorageData = JSON.parse(stored)
      const key = `${connectionId}:${database}:${collection}`
      return new Set(data[key] || [])
    }
  } catch (err) {
    console.error('Failed to load frozen columns:', err)
  }
  return new Set()
}

/**
 * Save frozen columns to localStorage for a specific collection
 */
function saveFrozenColumns(connectionId: string, database: string, collection: string, frozenColumns: Set<string>): void {
  try {
    const stored = localStorage.getItem(FROZEN_COLUMNS_KEY)
    const data: ColumnStorageData = stored ? JSON.parse(stored) : {}
    const key = `${connectionId}:${database}:${collection}`
    data[key] = Array.from(frozenColumns)
    localStorage.setItem(FROZEN_COLUMNS_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save frozen columns:', err)
  }
}

/**
 * Load masked columns from localStorage for a specific collection
 */
export function loadMaskedColumns(connectionId: string, database: string, collection: string): Set<string> {
  try {
    const stored = localStorage.getItem(MASKED_COLUMNS_KEY)
    if (stored) {
      const data: ColumnStorageData = JSON.parse(stored)
      const key = `${connectionId}:${database}:${collection}`
      return new Set(data[key] || [])
    }
  } catch (err) {
    console.error('Failed to load masked columns:', err)
  }
  return new Set()
}

/**
 * Save masked columns to localStorage for a specific collection
 */
export function saveMaskedColumns(connectionId: string, database: string, collection: string, maskedColumns: Set<string>): void {
  try {
    const stored = localStorage.getItem(MASKED_COLUMNS_KEY)
    const data: ColumnStorageData = stored ? JSON.parse(stored) : {}
    const key = `${connectionId}:${database}:${collection}`
    data[key] = Array.from(maskedColumns)
    localStorage.setItem(MASKED_COLUMNS_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save masked columns:', err)
  }
}

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * JSX wrapper for formatValue utility - renders with appropriate styling
 */
function formatValue(value: unknown): React.JSX.Element | string {
  const formatted: FormattedValue = formatValueUtil(value)

  switch (formatted.type) {
    case 'null':
    case 'undefined':
      return <span className="text-text-muted italic">{formatted.display}</span>
    case 'boolean':
      return <span className={formatted.boolValue ? 'text-success' : 'text-error'}>{formatted.display}</span>
    case 'number':
    case 'numberLong':
    case 'numberInt':
    case 'numberDouble':
      return <span className="text-info">{formatted.display}</span>
    case 'string':
      return formatted.display
    case 'array':
      return <span className="text-text-muted">{formatted.display}</span>
    case 'date':
      return <span className="text-purple-400">{formatted.display}</span>
    case 'objectId':
      return <span className="text-warning">{formatted.display}</span>
    case 'binary':
    case 'uuid':
      return <span className="text-cyan-400">{formatted.display}</span>
    case 'object':
      return <span className="text-text-muted">{formatted.display}</span>
    default:
      return formatted.display
  }
}

// =============================================================================
// Icon Components
// =============================================================================

const CopyIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
)

const EditIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
)

const TrashIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
)

const ExpandIcon = ({ className = "w-3 h-3" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

const CollapseIcon = ({ className = "w-3 h-3" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

const CheckIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const CompareIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
)

const CloseIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const FreezeIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v18m0-18l-3 3m3-3l3 3M15 3v18m0-18l-3 3m3-3l3 3" />
  </svg>
)

const UnfreezeIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
  </svg>
)

// EyeOffIcon used for both masking and hiding columns
const EyeOffIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
)
const EyeIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

// Alias for field masking feature
const MaskIcon = EyeOffIcon

const UnmaskIcon = ({ className = "w-4 h-4" }: IconProps): React.JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

// =============================================================================
// Main Component
// =============================================================================

export default function TableView({
  documents,
  onView,
  onEdit,
  onDelete,
  selectedIds = new Set<string>(),
  onSelectionChange = () => {},
  onCompareSource,
  onCompareTo,
  compareSourceDoc,
  readOnly = false,
  connectionId = '',
  database = '',
  collection = '',
  hiddenColumns = new Set<string>(),
  onHiddenColumnsChange = () => {},
  // allAvailableColumns is passed for future column picker UI but not currently used
  allAvailableColumns: _allAvailableColumns = [],
}: TableViewProps): React.JSX.Element {
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())
  const rawColumns = useMemo(() => extractColumns(documents, expandedColumns), [documents, expandedColumns])
  const [contextMenu, setContextMenu] = useState<DocumentContextMenu | null>(null)
  const [documentMenuPlacement, setDocumentMenuPlacement] = useState<MenuPlacement | null>(null)
  const [headerContextMenu, setHeaderContextMenu] = useState<HeaderContextMenu | null>(null)
  const [copiedField, setCopiedField] = useState<'value' | 'json' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Settings for sticky column
  const [settings] = useState<AppSettings>(() => loadSettings())

  // Frozen columns state - per collection persistence
  const [frozenColumns, setFrozenColumns] = useState<Set<string>>(() => {
    const loaded = loadFrozenColumns(connectionId, database, collection)
    // If settings say freeze _id and it's not already frozen, add it
    if (settings.freezeIdColumn && !loaded.has('_id')) {
      loaded.add('_id')
    }
    return loaded
  })

  // Reload frozen columns when collection changes
  useEffect(() => {
    const loaded = loadFrozenColumns(connectionId, database, collection)
    // If settings say freeze _id and it's not already frozen, add it
    if (settings.freezeIdColumn && !loaded.has('_id')) {
      loaded.add('_id')
    }
    setFrozenColumns(loaded)
  }, [connectionId, database, collection, settings.freezeIdColumn])

  // Masked columns state - per collection persistence
  const [maskedColumns, setMaskedColumns] = useState<Set<string>>(() => {
    return loadMaskedColumns(connectionId, database, collection)
  })

  // Reload masked columns when collection changes
  useEffect(() => {
    setMaskedColumns(loadMaskedColumns(connectionId, database, collection))
  }, [connectionId, database, collection])

  // Toggle mask on a column
  const toggleMaskColumn = useCallback((column: string): void => {
    setMaskedColumns(prev => {
      const next = new Set(prev)
      if (next.has(column)) {
        next.delete(column)
      } else {
        next.add(column)
      }
      saveMaskedColumns(connectionId, database, collection, next)
      return next
    })
  }, [connectionId, database, collection])

  // Column order state (in-memory only, resets on remount)
  const [columnOrder, setColumnOrder] = useState<string[]>([])

  // Column drag state
  const [dragColumn, setDragColumn] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Reset column order when collection changes
  useEffect(() => {
    setColumnOrder([])
  }, [connectionId, database, collection])

  // Reorder columns: filter out hidden, apply custom order, then put frozen first (LDH-02)
  const columns = useMemo(() => {
    const visible = rawColumns.filter(col => !hiddenColumns.has(col))
    // Apply custom column order if set
    let ordered = visible
    if (columnOrder.length > 0) {
      const orderIndex = new Map(columnOrder.map((col, i) => [col, i]))
      ordered = [...visible].sort((a, b) => {
        const ai = orderIndex.get(a) ?? Infinity
        const bi = orderIndex.get(b) ?? Infinity
        if (ai === Infinity && bi === Infinity) return 0
        return ai - bi
      })
    }
    const frozen = ordered.filter(col => frozenColumns.has(col))
    const unfrozen = ordered.filter(col => !frozenColumns.has(col))
    return [...frozen, ...unfrozen]
  }, [rawColumns, frozenColumns, hiddenColumns, columnOrder])

  // Memoize columnHasExpandableObjects into a Map (LDH-02)
  const expandableColumnsMap = useMemo(() => {
    const map = new Map<string, boolean>()
    columns.forEach(col => {
      map.set(col, columnHasExpandableObjects(documents, col))
    })
    return map
  }, [columns, documents])

  // Toggle freeze on a column
  const toggleFreezeColumn = useCallback((column: string): void => {
    setFrozenColumns(prev => {
      const next = new Set(prev)
      if (next.has(column)) {
        next.delete(column)
      } else {
        next.add(column)
      }
      saveFrozenColumns(connectionId, database, collection, next)
      return next
    })
  }, [connectionId, database, collection])

  // Hide a column
  const hideColumn = useCallback((column: string): void => {
    const next = new Set(hiddenColumns)
    next.add(column)
    onHiddenColumnsChange(next)
  }, [hiddenColumns, onHiddenColumnsChange])

  // Column drag-reorder handlers
  const handleColumnDragStart = useCallback((e: React.DragEvent<HTMLTableCellElement>, col: string) => {
    setDragColumn(col)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', col)
  }, [])

  const handleColumnDragOver = useCallback((e: React.DragEvent<HTMLTableCellElement>, col: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (col !== dragColumn) {
      setDropTarget(col)
    }
  }, [dragColumn])

  const handleColumnDrop = useCallback((e: React.DragEvent<HTMLTableCellElement>, targetCol: string) => {
    e.preventDefault()
    if (!dragColumn || dragColumn === targetCol) {
      setDragColumn(null)
      setDropTarget(null)
      return
    }
    // Build new order from current columns
    const newOrder = columns.filter(c => c !== dragColumn)
    const targetIndex = newOrder.indexOf(targetCol)
    newOrder.splice(targetIndex, 0, dragColumn)
    setColumnOrder(newOrder)
    setDragColumn(null)
    setDropTarget(null)
  }, [dragColumn, columns])

  const handleColumnDragEnd = useCallback(() => {
    setDragColumn(null)
    setDropTarget(null)
  }, [])

  // Virtual scrolling state
  const [scrollTop, setScrollTop] = useState<number>(0)
  const [containerHeight, setContainerHeight] = useState<number>(0)

  // Column resizing state
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>({})
  const resizingRef = useRef<ResizeState | null>(null)

  // Calculate virtual scrolling bounds
  const totalHeight = documents.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS)
  const endIndex = Math.min(
    documents.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS
  )
  const visibleDocuments = documents.slice(startIndex, endIndex)
  const offsetY = startIndex * ROW_HEIGHT

  // Update container height on mount and resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateHeight = (): void => {
      setContainerHeight(container.clientHeight)
    }

    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  // Handle scroll for virtual scrolling
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // Initialize column widths based on type and name
  useEffect(() => {
    const defaultWidths: ColumnWidths = {}
    columns.forEach(col => {
      if (!columnWidths[col]) {
        defaultWidths[col] = getDefaultColumnWidth(col, documents)
      }
    })
    if (Object.keys(defaultWidths).length > 0) {
      setColumnWidths(prev => ({ ...prev, ...defaultWidths }))
    }
  }, [columns, documents])

  // Handle column resize
  const handleResizeStart = useCallback((e: ReactMouseEvent<HTMLDivElement>, column: string): void => {
    e.preventDefault()
    resizingRef.current = {
      column,
      startX: e.clientX,
      startWidth: columnWidths[column] || 150
    }
    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [columnWidths])

  const handleResizeMove = useCallback((e: globalThis.MouseEvent): void => {
    if (!resizingRef.current) return
    const { column, startX, startWidth } = resizingRef.current
    const diff = e.clientX - startX
    const newWidth = Math.max(60, startWidth + diff)
    setColumnWidths(prev => ({ ...prev, [column]: newWidth }))
  }, [])

  const handleResizeEnd = useCallback((): void => {
    resizingRef.current = null
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
  }, [handleResizeMove])

  // Cleanup resize listeners on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // If component unmounts during resize, clean up listeners
      if (resizingRef.current) {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        resizingRef.current = null
      }
    }
  }, [handleResizeMove, handleResizeEnd])

  // Toggle column expansion
  const toggleColumnExpansion = useCallback((columnPath: string): void => {
    setExpandedColumns(prev => {
      const next = new Set(prev)
      if (next.has(columnPath)) {
        // Collapse: remove this column and all sub-columns
        next.delete(columnPath)
        // Also remove any sub-expanded columns
        for (const col of prev) {
          if (col.startsWith(columnPath + '.')) {
            next.delete(col)
          }
        }
      } else {
        next.add(columnPath)
      }
      return next
    })
  }, [])

  // Check if column is expanded
  const isColumnExpanded = (columnPath: string): boolean => expandedColumns.has(columnPath)

  // Check if this is a sub-column (contains dots)
  const isSubColumn = (columnPath: string): boolean => columnPath.includes('.')

  // Get parent column path
  const getParentColumn = (columnPath: string): string => {
    const parts = columnPath.split('.')
    parts.pop()
    return parts.join('.')
  }

  // Calculate selection state for header checkbox
  const selectionState = useMemo((): 'none' | 'some' | 'all' => {
    if (selectedIds.size === 0) return 'none'
    const selectableCount = documents.filter(doc => getDocId(doc)).length
    if (selectedIds.size >= selectableCount && selectableCount > 0) return 'all'
    return 'some'
  }, [selectedIds, documents])

  // Update header checkbox indeterminate state
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectionState === 'some'
    }
  }, [selectionState])

  // Toggle single document selection
  const toggleSelection = useCallback((docId: string): void => {
    const newSet = new Set(selectedIds)
    if (newSet.has(docId)) {
      newSet.delete(docId)
    } else {
      newSet.add(docId)
    }
    onSelectionChange(newSet)
  }, [selectedIds, onSelectionChange])

  // Toggle all documents selection
  const toggleAllSelection = useCallback((): void => {
    if (selectionState === 'all') {
      // Deselect all
      onSelectionChange(new Set())
    } else {
      // Select all
      const newSet = new Set<string>()
      documents.forEach(doc => {
        const docId = getDocId(doc)
        if (docId) newSet.add(docId)
      })
      onSelectionChange(newSet)
    }
  }, [selectionState, documents, onSelectionChange])

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return

    const handleClickOutside = (e: globalThis.MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }

    const handleScroll = (): void => setContextMenu(null)
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('scroll', handleScroll, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu) {
      setDocumentMenuPlacement(null)
      return
    }

    const menu = menuRef.current
    if (!menu) {
      setDocumentMenuPlacement({ left: contextMenu.x, top: contextMenu.y })
      return
    }

    const rect = menu.getBoundingClientRect()
    const maxLeft = Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - rect.width - MENU_VIEWPORT_MARGIN)
    const left = Math.min(Math.max(contextMenu.x, MENU_VIEWPORT_MARGIN), maxLeft)

    let top = contextMenu.y
    let maxHeight: number | undefined

    if (contextMenu.y + rect.height + MENU_VIEWPORT_MARGIN <= window.innerHeight) {
      top = contextMenu.y
    } else if (contextMenu.y - rect.height >= MENU_VIEWPORT_MARGIN) {
      top = contextMenu.y - rect.height
    } else {
      top = MENU_VIEWPORT_MARGIN
      maxHeight = Math.max(0, window.innerHeight - MENU_VIEWPORT_MARGIN * 2)
    }

    setDocumentMenuPlacement(prev => {
      if (
        prev?.left === left &&
        prev.top === top &&
        prev.maxHeight === maxHeight
      ) {
        return prev
      }

      return { left, top, maxHeight }
    })
  }, [contextMenu, copiedField, readOnly, compareSourceDoc, onCompareSource, onCompareTo])

  // Close header context menu on click outside or scroll
  useEffect(() => {
    if (!headerContextMenu) return

    const handleClickOutside = (e: globalThis.MouseEvent): void => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderContextMenu(null)
      }
    }

    const handleScroll = (): void => setHeaderContextMenu(null)
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setHeaderContextMenu(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('scroll', handleScroll, true)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [headerContextMenu])

  // Handle header right-click
  const handleHeaderContextMenu = (e: ReactMouseEvent<HTMLTableCellElement>, column: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setHeaderContextMenu({
      x: e.clientX,
      y: e.clientY,
      column,
    })
  }

  const handleContextMenu = (e: ReactMouseEvent<HTMLTableRowElement | HTMLTableCellElement>, doc: MongoDocument, cellKey: string | null = null, cellValue: unknown = null): void => {
    e.preventDefault()
    e.stopPropagation()
    setDocumentMenuPlacement({ left: e.clientX, top: e.clientY })
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      doc,
      cellKey,
      cellValue,
    })
  }

  const handleCopyValue = async (): Promise<void> => {
    if (contextMenu?.cellValue !== undefined) {
      try {
        await navigator.clipboard.writeText(getRawValue(contextMenu.cellValue))
        setCopiedField('value')
        setTimeout(() => {
          setContextMenu(null)
          setCopiedField(null)
        }, 600)
        return
      } catch (err) {
        console.error('Failed to copy:', err)
      }
    }
    setContextMenu(null)
  }

  const handleCopyDocumentJson = async (): Promise<void> => {
    if (contextMenu?.doc) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(contextMenu.doc, null, 2))
        setCopiedField('json')
        setTimeout(() => {
          setContextMenu(null)
          setCopiedField(null)
        }, 600)
        return
      } catch (err) {
        console.error('Failed to copy document:', err)
      }
    }
    setContextMenu(null)
  }

  const handleView = (): void => {
    if (contextMenu?.doc && onView) {
      onView(contextMenu.doc)
    }
    setContextMenu(null)
  }

  const handleEdit = (): void => {
    if (contextMenu?.doc && onEdit) {
      onEdit(contextMenu.doc)
    }
    setContextMenu(null)
  }

  const handleDelete = (): void => {
    if (contextMenu?.doc && onDelete) {
      onDelete(contextMenu.doc)
    }
    setContextMenu(null)
  }

  // Calculate frozen columns in display order (based on columns array order)
  const frozenColumnsList = useMemo(() => {
    return columns.filter(col => frozenColumns.has(col))
  }, [columns, frozenColumns])

  // Calculate left offsets for each frozen column (checkbox width + cumulative frozen column widths)
  const frozenColumnOffsets = useMemo(() => {
    const offsets: { [column: string]: number } = {}
    let currentOffset = 52 // Checkbox column width
    for (const col of frozenColumnsList) {
      offsets[col] = currentOffset
      currentOffset += columnWidths[col] || getDefaultColumnWidth(col, documents)
    }
    return offsets
  }, [frozenColumnsList, columnWidths, documents])

  // Check if any columns are frozen (for checkbox column sticky behavior)
  const hasFrozenColumns = frozenColumnsList.length > 0

  // Calculate total table width to ensure header and body tables match
  const totalTableWidth = useMemo(() => {
    let width = 52 // Checkbox column
    columns.forEach(col => {
      width += columnWidths[col] || getDefaultColumnWidth(col, documents)
    })
    return width
  }, [columns, columnWidths, documents])

  if (documents.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center text-text-muted">
          No documents to display
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <table
            className="text-sm table-fixed"
            role="grid"
            aria-label="Documents table"
            style={{ position: 'sticky', top: 0, zIndex: 20, width: totalTableWidth }}
          >
          {/* Colgroup to enforce column widths */}
          <colgroup>
            <col style={{ width: 52 }} />
            {columns.map(col => (
              <col key={col} style={{ width: columnWidths[col] || getDefaultColumnWidth(col, documents) }} />
            ))}
          </colgroup>
          <thead className="bg-surface-hover select-none">
            <tr role="row">
              {/* Checkbox column header */}
              <th
                scope="col"
                className={`px-3 py-2 text-left border-b border-border bg-surface-hover ${hasFrozenColumns ? 'sticky left-0 z-30' : ''}`}
                style={{ width: 52, minWidth: 52 }}
              >
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={selectionState === 'all'}
                  onChange={toggleAllSelection}
                  aria-label={selectionState === 'all' ? 'Deselect all documents' : 'Select all documents'}
                  title={selectionState === 'all' ? 'Deselect all' : 'Select all'}
                />
              </th>
              {columns.map((col, _colIndex) => {
                const canExpand = expandableColumnsMap.get(col) ?? false
                const isExpanded = isColumnExpanded(col)
                const isSub = isSubColumn(col)
                const displayName = isSub ? col.split('.').pop()! : col
                const parentCol = isSub ? getParentColumn(col) : null
                const isFrozen = frozenColumns.has(col)
                const isMasked = maskedColumns.has(col)
                const frozenOffset = isFrozen ? frozenColumnOffsets[col] : undefined

                return (
                <th
                  key={col}
                  scope="col"
                  className={`px-3 py-2 text-left font-medium text-text-secondary border-b border-border whitespace-nowrap relative group bg-surface-hover cursor-grab ${isSub ? 'bg-surface/30' : ''} ${isFrozen ? 'sticky z-30' : ''} ${isFrozen ? 'border-r-2 border-r-border-light' : ''} ${dragColumn === col ? 'opacity-50' : ''} ${dropTarget === col ? 'border-l-2 border-l-primary' : ''}`}
                  style={{
                    width: columnWidths[col] || getDefaultColumnWidth(col, documents),
                    minWidth: 60,
                    left: frozenOffset,
                  }}
                  draggable
                  onDragStart={(e) => handleColumnDragStart(e, col)}
                  onDragOver={(e) => handleColumnDragOver(e, col)}
                  onDrop={(e) => handleColumnDrop(e, col)}
                  onDragEnd={handleColumnDragEnd}
                  onContextMenu={(e) => handleHeaderContextMenu(e, col)}
                >
                  <div className="flex items-center gap-1">
                    {/* Collapse parent button for sub-columns */}
                    {isSub && parentCol && (
                      <button
                        onClick={() => toggleColumnExpansion(parentCol)}
                        className="icon-btn p-0.5 hover:bg-surface-hover rounded text-text-muted hover:text-text-secondary"
                        title={`Collapse ${parentCol}`}
                      >
                        <CollapseIcon className="w-3 h-3" />
                      </button>
                    )}
                    {/* Masked column indicator */}
                    {isMasked && (
                      <span title="Column is masked">
                        <MaskIcon className="w-3 h-3 text-warning" />
                      </span>
                    )}
                    {/* Column name */}
                    <span className={`${isSub ? 'text-text-muted' : ''} ${isMasked ? 'text-warning/80' : ''}`}>{isSub ? `\u21B3 ${displayName}` : displayName}</span>
                    {/* Expand button for expandable columns */}
                    {canExpand && !isExpanded && (
                      <button
                        onClick={() => toggleColumnExpansion(col)}
                        className="icon-btn p-0.5 hover:bg-surface-hover rounded text-text-muted hover:text-primary"
                        title={`Expand ${col}`}
                      >
                        <ExpandIcon className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {/* Column resizer - 6px hit target with visible inner line */}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize flex justify-center hover:bg-primary/30 group-hover:after:opacity-100 after:content-[''] after:w-0.5 after:h-full after:bg-text-dim after:opacity-0 after:transition-opacity hover:after:bg-primary hover:after:opacity-100"
                    onMouseDown={(e) => handleResizeStart(e, col)}
                  />
                </th>
                )
              })}
            </tr>
          </thead>
        </table>

        {/* Virtual scrolling body */}
        <div style={{ position: 'absolute', top: ROW_HEIGHT, left: 0, right: 0 }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            <table className="text-sm table-fixed" role="presentation" style={{ width: totalTableWidth }}>
              {/* Colgroup to match header column widths */}
              <colgroup>
                <col style={{ width: 52 }} />
                {columns.map(col => (
                  <col key={col} style={{ width: columnWidths[col] || getDefaultColumnWidth(col, documents) }} />
                ))}
              </colgroup>
              <tbody>
                {visibleDocuments.map((doc, idx) => {
                  const actualIndex = startIndex + idx
                  const docId = getDocId(doc)
                  const isSelected = docId !== null && selectedIds.has(docId)
                  const isCompareSource = compareSourceDoc && getDocId(compareSourceDoc) === docId
                  return (
                    <tr
                      key={docId || actualIndex}
                      className={`table-row border-b border-surface ${
                        isSelected
                          ? 'row-selected'
                          : isCompareSource
                          ? 'row-compare-source'
                          : ''
                      }`}
                      style={{ height: ROW_HEIGHT }}
                      onContextMenu={(e) => handleContextMenu(e, doc)}
                      onDoubleClick={() => { if (onView) onView(doc) }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (onView) onView(doc)
                        } else if (e.key === ' ') {
                          e.preventDefault()
                          if (docId) toggleSelection(docId)
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null
                          if (next) {
                            next.focus()
                            const container = containerRef.current
                            if (container) {
                              const rowBottom = (actualIndex + 3) * ROW_HEIGHT
                              if (rowBottom > container.scrollTop + container.clientHeight) {
                                container.scrollTop = rowBottom - container.clientHeight
                              }
                            }
                          }
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null
                          if (prev) {
                            prev.focus()
                            const container = containerRef.current
                            if (container) {
                              const rowTop = actualIndex * ROW_HEIGHT
                              if (rowTop < container.scrollTop + ROW_HEIGHT) {
                                container.scrollTop = Math.max(0, rowTop - ROW_HEIGHT)
                              }
                            }
                          }
                        }
                      }}
                    >
                      {/* Row checkbox */}
                      <td
                        className={`px-3 py-2 ${hasFrozenColumns ? 'sticky left-0 z-10 frozen-cell' : ''}`}
                        style={{ width: 52, minWidth: 52 }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => docId && toggleSelection(docId)}
                          disabled={!docId}
                          aria-label={`Select document ${docId || actualIndex + 1}`}
                        />
                      </td>
                      {columns.map(col => {
                        const cellValue = getNestedValue(doc, col)
                        const isSub = isSubColumn(col)
                        const isFrozen = frozenColumns.has(col)
                        const isMasked = maskedColumns.has(col)
                        const frozenOffset = isFrozen ? frozenColumnOffsets[col] : undefined
                        return (
                        <td
                          key={col}
                          className={`px-3 py-2 whitespace-nowrap truncate cursor-context-menu text-text ${isSub && !isFrozen ? 'bg-surface/20' : ''} ${isFrozen ? 'sticky z-10 frozen-cell border-r-2 border-r-border-light' : ''}`}
                          style={{
                            width: columnWidths[col] || getDefaultColumnWidth(col, documents),
                            maxWidth: columnWidths[col] || getDefaultColumnWidth(col, documents),
                            left: frozenOffset,
                          }}
                          onContextMenu={(e) => handleContextMenu(e, doc, col, cellValue)}
                        >
                          {isMasked ? (
                            <span className="text-text-dim select-none" title="Value is masked">{MASKED_VALUE_DISPLAY}</span>
                          ) : (
                            formatValue(cellValue)
                          )}
                        </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Document actions"
          className="fixed bg-surface border border-border rounded-lg shadow-xl py-1 z-50 min-w-[180px]"
          style={{
            left: documentMenuPlacement?.left ?? contextMenu.x,
            top: documentMenuPlacement?.top ?? contextMenu.y,
            maxHeight: documentMenuPlacement?.maxHeight,
            overflowY: documentMenuPlacement?.maxHeight ? 'auto' : undefined,
          }}
        >
          {/* Cell-specific copy option */}
          {contextMenu.cellValue !== undefined && contextMenu.cellKey && (
            <button
              role="menuitem"
              className={`context-menu-item w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                copiedField === 'value' ? 'text-primary bg-primary/10' : 'text-text-light hover:bg-surface-hover'
              }`}
              onClick={handleCopyValue}
              disabled={copiedField !== null}
            >
              {copiedField === 'value' ? (
                <>
                  <CheckIcon className="w-4 h-4 text-primary" />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon className="w-4 h-4 text-text-muted" />
                  Copy "{contextMenu.cellKey}" value
                </>
              )}
            </button>
          )}
          {/* Document-level copy options */}
          <button
            role="menuitem"
            className={`context-menu-item w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
              copiedField === 'json' ? 'text-primary bg-primary/10' : 'text-text-light hover:bg-surface-hover'
            }`}
            onClick={handleCopyDocumentJson}
            disabled={copiedField !== null}
          >
            {copiedField === 'json' ? (
              <>
                <CheckIcon className="w-4 h-4 text-primary" />
                Copied!
              </>
            ) : (
              <>
                <CopyIcon className="w-4 h-4 text-text-muted" />
                Copy Document JSON
              </>
            )}
          </button>
          {/* Separator */}
          <div className="border-t border-border my-1" />
          {/* Document comparison */}
          {onCompareSource && !compareSourceDoc && (
            <button
              role="menuitem"
              className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
              onClick={() => {
                onCompareSource(contextMenu.doc)
                setContextMenu(null)
              }}
            >
              <CompareIcon className="w-4 h-4 text-text-muted" />
              Compare with...
            </button>
          )}
          {onCompareTo && compareSourceDoc && getDocId(compareSourceDoc) !== getDocId(contextMenu.doc) && (
            <button
              role="menuitem"
              className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
              onClick={() => {
                onCompareTo(contextMenu.doc)
                setContextMenu(null)
              }}
            >
              <CompareIcon className="w-4 h-4 text-text-muted" />
              Compare to source
            </button>
          )}
          {compareSourceDoc && (
            <button
              role="menuitem"
              className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-hover flex items-center gap-2"
              onClick={() => {
                onCompareSource?.(null)
                setContextMenu(null)
              }}
            >
              <CloseIcon className="w-4 h-4" />
              Clear comparison source
            </button>
          )}
          {(onCompareSource || onCompareTo) && <div className="border-t border-border my-1" />}
          {/* Document actions */}
          <button
            role="menuitem"
            className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
            onClick={handleView}
          >
            <EyeIcon className="w-4 h-4 text-info" />
            View Document
          </button>
          {!readOnly && (
            <button
              role="menuitem"
              className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
              onClick={handleEdit}
            >
              <EditIcon className="w-4 h-4 text-text-muted" />
              Edit Document
            </button>
          )}
          <button
            role="menuitem"
            className={`context-menu-item w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${readOnly ? 'text-text-dim cursor-not-allowed' : 'text-error hover:bg-surface-hover'}`}
            onClick={handleDelete}
            disabled={readOnly}
          >
            <TrashIcon className="w-4 h-4" />
            Delete Document
          </button>
        </div>,
        document.body
      )}

      {/* Header Context Menu (Column Freeze & Mask) */}
      {headerContextMenu && (
        <div
          ref={headerMenuRef}
          role="menu"
          aria-label="Column actions"
          className="fixed bg-surface border border-border rounded-lg shadow-xl py-1 z-50 min-w-[180px]"
          style={{
            left: headerContextMenu.x,
            top: headerContextMenu.y,
          }}
        >
          {/* Mask/Unmask Column */}
          <button
            role="menuitem"
            className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
            onClick={() => {
              toggleMaskColumn(headerContextMenu.column)
              setHeaderContextMenu(null)
            }}
          >
            {maskedColumns.has(headerContextMenu.column) ? (
              <>
                <UnmaskIcon className="w-4 h-4 text-text-muted" />
                Unmask Column
              </>
            ) : (
              <>
                <MaskIcon className="w-4 h-4 text-text-muted" />
                Mask Column
              </>
            )}
          </button>
          {/* Hide Column option */}
          <button
            role="menuitem"
            className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
            onClick={() => {
              hideColumn(headerContextMenu.column)
              setHeaderContextMenu(null)
            }}
          >
            <EyeOffIcon className="w-4 h-4 text-text-muted" />
            Hide Column
          </button>
          <div className="border-t border-border my-1" />
          {/* Freeze/Unfreeze Column option */}
          <button
            role="menuitem"
            className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-light hover:bg-surface-hover flex items-center gap-2"
            onClick={() => {
              toggleFreezeColumn(headerContextMenu.column)
              setHeaderContextMenu(null)
            }}
          >
            {frozenColumns.has(headerContextMenu.column) ? (
              <>
                <UnfreezeIcon className="w-4 h-4 text-text-muted" />
                Unfreeze Column
              </>
            ) : (
              <>
                <FreezeIcon className="w-4 h-4 text-text-muted" />
                Freeze Column
              </>
            )}
          </button>
          {(frozenColumnsList.length > 1 || maskedColumns.size > 1) && (
            <>
              <div className="border-t border-border my-1" />
              {frozenColumnsList.length > 1 && (
                <button
                  role="menuitem"
                  className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-hover flex items-center gap-2"
                  onClick={() => {
                    setFrozenColumns(new Set())
                    saveFrozenColumns(connectionId, database, collection, new Set())
                    setHeaderContextMenu(null)
                  }}
                >
                  <UnfreezeIcon className="w-4 h-4" />
                  Unfreeze All Columns
                </button>
              )}
              {maskedColumns.size > 1 && (
                <button
                  role="menuitem"
                  className="context-menu-item w-full px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-hover flex items-center gap-2"
                  onClick={() => {
                    setMaskedColumns(new Set())
                    saveMaskedColumns(connectionId, database, collection, new Set())
                    setHeaderContextMenu(null)
                  }}
                >
                  <UnmaskIcon className="w-4 h-4" />
                  Unmask All Columns
                </button>
              )}
            </>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
