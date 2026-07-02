import { useState, useEffect, useRef, ChangeEvent, ReactNode, JSX } from 'react'
import { useDebug, CATEGORY_COLORS, DEBUG_SOURCE, DebugLogEntry, DebugCategory, DebugSource } from './contexts/DebugContext'
import { useTheme, UI_FONTS, MONO_FONTS } from './contexts/ThemeContext'

// ============================================================================
// Icon Props and Components
// ============================================================================

interface IconProps {
  className?: string
}

const CheckIcon = ({ className = "w-4 h-4" }: IconProps): JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const CloseIcon = ({ className = "w-4 h-4" }: IconProps): JSX.Element => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

// Tab icons
const GeneralIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
  </svg>
)

const EditorIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
)

const SafetyIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
)

const DeveloperIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
)

const AppearanceIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
  </svg>
)

const LargeDocIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
  </svg>
)

const AIIcon = (): JSX.Element => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
)

// ============================================================================
// Settings Types and Defaults
// ============================================================================

export interface AppSettings {
  queryLimit: number
  queryTimeout: number // seconds, 0 = no timeout
  autoFormat: boolean
  confirmDelete: boolean
  wordWrap: boolean
  showLineNumbers: boolean
  freezeIdColumn: boolean
  // Large Document Handling (LDH)
  ldhWarningThresholdKB: number     // avg doc size warning threshold (KB)
  ldhFieldCountThreshold: number    // field count triggering auto-projection
  ldhMaxVisibleColumns: number      // max columns shown by default
  ldhMaxPagePayloadMB: number       // max page payload for adaptive page size (MB)
  ldhArrayDisplayLimit: number      // array elements shown before truncation
  ldhResponseSizeWarningMB: number  // response size estimate warning threshold (MB)
  // AI query assistant (F077) — the API key is NEVER stored here, only in the OS keyring
  aiEnabled: boolean
  aiModel: 'sonnet' | 'haiku'
}

const defaultSettings: AppSettings = {
  queryLimit: 50,
  queryTimeout: 30,
  autoFormat: true,
  confirmDelete: true,
  wordWrap: true,
  showLineNumbers: true,
  freezeIdColumn: false,
  // LDH defaults
  ldhWarningThresholdKB: 512,
  ldhFieldCountThreshold: 50,
  ldhMaxVisibleColumns: 30,
  ldhMaxPagePayloadMB: 10,
  ldhArrayDisplayLimit: 20,
  ldhResponseSizeWarningMB: 10,
  // AI defaults — disabled until the user opts in
  aiEnabled: false,
  aiModel: 'sonnet',
}

const STORAGE_KEY = 'mongopal-settings'

export function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return { ...defaultSettings, ...JSON.parse(saved) }
    }
  } catch (err) {
    console.error('Failed to load settings:', err)
  }
  return defaultSettings
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

// ============================================================================
// Tab Button Component
// ============================================================================

export interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}

