import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNotification } from '../components/NotificationContext'
import { useConnection, SavedConnection } from '../components/contexts/ConnectionContext'
import { useStatus } from '../components/contexts/StatusContext'
import { useDebugLog, DEBUG_CATEGORIES, DebugCategory } from '../components/contexts/DebugContext'
import { useSchema } from '../components/contexts/SchemaContext'
import { loadSettings, AppSettings } from '../components/Settings'
import type { ExplainResult } from '../components/ExplainPanel'
import type { CollectionProfile, WailsAppBindings } from '../types/wails.d'
import {
  parseFilterFromQuery,
  parseProjectionFromQuery,
  parseLimitFromQuery,
  parseSortFromQuery,
  buildFullQuery,
  isSimpleFindQuery,
  wrapScriptForOutput,
} from '../utils/queryParser'
import { extractFieldPathsFromDocs } from '../utils/schemaUtils'
import { parseMongoshOutput, MongoshParseResult } from '../utils/mongoshParser'
import { getErrorSummary } from '../utils/errorParser'
import { MongoDocument } from '../utils/tableViewUtils'
import { convertSQL } from '../utils/sqlConverter'
import {
  loadQueryHistory,
  saveQueryHistory,
  addToQueryHistoryList,
  QueryHistoryItem,
  QueryEditorMode,
} from './useQueryHistory'

// Default SQL buffer for a collection. Quote the name when it is not a plain
// identifier so dotted/spaced/hyphenated collections don't produce a parse error.
export function buildDefaultSql(collection: string): string {
  const name = /^[A-Za-z_][A-Za-z0-9_]*$/.test(collection) ? collection : `"${collection}"`
  return `SELECT * FROM ${name}`
}

// Max result cap for SQL aggregate execution — matches AggregateDocuments'
// own 1-1000 clamp in the Go binding.
const AGGREGATE_SAFETY_LIMIT = 1000

// =============================================================================
// Types
// =============================================================================

export interface UseQueryExecutionOptions {
  /** Connection ID */
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

export interface UseQueryExecutionReturn {
  // Query state
  query: string
  setQuery: (query: string) => void
  // SQL mode (F076): per-mode editor buffers persist across mode switches.
  queryMode: QueryEditorMode
  setQueryMode: (mode: QueryEditorMode) => void
  sqlQuery: string
  setSqlQuery: (sql: string) => void
  /** Kind of the last executed result — 'aggregate' disables pagination. */
  resultKind: 'find' | 'aggregate'
  documents: MongoDocument[]
  loading: boolean
  error: string | null
  setError: (error: string | null) => void
  totalCount: number
  queryTime: number | null

  // Pagination
  skip: number
  setSkip: (skip: number) => void
  userLimit: number
  setUserLimit: (limit: number) => void
  limit: number
  total: number
  currentPage: number
  totalPages: number
  goToPage: string
  setGoToPage: (page: string) => void
  paginationResetHighlight: boolean
  isAdaptive: boolean
  adaptiveInfo: string

  // Actions
  executeQuery: () => Promise<void>
  cancelQuery: () => void

  // Connection state
  isConnected: boolean
  isConnecting: boolean
  readOnly: boolean
  connection: SavedConnection | undefined

  // Restored tab state
  isRestoredTab: boolean
  setIsRestoredTab: (restored: boolean) => void

  // Collection health
  collectionProfile: CollectionProfile | null
  hasLargeDocWarning: boolean
  healthWarnings: string[]
  healthWarningDismissed: boolean
  setHealthWarningDismissed: (dismissed: boolean) => void

  // Response size warning (LDH-04)
  responseSizeWarning: { estimatedMB: number; suggestedPageSize: number } | null
  setResponseSizeWarning: (warning: { estimatedMB: number; suggestedPageSize: number } | null) => void
  responseSizeBypassRef: React.MutableRefObject<boolean>

  // Auto-projection (LDH-03)
  autoProjectionInfo: { fieldCount: number; totalFields: number } | null
  handleShowAllFields: () => void
  autoProjectionAppliedRef: React.MutableRefObject<string>

  // Column state
  allAvailableColumns: string[]

  // Write query detection
  isWriteQuery: (queryText: string) => boolean

