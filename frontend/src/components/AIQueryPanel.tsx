import { useState, useRef, useEffect, useCallback, KeyboardEvent, JSX } from 'react'
import { useNotification } from './NotificationContext'
import { AIQueryResult } from '../types/wails'

export interface AIQueryPanelProps {
  connectionId: string
  database: string
  collection: string
  /** Active query language mode: 'mongo' or 'sql'. */
  queryMode: string
  /** Model alias to use ('sonnet' | 'haiku'). */
  model: string
  /** Called with the generated query when the user clicks "Use query". */
  onUseQuery: (query: string) => void
  /** Close the assistant. */
  onClose: () => void
}

const SparkleIcon = ({ className = 'w-4 h-4' }: { className?: string }): JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
    />
  </svg>
)

const CloseIcon = ({ className = 'w-4 h-4' }: { className?: string }): JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

/**
 * One-shot AI query assistant (F077). The user describes a query in plain words
 * and receives a generated query in the active language mode. No history is
 * kept — closing or switching away discards all state.
 */
export default function AIQueryPanel({
  connectionId,
  database,
  collection,
  queryMode,
  model,
  onUseQuery,
  onClose,
}: AIQueryPanelProps): JSX.Element {
  const { notify } = useNotification()
  const [prompt, setPrompt] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AIQueryResult | null>(null)
  // Monotonic request id: responses from stale requests are ignored.
  const requestIdRef = useRef<number>(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Escape closes the panel, consistent with the app's panel convention.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  const modeLabel = queryMode === 'sql' ? 'SQL' : 'MongoDB'

  const handleGenerate = useCallback(async (): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed) return

    // Bump the request id so any in-flight (or later-resolving) request becomes
    // stale and its result is discarded.
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await window.go?.main?.App?.GenerateAIQuery?.(
        connectionId,
        database,
        collection,
        queryMode,
        trimmed,
        model
      )
      if (reqId !== requestIdRef.current) return // stale response
      if (!res) {
        setError('AI query generation is unavailable.')
        return
      }
      setResult(res)
    } catch (err) {
      if (reqId !== requestIdRef.current) return // stale response
      const msg = err instanceof Error ? err.message : String(err)
      if (/api key|401|unauthor/i.test(msg)) {
        setError('No valid API key. Set your Anthropic API key in Settings → AI.')
      } else if (/deadline|timeout|timed out|context canceled/i.test(msg)) {
        setError('Query generation timed out (60s). Try a simpler prompt.')
      } else {
        setError(msg)
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false)
    }
  }, [prompt, connectionId, database, collection, queryMode, model])

  const handlePromptKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleGenerate()
      }
    },
    [handleGenerate]
  )

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!result?.query) return
    try {
      await navigator.clipboard.writeText(result.query)
      notify.success('Query copied to clipboard')
    } catch {
      notify.error('Failed to copy query')
    }
  }, [result, notify])

  const handleUse = useCallback((): void => {
    if (!result?.query) return
    onUseQuery(result.query)
    notify.success('Query inserted — press Run to execute')
  }, [result, onUseQuery, notify])

  return (
    <div
      role="region"
      aria-label="AI query assistant"
      className="h-full flex flex-col p-4 overflow-auto"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text">
          <SparkleIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI query assistant</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">{modeLabel}</span>
          <span className="text-xs text-text-dim">{collection}</span>
        </div>
        <button
          className="icon-btn p-1 hover:bg-surface-hover text-text-muted"
          onClick={onClose}
          title="Close AI assistant"
          aria-label="Close AI assistant"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Prompt input */}
      <textarea
        ref={textareaRef}
        className="input w-full resize-none font-sans text-sm"
        rows={3}
        placeholder={`Describe the query you want (${modeLabel})… e.g. "the 10 most recent orders over $100"`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handlePromptKeyDown}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          className="btn btn-primary flex items-center gap-1.5"
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim()}
          aria-label="Generate query"
        >
          <SparkleIcon className="w-4 h-4" />
          <span>{loading ? 'Generating…' : 'Generate'}</span>
        </button>
        <span className="text-xs text-text-dim">Cmd/Ctrl+Enter</span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-text-muted text-sm mt-4">
          <div className="spinner" />
          <span>Generating query…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mt-4 p-3 rounded border border-error/40 bg-error/10 text-error text-sm">{error}</div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="mt-4 space-y-3">
          {result.explanation && <p className="text-sm text-text-light">{result.explanation}</p>}
          <pre className="p-3 rounded bg-surface border border-border text-sm font-mono text-text overflow-auto whitespace-pre-wrap">
            {result.query}
          </pre>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" onClick={handleUse}>
              Use query
            </button>
            <button className="btn btn-secondary" onClick={() => void handleCopy()}>
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