function TabButton({ active, onClick, icon, label }: TabButtonProps): JSX.Element {
  return (
    <button
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors w-full text-left ${
        active
          ? 'bg-surface-hover text-text'
          : 'text-text-muted hover:text-text-light hover:bg-surface'
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ============================================================================
// Toggle Setting Component
// ============================================================================

export interface ToggleSettingProps {
  checked: boolean
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  label: string
  description?: string
}

function ToggleSetting({ checked, onChange, label, description }: ToggleSettingProps): JSX.Element {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-2">
      <input
        type="checkbox"
        className="w-4 h-4 mt-0.5 rounded bg-surface-hover border-border-light text-primary focus:ring-primary flex-shrink-0"
        checked={checked}
        onChange={onChange}
      />
      <div>
        <span className="text-sm text-text-light">{label}</span>
        {description && <p className="text-xs text-text-dim mt-0.5">{description}</p>}
      </div>
    </label>
  )
}

// ============================================================================
// Select Setting Component
// ============================================================================

export interface SelectOption {
  value: number
  label: string
}

export interface SelectSettingProps {
  label: string
  description?: string
  value: number
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  options: SelectOption[]
}

function SelectSetting({ label, description, value, onChange, options }: SelectSettingProps): JSX.Element {
  return (
    <div className="py-2">
      <label className="block text-sm text-text-light mb-1.5">{label}</label>
      <select
        className="input w-full"
        value={value}
        onChange={onChange}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {description && <p className="text-xs text-text-dim mt-1.5">{description}</p>}
    </div>
  )
}

// ============================================================================
// Tab Content Components
// ============================================================================

type SettingKey = keyof AppSettings
type SettingValue = AppSettings[SettingKey]

export interface TabContentProps {
  settings: AppSettings
  onChange: (key: SettingKey, value: SettingValue) => void
}

// General tab content
function GeneralTab({ settings, onChange }: TabContentProps): JSX.Element {
  return (
    <div className="space-y-4">
      <SelectSetting
        label="Default query limit"
        description="Number of documents to fetch per page"
        value={settings.queryLimit}
        onChange={(e) => onChange('queryLimit', parseInt(e.target.value, 10))}
        options={[
          { value: 10, label: '10' },
          { value: 25, label: '25' },
          { value: 50, label: '50' },
          { value: 100, label: '100' },
          { value: 200, label: '200' },
          { value: 500, label: '500' },
        ]}
      />
      <SelectSetting
        label="Query timeout"
        description="Cancel queries that take longer than this"
        value={settings.queryTimeout}
        onChange={(e) => onChange('queryTimeout', parseInt(e.target.value, 10))}
        options={[
          { value: 0, label: 'No timeout' },
          { value: 15, label: '15 seconds' },
          { value: 30, label: '30 seconds' },
          { value: 60, label: '1 minute' },
          { value: 120, label: '2 minutes' },
          { value: 300, label: '5 minutes' },
        ]}
      />
    </div>
  )
}

// Editor tab content
function EditorTab({ settings, onChange }: TabContentProps): JSX.Element {
  return (
    <div className="space-y-1">
      <ToggleSetting
        checked={settings.freezeIdColumn}
        onChange={(e) => onChange('freezeIdColumn', e.target.checked)}
        label="Freeze _id column"
        description="Keep the _id column visible when scrolling horizontally"
      />
      <ToggleSetting
        checked={settings.autoFormat}
        onChange={(e) => onChange('autoFormat', e.target.checked)}
        label="Auto-format JSON"
        description="Automatically format JSON when viewing documents"
      />
      <ToggleSetting
        checked={settings.wordWrap}
        onChange={(e) => onChange('wordWrap', e.target.checked)}
        label="Word wrap in editor"
        description="Wrap long lines in the document editor"
      />
      <ToggleSetting
        checked={settings.showLineNumbers}
        onChange={(e) => onChange('showLineNumbers', e.target.checked)}
        label="Show line numbers"
        description="Display line numbers in the document editor"
      />
    </div>
  )
}

// Safety tab content
function SafetyTab({ settings, onChange }: TabContentProps): JSX.Element {
  return (
    <div className="space-y-1">
      <ToggleSetting
        checked={settings.confirmDelete}
        onChange={(e) => onChange('confirmDelete', e.target.checked)}
        label="Confirm before delete"
        description="Show confirmation dialog when deleting documents"
      />
    </div>
  )
}

// ============================================================================
// Number Input Setting Component
// ============================================================================

export interface NumberInputSettingProps {
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}

function NumberInputSetting({ label, description, value, onChange, min = 0, max = 99999, step = 1, suffix }: NumberInputSettingProps): JSX.Element {
  return (
    <div className="py-2">
      <label className="block text-sm text-text-light mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input w-28"
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= min && v <= max) onChange(v)
          }}
          min={min}
          max={max}
          step={step}
        />
        {suffix && <span className="text-sm text-text-muted">{suffix}</span>}
      </div>
      {description && <p className="text-xs text-text-dim mt-1.5">{description}</p>}
    </div>
  )
}