  // Query history (managed here because executeQuery updates it)
  queryHistory: QueryHistoryItem[]
  setQueryHistory: React.Dispatch<React.SetStateAction<QueryHistoryItem[]>>

  // Schema access (passed through for editor autocomplete)
  getCachedSchema: ReturnType<typeof useSchema>['getCachedSchema']
  getFieldNames: ReturnType<typeof useSchema>['getFieldNames']
  prefetchSchema: ReturnType<typeof useSchema>['prefetchSchema']
  mergeFieldNames: ReturnType<typeof useSchema>['mergeFieldNames']
  fetchCollectionProfile: ReturnType<typeof useSchema>['fetchCollectionProfile']
  getCollectionProfile: ReturnType<typeof useSchema>['getCollectionProfile']

  // Explain
  explainQuery: () => Promise<void>
  explaining: boolean
  explainResult: ExplainResult | null
  setExplainResult: (result: ExplainResult | null) => void
}

// Get go bindings at runtime
const getGo = (): WailsAppBindings | undefined => window.go?.main?.App

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing query execution, pagination, collection health checks,
 * and all related state for the CollectionView.
 */
export function useQueryExecution({
  connectionId,
  database,
  collection,
  restored,
}: UseQueryExecutionOptions): UseQueryExecutionReturn {
  const { notify } = useNotification()
  const { getConnectionById, activeConnections, connectingIds } = useConnection()
  const { updateDocumentStatus, clearStatus } = useStatus()
  const { log: logQuery } = useDebugLog(DEBUG_CATEGORIES.QUERY as DebugCategory)
  const {
    getCachedSchema,
    getFieldNames,
    prefetchSchema,
    mergeFieldNames,
    fetchCollectionProfile,
    getCollectionProfile,
  } = useSchema()

  // Connection state
  const connection = getConnectionById(connectionId)
  const readOnly = (connection as SavedConnection & { readOnly?: boolean })?.readOnly || false
  const isConnected = activeConnections.includes(connectionId)
  const isConnecting = connectingIds.has(connectionId)

  // Restored tab state
  const [isRestoredTab, setIsRestoredTab] = useState<boolean>(restored === true)

  // Core query state
  const [query, setQuery] = useState<string>(() => buildFullQuery(collection, '{}'))
  // SQL mode (F076): the mongo `query` buffer keeps its name; `sqlQuery` is the
  // parallel SQL buffer. Both persist across mode switches; the editor binds to
  // whichever the active mode selects.
  const [queryMode, setQueryMode] = useState<QueryEditorMode>('mongo')
  const [sqlQuery, setSqlQuery] = useState<string>(() => buildDefaultSql(collection))
  const [resultKind, setResultKind] = useState<'find' | 'aggregate'>('find')
  const [documents, setDocuments] = useState<MongoDocument[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const queryIdRef = useRef<number>(0)

  // Query history (lives here because executeQuery updates it directly)
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>(() => loadQueryHistory())

  // Pagination state
  const [skip, setSkip] = useState<number>(0)
  const [userLimit, setUserLimit] = useState<number>(50)
  const [total, setTotal] = useState<number>(0)
  const [queryTime, setQueryTime] = useState<number | null>(null)
  const [goToPage, setGoToPage] = useState<string>('')
  const [paginationResetHighlight, setPaginationResetHighlight] = useState<boolean>(false)
  const prevSkipRef = useRef<number>(skip)

  // Collection health check state (LDH-01)
  const [collectionProfile, setCollectionProfile] = useState<CollectionProfile | null>(null)
  const [healthWarningDismissed, setHealthWarningDismissed] = useState<boolean>(false)

  // Auto-projection (LDH-03)
  const autoProjectionAppliedRef = useRef<string>('')

  // Response size warning (LDH-04)
  const [responseSizeWarning, setResponseSizeWarning] = useState<{
    estimatedMB: number
    suggestedPageSize: number
  } | null>(null)
  const responseSizeBypassRef = useRef<boolean>(false)

  // Column state
  const [allAvailableColumns, setAllAvailableColumns] = useState<string[]>([])

  // Explain plan state
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null)
  const [explaining, setExplaining] = useState<boolean>(false)

  // Adaptive page size (LDH-05)
  const { limit, isAdaptive, adaptiveInfo } = useMemo(() => {
    if (!collectionProfile || collectionProfile.avgDocSizeBytes <= 0) {
      return { limit: userLimit, isAdaptive: false, adaptiveInfo: '' }
    }
    const settings: AppSettings = loadSettings()
    const maxPayloadBytes = (settings.ldhMaxPagePayloadMB || 10) * 1024 * 1024
    const recommended = Math.max(1, Math.floor(maxPayloadBytes / collectionProfile.avgDocSizeBytes))
    if (recommended < userLimit) {
      const avgSize = collectionProfile.avgDocSizeBytes
      const sizeStr =
        avgSize >= 1024 * 1024
          ? `${(avgSize / 1024 / 1024).toFixed(1)} MB`
          : avgSize >= 1024
          ? `${Math.round(avgSize / 1024)} KB`
          : `${avgSize} bytes`
      return {
        limit: recommended,
        isAdaptive: true,
        adaptiveInfo: `Page size reduced to ${recommended} (documents average ${sizeStr} each).`,
      }
    }
    return { limit: userLimit, isAdaptive: false, adaptiveInfo: '' }
  }, [userLimit, collectionProfile])

  const currentPage = Math.floor(skip / limit) + 1
  const totalPages = Math.ceil(total / limit)

  // Health check warnings (LDH-01)
  const healthWarnings = useMemo(() => {
    if (!collectionProfile || healthWarningDismissed) return []
    const settings: AppSettings = loadSettings()
    const warnings: string[] = []
    const avgKB = collectionProfile.avgDocSizeBytes / 1024
    if (avgKB > settings.ldhWarningThresholdKB) {
      const sizeStr =
        avgKB >= 1024 ? `${(avgKB / 1024).toFixed(1)} MB` : `${Math.round(avgKB)} KB`
      warnings.push(
        `Documents average ${sizeStr} each. Consider reducing page size or adding a projection.`
      )
    }
    return warnings
  }, [collectionProfile, healthWarningDismissed])

  // Whether the health warning includes a size warning (to show small page sizes)
  const hasLargeDocWarning = useMemo(() => {
    if (!collectionProfile) return false
    const settings: AppSettings = loadSettings()
    return collectionProfile.avgDocSizeBytes / 1024 > settings.ldhWarningThresholdKB
  }, [collectionProfile])

  // Auto-projection info (LDH-03)
  const autoProjectionInfo = useMemo(() => {
    if (!autoProjectionAppliedRef.current || !collectionProfile) return null
    const queryProj = parseProjectionFromQuery(query)
    if (!queryProj) return null
    try {
      const fieldCount = Object.keys(JSON.parse(queryProj)).length
      return { fieldCount, totalFields: collectionProfile.fieldCount }
    } catch {
      return null
    }
  }, [query, collectionProfile])

  // Show all fields - strip auto-projection from query (LDH-03)
  const handleShowAllFields = useCallback(() => {
    const filter = parseFilterFromQuery(query)
    setQuery(buildFullQuery(collection, filter))
    autoProjectionAppliedRef.current = 'opted-out'
  }, [query, collection])

  // Reset both editor buffers when collection changes (mode is preserved; the
  // active editor shows its mode's fresh default).
  useEffect(() => {
    setQuery(buildFullQuery(collection, '{}'))
    setSqlQuery(buildDefaultSql(collection))
    setResultKind('find')
  }, [collection])

  // Detect pagination reset and trigger highlight animation
  useEffect(() => {
    if (prevSkipRef.current > 0 && skip === 0) {
      setPaginationResetHighlight(true)
      const timer = setTimeout(() => setPaginationResetHighlight(false), 600)
      return () => clearTimeout(timer)
    }
    prevSkipRef.current = skip
  }, [skip])

  // Prefetch schema for field validation when connected
  useEffect(() => {
    if (isConnected && !isConnecting) {
      prefetchSchema(connectionId, database, collection)
    }
  }, [connectionId, database, collection, isConnected, isConnecting, prefetchSchema])

  // Fetch collection profile for health check (LDH-01)
  useEffect(() => {
    if (!isConnected || isConnecting) return
    const cached = getCollectionProfile(connectionId, database, collection)
    if (cached) {
      setCollectionProfile(cached)
      return
    }
    setHealthWarningDismissed(false)
    fetchCollectionProfile(connectionId, database, collection)
      .then((profile) => {
        if (profile) setCollectionProfile(profile)
      })
      .catch(() => {
        /* ignore profile fetch errors */
      })
  }, [
    connectionId,
    database,
    collection,
    isConnected,
    isConnecting,
    fetchCollectionProfile,
    getCollectionProfile,
  ])

  // Reset health warning, auto-projection, and size warning when collection changes
  useEffect(() => {
    setHealthWarningDismissed(false)
    setCollectionProfile(null)
    autoProjectionAppliedRef.current = ''
    setResponseSizeWarning(null)
    responseSizeBypassRef.current = false
  }, [connectionId, database, collection])

  // Update status bar with document count
  useEffect(() => {
    updateDocumentStatus(total, queryTime)
    return () => clearStatus()
  }, [total, queryTime, updateDocumentStatus, clearStatus])

  // Check if query contains write operations (for read-only mode protection)
  const isWriteQuery = useCallback((queryText: string): boolean => {
    const writePatterns: RegExp[] = [
      /\.insert(?:One|Many)?\s*\(/i,
      /\.update(?:One|Many)?\s*\(/i,
      /\.delete(?:One|Many)?\s*\(/i,
      /\.remove\s*\(/i,
      /\.drop\s*\(/i,
      /\.createIndex\s*\(/i,
      /\.dropIndex\s*\(/i,
      /\.replaceOne\s*\(/i,
      /\.findOneAndUpdate\s*\(/i,
      /\.findOneAndReplace\s*\(/i,
      /\.findOneAndDelete\s*\(/i,
      /\.bulkWrite\s*\(/i,
      /\.save\s*\(/i,
    ]
    return writePatterns.some((pattern) => pattern.test(queryText))
  }, [])

  // Build auto-projection from profile/schema when collection is wide (LDH-03)
  const buildAutoProjection = useCallback(
    (profile: CollectionProfile | null): string => {
      const settings: AppSettings = loadSettings()
      if (!profile || profile.fieldCount <= settings.ldhFieldCountThreshold) return ''

      let fieldNames: string[]
      const schema = getCachedSchema(connectionId, database, collection)
      if (schema?.fields) {
        fieldNames = Object.entries(schema.fields)
          .filter(([name]) => name !== '_id')
          .sort(([, a], [, b]) => b.occurrence - a.occurrence)
          .slice(0, 15)
          .map(([name]) => name)
      } else if (profile.topFields?.length > 0) {
        fieldNames = profile.topFields.filter((name) => name !== '_id').slice(0, 15)
      } else {
        return ''
      }

      if (fieldNames.length === 0) return ''

      const projection: Record<string, 1> = {}
      fieldNames.forEach((name) => {
        projection[name] = 1
      })
      return JSON.stringify(projection)
    },
    [connectionId, database, collection, getCachedSchema]
  )

  const cancelQuery = useCallback((): void => {
    queryIdRef.current++
    setLoading(false)
    notify.info('Query cancelled')
  }, [notify])

  // SQL mode execution (F076). Runs before the mongo read-only guard: SQL mode
  // is read-only by construction (no DML in the grammar) and the Go binding
  // rejects $out/$merge server-side, so isWriteQuery's regex scan (which reads
  // the mongo buffer) does not apply here.
  const executeSqlQuery = useCallback(async (): Promise<void> => {
    const currentQueryId = ++queryIdRef.current
    const startTime = performance.now()
    const go = getGo()

    const schema = getCachedSchema(connectionId, database, collection)
    const result = convertSQL(sqlQuery, { getSchema: () => schema })

    if (!result.ok) {
      setError(result.error)
      setDocuments([])
      setTotal(0)
      setResultKind('find')
      return
    }

    if (result.collection && result.collection !== collection) {
      notify.warning(`Note: query targets '${result.collection}' but you're viewing '${collection}'`)
    }

    setLoading(true)
    setError(null)

    try {
      if (result.kind === 'find') {
        if (!go?.FindDocuments) return
        const findResult = await go.FindDocuments(connectionId, database, collection, result.filter, {
          skip,
          limit: result.limit ?? limit,
          sort: result.sort,
          projection: result.projection,
        } as Parameters<typeof go.FindDocuments>[4])
        if (currentQueryId !== queryIdRef.current) return
        setResultKind('find')
        if (!findResult || !findResult.documents) {
          setDocuments([])
          setTotal(0)
          setQueryTime(null)
        } else {
          const parsedDocs: MongoDocument[] = findResult.documents.map((d: string) => JSON.parse(d))
          setDocuments(parsedDocs)
          setTotal(findResult.total || 0)
          setQueryTime(findResult.queryTimeMs ?? null)

          const columnsFromDocs = new Set<string>()
          parsedDocs.forEach((doc) => Object.keys(doc).forEach((key) => columnsFromDocs.add(key)))
          const sortedColumns = Array.from(columnsFromDocs).sort((a, b) => {
            if (a === '_id') return -1
            if (b === '_id') return 1
            return a.localeCompare(b)
          })
          setAllAvailableColumns(sortedColumns)

          if (parsedDocs.length > 0) {
            const fieldPaths = extractFieldPathsFromDocs(parsedDocs)
            mergeFieldNames(connectionId, database, collection, fieldPaths)
          }
        }
      } else {
        // Aggregate (GROUP BY / DISTINCT / bare COUNT(*))
        if (!go?.AggregateDocuments) {
          throw new Error('GROUP BY execution requires the aggregate binding, which is not available.')
        }
        // Pass the max safety cap (matching the Go binding's own 1-1000 clamp),
        // not the mongo-mode page size: an explicit SQL LIMIT is already baked
        // into result.pipeline as a $limit stage, and pagination is disabled
        // for aggregate results anyway, so the page-size control shouldn't
        // silently truncate a larger user-specified LIMIT.
        const aggResult = await go.AggregateDocuments(connectionId, database, collection, result.pipeline, {
          skip: 0,
          limit: AGGREGATE_SAFETY_LIMIT,
        } as Parameters<typeof go.AggregateDocuments>[4])
        if (currentQueryId !== queryIdRef.current) return
        setResultKind('aggregate')
        setSkip(0)
        if (!aggResult || !aggResult.documents) {
          setDocuments([])
          setTotal(0)
          setQueryTime(null)
        } else {
          const parsedDocs: MongoDocument[] = aggResult.documents.map((d: string) => JSON.parse(d))
          setDocuments(parsedDocs)
          setTotal(aggResult.total ?? parsedDocs.length)
          setQueryTime(aggResult.queryTimeMs ?? null)

          const columnsFromDocs = new Set<string>()
          parsedDocs.forEach((doc) => Object.keys(doc).forEach((key) => columnsFromDocs.add(key)))
          setAllAvailableColumns(Array.from(columnsFromDocs).sort())
        }
      }

      const trimmedSql = sqlQuery.trim()
      if (trimmedSql && trimmedSql !== buildDefaultSql(collection)) {
        const newHistory = addToQueryHistoryList(queryHistory, sqlQuery, database, collection, 'sql')
        setQueryHistory(newHistory)
        saveQueryHistory(newHistory)
      }

      const duration = Math.round(performance.now() - startTime)
      logQuery(`SQL query executed (${duration}ms)`, { database, collection })
    } catch (err) {
      if (currentQueryId !== queryIdRef.current) return
      const errorMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to execute query'
      setError(errorMsg)
      notify.error(getErrorSummary(errorMsg))
      setDocuments([])
      setTotal(0)
    } finally {
      if (currentQueryId === queryIdRef.current) {
        setLoading(false)
      }
    }
  }, [
    sqlQuery,
    database,
    collection,
    connectionId,
    skip,
    limit,
    queryHistory,
    notify,
    logQuery,
    getCachedSchema,
    mergeFieldNames,
  ])

  const executeQuery = useCallback(async (): Promise<void> => {
    if (queryMode === 'sql') {
      return executeSqlQuery()
    }

    const currentQueryId = ++queryIdRef.current
    const startTime = performance.now()
    const isSimple = isSimpleFindQuery(query)

    if (readOnly && isWriteQuery(query)) {
      notify.error('Write operation blocked - connection is in read-only mode')
      return
    }

    // Ensure we have the collection profile for adaptive page size + auto-projection
    const go = getGo()
    let activeProfile = getCollectionProfile(connectionId, database, collection)
    if (!activeProfile && go?.GetCollectionProfile) {
      try {
        activeProfile = await go.GetCollectionProfile(connectionId, database, collection)
        if (activeProfile) setCollectionProfile(activeProfile)
      } catch {
        /* ignore */
      }
    }
    if (currentQueryId !== queryIdRef.current) return

    // Compute effective limit: adaptive page size from profile (LDH-05)
    let effectiveLimit = limit
    if (activeProfile && activeProfile.avgDocSizeBytes > 0) {
      const settings: AppSettings = loadSettings()
      const maxPayloadBytes = (settings.ldhMaxPagePayloadMB || 10) * 1024 * 1024
      const recommended = Math.max(
        1,
        Math.floor(maxPayloadBytes / activeProfile.avgDocSizeBytes)
      )
      if (recommended < effectiveLimit) {
        effectiveLimit = recommended
      }
    }

    // Pre-query response size estimate (LDH-04)
    if (
      isSimple &&
      !responseSizeBypassRef.current &&
      activeProfile &&
      activeProfile.avgDocSizeBytes > 0
    ) {
      const settings: AppSettings = loadSettings()
      const thresholdMB = settings.ldhResponseSizeWarningMB || 10
      const estimatedBytes = activeProfile.avgDocSizeBytes * effectiveLimit
      const estimatedMB = estimatedBytes / (1024 * 1024)
      if (estimatedMB > thresholdMB) {
        const suggestedPageSize = Math.max(
          1,
          Math.floor((thresholdMB * 1024 * 1024) / activeProfile.avgDocSizeBytes)
        )
        setResponseSizeWarning({
          estimatedMB: Math.round(estimatedMB * 10) / 10,
          suggestedPageSize,
        })
        return // Don't execute - let user decide
      }
    }
    responseSizeBypassRef.current = false
    setResponseSizeWarning(null)

    logQuery(`Executing ${isSimple ? 'find' : 'mongosh'} query`, {
      database,
      collection,
      queryType: isSimple ? 'find' : 'mongosh',
      query: query.length > 200 ? query.slice(0, 200) + '...' : query,
    })

    setLoading(true)
    setError(null)
    setResultKind('find')

    const settings: AppSettings = loadSettings()
    const timeoutMs = settings.queryTimeout ? settings.queryTimeout * 1000 : 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (currentQueryId === queryIdRef.current) {
          queryIdRef.current++
          setLoading(false)
          const timeoutSec = settings.queryTimeout
          logQuery(`Query timed out after ${timeoutSec}s`, { database, collection })
          setError(
            `Query timed out after ${timeoutSec} seconds. You can increase the timeout in Settings.`
          )
          notify.error(`Query timed out after ${timeoutSec}s`)
        }
      }, timeoutMs)
    }

    try {
      if (isSimple) {
        const filter = parseFilterFromQuery(query)
        const queryProjection = parseProjectionFromQuery(query)
        const querySort = parseSortFromQuery(query)
        const queryLimit = parseLimitFromQuery(query)

        // Auto-projection for wide collections (LDH-03)
        let effectiveProjection = queryProjection || ''
        if (!queryProjection && !autoProjectionAppliedRef.current) {
          const autoProj = buildAutoProjection(activeProfile)
          if (autoProj) {
            effectiveProjection = autoProj
            autoProjectionAppliedRef.current = autoProj
            setQuery(buildFullQuery(collection, filter, autoProj))
          }
        }

        if (go?.FindDocuments) {
          const result = await go.FindDocuments(connectionId, database, collection, filter, {
            skip,
            limit: queryLimit ?? effectiveLimit,
            sort: querySort,
            projection: effectiveProjection,
          } as Parameters<typeof go.FindDocuments>[4])
          if (currentQueryId !== queryIdRef.current) return
          if (!result || !result.documents) {
            setDocuments([])
            setTotal(0)
            setQueryTime(null)

            return
          }
          const docCount = result.documents.length
          const duration = Math.round(performance.now() - startTime)
          logQuery(`Query returned ${docCount} docs (${result.queryTimeMs || duration}ms)`, {
            database,
            collection,
            count: docCount,
            total: result.total,
            queryTimeMs: result.queryTimeMs,
            clientDuration: duration,
          })
          const parsedDocs: MongoDocument[] = result.documents.map((d: string) => JSON.parse(d))
          setDocuments(parsedDocs)
          setTotal(result.total || 0)
          setQueryTime(result.queryTimeMs ?? null)

          // Update available columns list from query results
          const columnsFromDocs = new Set<string>()
          parsedDocs.forEach((doc) => {
            Object.keys(doc).forEach((key) => columnsFromDocs.add(key))
          })
          const sortedColumns = Array.from(columnsFromDocs).sort((a, b) => {
            if (a === '_id') return -1
            if (b === '_id') return 1
            return a.localeCompare(b)
          })
          setAllAvailableColumns(sortedColumns)

          // Enrich schema cache with field names from results (skip if projection used)
          if (!queryProjection && parsedDocs.length > 0) {
            const fieldPaths = extractFieldPathsFromDocs(parsedDocs)
            mergeFieldNames(connectionId, database, collection, fieldPaths)
          }

          // Add to query history (if not default and not duplicate)
          if (filter !== '{}' && filter.trim() !== '') {
            const newHistory = addToQueryHistoryList(queryHistory, query, database, collection)
            setQueryHistory(newHistory)
            saveQueryHistory(newHistory)
          }
        }
      } else {
        // Complex query - try mongosh execution
        if (go?.ExecuteScriptWithDatabase) {
          const wrappedQuery = wrapScriptForOutput(query)
          const result = await go.ExecuteScriptWithDatabase(connectionId, database, wrappedQuery)
          if (currentQueryId !== queryIdRef.current) return
          if (result.exitCode !== 0 || result.error) {
            throw new Error(result.error || result.output || 'Script execution failed')
          }
          const output = result.output.trim()
          const duration = Math.round(performance.now() - startTime)
          if (!output) {
            logQuery(`Mongosh query completed (${duration}ms, no output)`, {
              database,
              collection,
              duration,
            })
            setDocuments([])
            setTotal(0)
          } else {
            const parseResult: MongoshParseResult = parseMongoshOutput(output)

            if (parseResult.success && parseResult.data.length > 0) {
              logQuery(
                `Mongosh query returned ${parseResult.data.length} results (${duration}ms)`,
                {
                  database,
                  collection,
                  count: parseResult.data.length,
                  duration,
                }
              )
              setDocuments(parseResult.data as MongoDocument[])
              setTotal(parseResult.data.length)

              const fieldPaths = extractFieldPathsFromDocs(parseResult.data as MongoDocument[])
              mergeFieldNames(connectionId, database, collection, fieldPaths)
            } else {
              logQuery(`Mongosh query completed with raw output (${duration}ms)`, {
                database,
                collection,
                duration,
              })
              setDocuments([{ _result: output }])
              setTotal(1)
            }
          }
          setQueryTime(null)

          const newHistory = addToQueryHistoryList(queryHistory, query, database, collection)
          setQueryHistory(newHistory)
          saveQueryHistory(newHistory)
        } else if (go?.CheckMongoshAvailable) {
          const [available] = await go.CheckMongoshAvailable()
          if (currentQueryId !== queryIdRef.current) return
          if (!available) {
            throw new Error(
              'Invalid query syntax. For complex queries (aggregations, scripts), install mongosh: https://www.mongodb.com/try/download/shell'
            )
          }
        } else {
          throw new Error(
            'Invalid query syntax. Expected: db.getCollection("name").find({...}) or a filter like { field: "value" }'
          )
        }
      }
    } catch (err) {
      if (currentQueryId !== queryIdRef.current) return
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Failed to execute query'
      const duration = Math.round(performance.now() - startTime)
      logQuery(`Query failed (${duration}ms): ${getErrorSummary(errorMsg)}`, {
        database,
        collection,
        error: errorMsg,
        duration,
      })
      setError(errorMsg)
      notify.error(getErrorSummary(errorMsg))
      setDocuments([])
      setTotal(0)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      if (currentQueryId === queryIdRef.current) {
        setLoading(false)
      }
    }
  }, [
    query,
    queryMode,
    executeSqlQuery,
    readOnly,
    isWriteQuery,
    notify,
    logQuery,
    database,
    collection,
    connectionId,
    skip,
    limit,
    queryHistory,
    mergeFieldNames,
    buildAutoProjection,
    getCollectionProfile,
  ])

  // Load documents on mount and when collection/pagination changes
  useEffect(() => {
    if (!isConnected || isConnecting || isRestoredTab) return
    executeQuery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, collection, skip, limit, isConnected, isConnecting, isRestoredTab])

  // Explain the current query
  const explainQuery = useCallback(async (): Promise<void> => {
    if (queryMode === 'sql') {
      const schema = getCachedSchema(connectionId, database, collection)
      const result = convertSQL(sqlQuery, { getSchema: () => schema })
      if (!result.ok) {
        notify.warning('Fix the SQL parse error before running Explain')
        return
      }
      if (result.kind === 'aggregate') {
        notify.warning('Explain is not available for GROUP BY queries')
        return
      }
      if (result.collection && result.collection !== collection) {
        notify.warning(`Note: query targets '${result.collection}' but you're viewing '${collection}'`)
      }
      setExplaining(true)
      setExplainResult(null)
      try {
        const go = getGo()
        if (go?.ExplainQuery) {
          const explainResultData = await go.ExplainQuery(connectionId, database, collection, result.filter)
          setExplainResult(explainResultData as unknown as ExplainResult)
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Failed to explain query'
        notify.error(getErrorSummary(errorMsg))
      } finally {
        setExplaining(false)
      }
      return
    }

    if (!isSimpleFindQuery(query)) {
      notify.warning('Explain is only available for simple find queries')
      return
    }

    setExplaining(true)
    setExplainResult(null)

    try {
      const filter = parseFilterFromQuery(query)
      const go = getGo()
      if (go?.ExplainQuery) {
        const result = await go.ExplainQuery(connectionId, database, collection, filter)
        setExplainResult(result as unknown as ExplainResult)
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Failed to explain query'
      notify.error(getErrorSummary(errorMsg))
    } finally {
      setExplaining(false)
    }
  }, [query, queryMode, sqlQuery, notify, connectionId, database, collection, getCachedSchema])

  return {
    // Query state
    query,
    setQuery,
    queryMode,
    setQueryMode,
    sqlQuery,
    setSqlQuery,
    resultKind,
    documents,
    loading,
    error,
    setError,
    totalCount: total,
    queryTime,

    // Pagination
    skip,
    setSkip,
    userLimit,
    setUserLimit,
    limit,
    total,
    currentPage,
    totalPages,
    goToPage,
    setGoToPage,
    paginationResetHighlight,
    isAdaptive,
    adaptiveInfo,

    // Actions
    executeQuery,
    cancelQuery,

    // Connection state
    isConnected,
    isConnecting,
    readOnly,
    connection,

    // Restored tab
    isRestoredTab,
    setIsRestoredTab,

    // Collection health
    collectionProfile,
    hasLargeDocWarning,
    healthWarnings,
    healthWarningDismissed,
    setHealthWarningDismissed,

    // Response size warning
    responseSizeWarning,
    setResponseSizeWarning,
    responseSizeBypassRef,

    // Auto-projection
    autoProjectionInfo,
    handleShowAllFields,
    autoProjectionAppliedRef,

    // Column state
    allAvailableColumns,

    // Write query detection
    isWriteQuery,

    // Query history
    queryHistory,
    setQueryHistory,

    // Schema access
    getCachedSchema,
    getFieldNames,
    prefetchSchema,
    mergeFieldNames,
    fetchCollectionProfile,
    getCollectionProfile,

    // Explain
    explainQuery,
    explaining,
    explainResult,
    setExplainResult,
  }
}

export default useQueryExecution