// Large Document Handling tab content
function LargeDocumentTab({ settings, onChange }: TabContentProps): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-dim mb-2">
        Configure how MongoPal handles collections with large documents, many fields, or deep nesting.
      </p>
      <NumberInputSetting
        label="Warning threshold (avg doc size)"
        description="Show a health warning when average document size exceeds this value"
        value={settings.ldhWarningThresholdKB}
        onChange={(v) => onChange('ldhWarningThresholdKB', v)}
        min={64}
        max={16384}
        suffix="KB"
      />
      <NumberInputSetting
        label="Field count threshold"
        description="Trigger auto-projection when collections have more top-level fields than this"
        value={settings.ldhFieldCountThreshold}
        onChange={(v) => onChange('ldhFieldCountThreshold', v)}
        min={10}
        max={500}
        suffix="fields"
      />
      <NumberInputSetting
        label="Max visible columns"
        description="Columns beyond this cap are hidden by default (toggle in column dropdown)"
        value={settings.ldhMaxVisibleColumns}
        onChange={(v) => onChange('ldhMaxVisibleColumns', v)}
        min={5}
        max={500}
        suffix="columns"
      />
      <NumberInputSetting
        label="Max page payload"
        description="Estimated page response size limit for adaptive page size and pre-query warnings"
        value={settings.ldhMaxPagePayloadMB}
        onChange={(v) => onChange('ldhMaxPagePayloadMB', v)}
        min={1}
        max={100}
        suffix="MB"
      />
      <NumberInputSetting
        label="Array display limit"
        description="Truncate array rendering in table cells after this many elements"
        value={settings.ldhArrayDisplayLimit}
        onChange={(v) => onChange('ldhArrayDisplayLimit', v)}
        min={5}
        max={1000}
        suffix="items"
      />
      <NumberInputSetting
        label="Response size warning"
        description="Warn before executing a query when estimated response exceeds this size"
        value={settings.ldhResponseSizeWarningMB}
        onChange={(v) => onChange('ldhResponseSizeWarningMB', v)}
        min={1}
        max={100}
        suffix="MB"
      />
    </div>
  )
}

// ============================================================================
// AI Tab Component (F077)
// ============================================================================

type AIKeyStatus = 'env' | 'configured' | 'not_set' | 'error' | 'unknown'

function AITab({ settings, onChange }: TabContentProps): JSX.Element {
  const [keyStatus, setKeyStatus] = useState<AIKeyStatus>('unknown')
  const [keyInput, setKeyInput] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [message, setMessage] = useState<string | null>(null)

  const refreshStatus = async (): Promise<void> => {
    try {
      const status = await window.go?.main?.App?.GetAIAPIKeyStatus?.()
      setKeyStatus((status as AIKeyStatus) || 'not_set')
    } catch {
      setKeyStatus('not_set')
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  const fromEnv = keyStatus === 'env'

  const handleSaveKey = async (): Promise<void> => {
    const trimmed = keyInput.trim()
    if (!trimmed) return
    setBusy(true)
    setMessage(null)
    try {
      await window.go?.main?.App?.SetAIAPIKey?.(trimmed)
      setKeyInput('')
      setMessage('API key saved')
      await refreshStatus()
    } catch (err) {
      setMessage(`Failed to save key: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleClearKey = async (): Promise<void> => {
    if (!window.confirm('Remove the stored Anthropic API key?')) return
    setBusy(true)
    setMessage(null)
    try {
      await window.go?.main?.App?.ClearAIAPIKey?.()
      setMessage('API key cleared')
      await refreshStatus()
    } catch (err) {
      setMessage(`Failed to clear key: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const statusLabel =
    keyStatus === 'env'
      ? 'Set from environment variable'
      : keyStatus === 'configured'
      ? 'Configured (stored in OS keyring)'
      : keyStatus === 'not_set'
      ? 'Not set'
      : keyStatus === 'error'
      ? 'Keyring error — could not read stored key'
      : 'Checking…'

  return (
    <div className="space-y-4">
      <ToggleSetting
        checked={settings.aiEnabled}
        onChange={(e) => onChange('aiEnabled', e.target.checked)}
        label="Enable AI query assistant"
        description="Show a sparkle button in the query bar to generate queries from a plain-language description"
      />

      <div className="py-2">
        <label className="block text-sm text-text-light mb-1.5">Model</label>
        <select
          className="input w-full"
          value={settings.aiModel}
          onChange={(e) => onChange('aiModel', e.target.value as 'sonnet' | 'haiku')}
        >
          <option value="sonnet">Sonnet (higher quality)</option>
          <option value="haiku">Haiku (faster, cheaper)</option>
        </select>
      </div>

      <div className="py-2 border-t border-border">
        <label className="block text-sm text-text-light mb-1.5">Anthropic API key</label>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-text-muted">Status:</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              keyStatus === 'error'
                ? 'bg-error/15 text-error'
                : keyStatus === 'not_set' || keyStatus === 'unknown'
                ? 'bg-surface-hover text-text-muted'
                : 'bg-primary/15 text-primary'
            }`}
          >
            {statusLabel}
          </span>
        </div>
        {fromEnv ? (
          <p className="text-xs text-text-dim">
            The key is provided by the <code>ANTHROPIC_API_KEY</code> environment variable and cannot be changed here.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              className="input flex-1"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
            <button
              className="btn btn-primary"
              onClick={handleSaveKey}
              disabled={busy || !keyInput.trim()}
            >
              Set
            </button>
            {keyStatus === 'configured' && (
              <button className="btn btn-ghost text-text-muted" onClick={handleClearKey} disabled={busy}>
                Clear
              </button>
            )}
          </div>
        )}
        {message && <p className="text-xs text-text-dim mt-1.5">{message}</p>}
      </div>

      <p className="text-xs text-text-dim border-t border-border pt-3">
        Privacy: only the collection's inferred schema (field names, types, and how often each appears) is sent to
        Anthropic. Document values, connection URIs, and credentials are never included.
      </p>
    </div>
  )
}

// ============================================================================
// Appearance Tab Component
// ============================================================================

function AppearanceTab(): JSX.Element {
  const { themes, currentTheme, setTheme, reloadThemes, openThemesDir, uiFontId, monoFontId, setUIFont, setMonoFont } = useTheme()

  // Color swatches for theme preview
  const renderSwatches = (colors: { background: string; surface: string; primary: string; text: string; error: string; info: string }): JSX.Element => (
    <div className="flex gap-0.5 mt-1">
      {[colors.background, colors.surface, colors.primary, colors.text, colors.error, colors.info].map((c, i) => (
        <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Theme selector */}
      <div>
        <label className="block text-sm text-text-light mb-2">Theme</label>
        <div className="grid grid-cols-2 gap-2">
          {themes.map(theme => (
            <button
              key={theme.id}
              className={`p-3 rounded-lg border text-left transition-colors ${
                currentTheme?.id === theme.id
                  ? 'border-primary bg-surface-hover/50'
                  : 'border-border hover:border-border-light hover:bg-surface'
              }`}
              onClick={() => setTheme(theme.id)}
            >
              <div className="text-sm font-medium text-text">{theme.name}</div>
              {theme.author && <div className="text-xs text-text-dim mt-0.5">{theme.author}</div>}
              {renderSwatches(theme.colors)}
            </button>
          ))}
        </div>
      </div>

      {/* Font selectors */}
      <div>
        <label className="block text-sm text-text-light mb-1.5">UI Font</label>
        <select
          className="input w-full"
          value={uiFontId}
          onChange={e => setUIFont(e.target.value)}
        >
          {UI_FONTS.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-text-light mb-1.5">Monospace Font</label>
        <select
          className="input w-full"
          value={monoFontId}
          onChange={e => setMonoFont(e.target.value)}
        >
          {MONO_FONTS.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* User themes actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <button className="btn btn-ghost text-sm" onClick={openThemesDir}>
          Open Themes Folder
        </button>
        <button className="btn btn-ghost text-sm" onClick={reloadThemes}>
          Reload Themes
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Log Entry Component
// ============================================================================

interface LogEntryProps {
  log: DebugLogEntry
}

function LogEntry({ log }: LogEntryProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasDetails = log.details !== null && log.details !== undefined

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const categoryColor = CATEGORY_COLORS[log.category]?.ui || 'text-text-muted'
  const source: DebugSource = log.source || DEBUG_SOURCE.FRONTEND
  const isBackend = source === DEBUG_SOURCE.BACKEND

  return (
    <div className="border-b border-surface last:border-0">
      <div
        className={`flex gap-2 py-1 leading-tight ${hasDetails ? 'cursor-pointer hover:bg-surface/50' : ''}`}
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
      >
        {/* Expand indicator */}
        <span className="text-text-dim w-3 flex-shrink-0">
          {hasDetails && (
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </span>
        {/* Source indicator */}
        <span className={`flex-shrink-0 w-5 text-center rounded text-[10px] font-medium ${
          isBackend ? 'bg-cyan-900/50 text-cyan-400' : 'bg-surface-hover/50 text-text-muted'
        }`}>
          {isBackend ? 'BE' : 'FE'}
        </span>
        <span className="text-text-dim flex-shrink-0">{formatTime(log.timestamp)}</span>
        <span className={`flex-shrink-0 ${categoryColor}`}>
          [{log.category}]
        </span>
        <span className="text-text-secondary truncate flex-1">{log.message}</span>
      </div>
      {/* Expandable details */}
      {isExpanded && hasDetails && (
        <div className="ml-5 pl-3 pb-2 border-l border-border">
          <pre className="text-text-dim text-[10px] whitespace-pre-wrap break-all">
            {JSON.stringify(log.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Developer Tab Component
// ============================================================================

interface ExportLogEntry {
  timestamp: string
  source: DebugSource | 'fe'
  category: DebugCategory
  message: string
  details?: unknown
}

// Wails window type - cast window to this type when accessing Wails-specific properties
interface WailsWindow {
  go?: {
    main?: {
      App?: {
        SaveDebugLogs?: (text: string, filename: string) => Promise<void>
      }
    }
  }
}

function DeveloperTab(): JSX.Element {
  const { isDebugEnabled, toggleDebug, logs, clearLogs } = useDebug()
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [copySuccess, setCopySuccess] = useState(false)

  // Format logs for export (with all details expanded)
  const formatLogsForExport = (): ExportLogEntry[] => {
    return logs.map(log => {
      const entry: ExportLogEntry = {
        timestamp: log.timestamp,
        source: log.source || 'fe',
        category: log.category,
        message: log.message,
      }
      if (log.details !== null && log.details !== undefined) {
        entry.details = log.details
      }
      return entry
    })
  }

  const handleCopyAll = async (): Promise<void> => {
    const exportData = formatLogsForExport()
    const text = JSON.stringify(exportData, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy logs:', err)
    }
  }

  const handleSaveToFile = async (): Promise<void> => {
    const exportData = formatLogsForExport()
    const text = JSON.stringify(exportData, null, 2)
    const defaultFilename = `mongopal-debug-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`

    try {
      const go = (window as WailsWindow).go?.main?.App
      if (go?.SaveDebugLogs) {
        await go.SaveDebugLogs(text, defaultFilename)
      } else {
        // Fallback for dev mode
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultFilename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('Failed to save logs:', err)
    }
  }

  return (
    <div className="space-y-4">
      <ToggleSetting
        checked={isDebugEnabled}
        onChange={toggleDebug}
        label="Debug logging"
        description="Log detailed debug information (also visible in browser console)"
      />

      {/* Debug log viewer */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-text-secondary">Debug Logs</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-dim">{logs.length} entries</span>
            {logs.length > 0 && (
              <>
                <button
                  className="text-xs text-text-muted hover:text-text-light transition-colors flex items-center gap-1"
                  onClick={handleCopyAll}
                  title="Copy all logs to clipboard"
                >
                  {copySuccess ? (
                    <>
                      <CheckIcon className="w-3 h-3 text-primary" />
                      <span className="text-primary">Copied</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  className="text-xs text-text-muted hover:text-text-light transition-colors flex items-center gap-1"
                  onClick={handleSaveToFile}
                  title="Save logs to file"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Save</span>
                </button>
                <button
                  className="text-xs text-text-muted hover:text-text-light transition-colors"
                  onClick={clearLogs}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        <div
          ref={logContainerRef}
          className="bg-background rounded border border-border h-56 overflow-y-auto font-mono text-xs"
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-dim">
              {isDebugEnabled ? 'No logs yet. Interact with the app to generate logs.' : 'Enable debug logging to see logs here.'}
            </div>
          ) : (
            <div className="p-2">
              {logs.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>

        {isDebugEnabled && (
          <p className="text-xs text-text-dim mt-2">
            Click entries with details to expand. Also logged to browser console.
          </p>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Settings Component
// ============================================================================

type TabId = 'appearance' | 'general' | 'editor' | 'safety' | 'largedoc' | 'ai' | 'developer'

interface Tab {
  id: TabId
  label: string
  icon: JSX.Element
}

export interface SettingsProps {
  onClose: () => void
}

export default function Settings({ onClose }: SettingsProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('appearance')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [showSaved, setShowSaved] = useState(false)
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = (key: SettingKey, value: SettingValue): void => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    saveSettings(newSettings)

    // Show saved indicator
    setShowSaved(true)
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current)
    }
    savedTimeoutRef.current = setTimeout(() => {
      setShowSaved(false)
    }, 1500)
  }

  const handleReset = (): void => {
    setSettings(defaultSettings)
    saveSettings(defaultSettings)

    // Show saved indicator
    setShowSaved(true)
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current)
    }
    savedTimeoutRef.current = setTimeout(() => {
      setShowSaved(false)
    }, 1500)
  }

  const tabs: Tab[] = [
    { id: 'appearance', label: 'Appearance', icon: <AppearanceIcon /> },
    { id: 'general', label: 'General', icon: <GeneralIcon /> },
    { id: 'editor', label: 'Editor', icon: <EditorIcon /> },
    { id: 'safety', label: 'Safety', icon: <SafetyIcon /> },
    { id: 'largedoc', label: 'Large Docs', icon: <LargeDocIcon /> },
    { id: 'ai', label: 'AI', icon: <AIIcon /> },
    { id: 'developer', label: 'Developer', icon: <DeveloperIcon /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-secondary text-text rounded-lg shadow-xl w-full max-w-2xl mx-4 border border-border flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-text">Settings</h2>
            <div
              className={`flex items-center gap-1 text-sm text-primary transition-opacity duration-200 ${
                showSaved ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <CheckIcon className="w-4 h-4" />
              <span>Saved</span>
            </div>
          </div>
          <button
            className="icon-btn p-1 hover:bg-surface-hover"
            onClick={onClose}
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-40 border-r border-border p-2 flex-shrink-0">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <TabButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  icon={tab.icon}
                  label={tab.label}
                />
              ))}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 p-4 overflow-y-auto">
            {activeTab === 'appearance' && (
              <AppearanceTab />
            )}
            {activeTab === 'general' && (
              <GeneralTab settings={settings} onChange={handleChange} />
            )}
            {activeTab === 'editor' && (
              <EditorTab settings={settings} onChange={handleChange} />
            )}
            {activeTab === 'safety' && (
              <SafetyTab settings={settings} onChange={handleChange} />
            )}
            {activeTab === 'largedoc' && (
              <LargeDocumentTab settings={settings} onChange={handleChange} />
            )}
            {activeTab === 'ai' && (
              <AITab settings={settings} onChange={handleChange} />
            )}
            {activeTab === 'developer' && (
              <DeveloperTab />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface flex-shrink-0">
          <button
            className="btn btn-ghost text-text-muted"
            onClick={handleReset}
          >
            Reset to defaults
          </button>
          <button
            className="btn btn-primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
