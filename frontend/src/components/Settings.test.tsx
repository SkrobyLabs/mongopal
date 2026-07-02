// Mock monacoConfig to avoid jsdom incompatibility (monaco-editor uses queryCommandSupported)
vi.mock('../monacoConfig', () => ({
  regenerateMonacoThemes: vi.fn(),
  monaco: { editor: { defineTheme: vi.fn(), setTheme: vi.fn() } },
}))

// Mock ThemeContext to avoid needing ThemeProvider (which depends on Wails runtime)
vi.mock('./contexts/ThemeContext', async () => {
  const actual = await vi.importActual<typeof import('./contexts/ThemeContext')>('./contexts/ThemeContext')
  return {
    ...actual,
    useTheme: () => ({
      themes: [],
      currentTheme: null,
      setTheme: vi.fn(),
      reloadThemes: vi.fn(),
      openThemesDir: vi.fn(),
      uiFontId: 'system',
      monoFontId: 'jetbrains',
      setUIFont: vi.fn(),
      setMonoFont: vi.fn(),
    }),
  }
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Settings, { loadSettings, saveSettings, AppSettings } from './Settings'
import { DebugProvider } from './contexts/DebugContext'
import { ReactNode } from 'react'

// Helper to render with required providers
const renderWithProviders = (ui: ReactNode) => {
  return render(
    <DebugProvider>
      {ui}
    </DebugProvider>
  )
}

describe('Settings', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('loadSettings', () => {
    it('returns default settings when localStorage is empty', () => {
      const settings = loadSettings()

      expect(settings).toEqual({
        queryLimit: 50,
        queryTimeout: 30,
        autoFormat: true,
        confirmDelete: true,
        wordWrap: true,
        showLineNumbers: true,
        freezeIdColumn: false,
        ldhWarningThresholdKB: 512,
        ldhFieldCountThreshold: 50,
        ldhMaxVisibleColumns: 30,
        ldhMaxPagePayloadMB: 10,
        ldhArrayDisplayLimit: 20,
        ldhResponseSizeWarningMB: 10,
        aiEnabled: false,
        aiModel: 'sonnet',
      })
    })

    it('returns saved settings from localStorage', () => {
      localStorage.setItem('mongopal-settings', JSON.stringify({
        queryLimit: 100,
        autoFormat: false,
      }))

      const settings = loadSettings()

      expect(settings.queryLimit).toBe(100)
      expect(settings.autoFormat).toBe(false)
      // Defaults for missing values
      expect(settings.confirmDelete).toBe(true)
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('mongopal-settings', 'invalid json')

      const settings = loadSettings()

      expect(settings).toEqual({
        queryLimit: 50,
        queryTimeout: 30,
        autoFormat: true,
        confirmDelete: true,
        wordWrap: true,
        showLineNumbers: true,
        freezeIdColumn: false,
        ldhWarningThresholdKB: 512,
        ldhFieldCountThreshold: 50,
        ldhMaxVisibleColumns: 30,
        ldhMaxPagePayloadMB: 10,
        ldhArrayDisplayLimit: 20,
        ldhResponseSizeWarningMB: 10,
        aiEnabled: false,
        aiModel: 'sonnet',
      })
    })
  })

  describe('saveSettings', () => {
    it('saves settings to localStorage', () => {
      const settings: AppSettings = {
        queryLimit: 200,
        queryTimeout: 30,
        autoFormat: false,
        confirmDelete: true,
        wordWrap: true,
        showLineNumbers: true,
        freezeIdColumn: false,
        ldhWarningThresholdKB: 512,
        ldhFieldCountThreshold: 50,
        ldhMaxVisibleColumns: 30,
        ldhMaxPagePayloadMB: 10,
        ldhArrayDisplayLimit: 20,
        ldhResponseSizeWarningMB: 10,
        aiEnabled: false,
        aiModel: 'sonnet',
      }
      saveSettings(settings)

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.queryLimit).toBe(200)
      expect(saved.autoFormat).toBe(false)
    })
  })

  describe('rendering', () => {
    it('renders settings dialog with tabs', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      expect(screen.getByText('Settings')).toBeInTheDocument()
      // Check tabs exist
      expect(screen.getByRole('button', { name: /appearance/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /safety/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /large docs/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /developer/i })).toBeInTheDocument()
    })

    it('renders query limit dropdown with default value on General tab', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      expect(screen.getByText('Default query limit')).toBeInTheDocument()
      const selects = screen.getAllByRole('combobox')
      expect(selects[0]).toHaveValue('50')
    })

    it('renders query timeout dropdown with default value on General tab', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      expect(screen.getByText('Query timeout')).toBeInTheDocument()
      const selects = screen.getAllByRole('combobox')
      expect(selects[1]).toHaveValue('30')
    })

    it('renders editor options on Editor tab', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Click Editor tab
      fireEvent.click(screen.getByRole('button', { name: /editor/i }))

      expect(screen.getByText('Auto-format JSON')).toBeInTheDocument()
      expect(screen.getByText('Word wrap in editor')).toBeInTheDocument()
      expect(screen.getByText('Show line numbers')).toBeInTheDocument()
      expect(screen.getByText('Freeze _id column')).toBeInTheDocument()
    })

    it('renders safety options on Safety tab', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Click Safety tab
      fireEvent.click(screen.getByRole('button', { name: /safety/i }))

      expect(screen.getByText('Confirm before delete')).toBeInTheDocument()
    })

    it('renders developer options on Developer tab', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Click Developer tab
      fireEvent.click(screen.getByRole('button', { name: /developer/i }))

      expect(screen.getByText('Debug logging')).toBeInTheDocument()
      expect(screen.getByText('Debug Logs')).toBeInTheDocument()
    })

    it('renders reset button', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      expect(screen.getByText('Reset to defaults')).toBeInTheDocument()
    })

    it('renders done button', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      expect(screen.getByText('Done')).toBeInTheDocument()
    })
  })

  describe('query limit', () => {
    it('changes query limit and persists to localStorage', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      const select = selects[0] // queryLimit is first
      fireEvent.change(select, { target: { value: '100' } })

      expect(select).toHaveValue('100')

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.queryLimit).toBe(100)
    })

    it('shows all query limit options', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const options = screen.getAllByRole('option')
      const values = options.map(o => (o as HTMLOptionElement).value)

      // Query limit options
      expect(values).toContain('10')
      expect(values).toContain('25')
      expect(values).toContain('50')
      expect(values).toContain('100')
      expect(values).toContain('200')
      expect(values).toContain('500')
      // Query timeout options
      expect(values).toContain('0') // No timeout
      expect(values).toContain('15')
      expect(values).toContain('30')
      expect(values).toContain('60')
    })
  })

  describe('query timeout', () => {
    it('changes query timeout and persists to localStorage', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      const select = selects[1] // queryTimeout is second
      fireEvent.change(select, { target: { value: '60' } })

      expect(select).toHaveValue('60')

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.queryTimeout).toBe(60)
    })

    it('allows disabling timeout', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      const select = selects[1]
      fireEvent.change(select, { target: { value: '0' } })

      expect(select).toHaveValue('0')

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.queryTimeout).toBe(0)
    })
  })

  describe('toggle options', () => {
    it('toggles autoFormat and persists', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Navigate to Editor tab
      fireEvent.click(screen.getByRole('button', { name: /editor/i }))

      const checkbox = screen.getByRole('checkbox', { name: /auto-format json/i })
      expect(checkbox).toBeChecked() // default is true

      fireEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.autoFormat).toBe(false)
    })

    it('toggles wordWrap and persists', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Navigate to Editor tab
      fireEvent.click(screen.getByRole('button', { name: /editor/i }))

      const checkbox = screen.getByRole('checkbox', { name: /word wrap in editor/i })
      expect(checkbox).toBeChecked()

      fireEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.wordWrap).toBe(false)
    })

    it('toggles showLineNumbers and persists', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Navigate to Editor tab
      fireEvent.click(screen.getByRole('button', { name: /editor/i }))

      const checkbox = screen.getByRole('checkbox', { name: /show line numbers/i })
      expect(checkbox).toBeChecked()

      fireEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.showLineNumbers).toBe(false)
    })

    it('toggles confirmDelete and persists', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Navigate to Safety tab
      fireEvent.click(screen.getByRole('button', { name: /safety/i }))

      const checkbox = screen.getByRole('checkbox', { name: /confirm before delete/i })
      expect(checkbox).toBeChecked()

      fireEvent.click(checkbox)
      expect(checkbox).not.toBeChecked()

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.confirmDelete).toBe(false)
    })
  })

  describe('reset to defaults', () => {
    it('resets all settings to default values', () => {
      // Set some non-default values
      localStorage.setItem('mongopal-settings', JSON.stringify({
        queryLimit: 200,
        queryTimeout: 60,
        autoFormat: false,
        confirmDelete: false,
      }))

      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByText('Reset to defaults'))

      const saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.queryLimit).toBe(50)
      expect(saved.queryTimeout).toBe(30)
      expect(saved.autoFormat).toBe(true)
      expect(saved.confirmDelete).toBe(true)
    })
  })

  describe('close button', () => {
    it('calls onClose when Done button is clicked', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByText('Done'))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when close icon is clicked', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // The close button is an icon-btn
      const closeButtons = screen.getAllByRole('button')
      const closeIcon = closeButtons.find(btn =>
        btn.classList.contains('icon-btn') ||
        btn.querySelector('svg path[d*="M6 18L18 6"]')
      )

      if (closeIcon) {
        fireEvent.click(closeIcon)
        expect(mockOnClose).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('loading saved settings', () => {
    it('loads saved settings on render', () => {
      localStorage.setItem('mongopal-settings', JSON.stringify({
        queryLimit: 100,
        queryTimeout: 60,
      }))

      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      expect(selects[0]).toHaveValue('100')
      expect(selects[1]).toHaveValue('60')
    })
  })

  describe('save confirmation feedback', () => {
    it('shows saved indicator when a setting changes', async () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: '100' } })

      expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    it('hides saved indicator after timeout', async () => {
      vi.useFakeTimers()

      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')
      fireEvent.change(selects[0], { target: { value: '100' } })

      expect(screen.getByText('Saved')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1500)
      })

      // The "Saved" text still exists but should have opacity-0
      const savedIndicator = screen.getByText('Saved').parentElement
      expect(savedIndicator).toHaveClass('opacity-0')

      vi.useRealTimers()
    })

    it('shows saved indicator when reset to defaults is clicked', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByText('Reset to defaults'))

      expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    it('resets timeout when multiple changes occur', async () => {
      vi.useFakeTimers()

      renderWithProviders(<Settings onClose={mockOnClose} />)

      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      const selects = screen.getAllByRole('combobox')

      // First change
      fireEvent.change(selects[0], { target: { value: '100' } })
      expect(screen.getByText('Saved')).toBeInTheDocument()

      // Advance halfway
      act(() => {
        vi.advanceTimersByTime(750)
      })

      // Second change
      fireEvent.change(selects[0], { target: { value: '200' } })

      // Advance another 750ms (total 1500ms from first, but only 750ms from second)
      act(() => {
        vi.advanceTimersByTime(750)
      })

      // Should still be visible because timer was reset
      const savedIndicator = screen.getByText('Saved').parentElement
      expect(savedIndicator).toHaveClass('opacity-100')

      vi.useRealTimers()
    })
  })

  describe('tab navigation', () => {
    it('switches between tabs correctly', () => {
      renderWithProviders(<Settings onClose={mockOnClose} />)

      // Initially on Appearance tab (default)
      expect(screen.getByText('UI Font')).toBeInTheDocument()

      // Switch to General
      fireEvent.click(screen.getByRole('button', { name: /general/i }))
      expect(screen.getByText('Default query limit')).toBeInTheDocument()
      expect(screen.queryByText('UI Font')).not.toBeInTheDocument()

      // Switch to Editor
      fireEvent.click(screen.getByRole('button', { name: /editor/i }))
      expect(screen.getByText('Auto-format JSON')).toBeInTheDocument()
      expect(screen.queryByText('Default query limit')).not.toBeInTheDocument()

      // Switch to Safety
      fireEvent.click(screen.getByRole('button', { name: /safety/i }))
      expect(screen.getByText('Confirm before delete')).toBeInTheDocument()
      expect(screen.queryByText('Auto-format JSON')).not.toBeInTheDocument()

      // Switch to Developer
      fireEvent.click(screen.getByRole('button', { name: /developer/i }))
      expect(screen.getByText('Debug logging')).toBeInTheDocument()
      expect(screen.queryByText('Confirm before delete')).not.toBeInTheDocument()

      // Back to Appearance
      fireEvent.click(screen.getByRole('button', { name: /appearance/i }))
      expect(screen.getByText('UI Font')).toBeInTheDocument()
    })
  })

  describe('AI tab (F077)', () => {
    beforeEach(() => {
      if (window.go?.main?.App) {
        window.go.main.App.GetAIAPIKeyStatus = vi.fn().mockResolvedValue('not_set')
        window.go.main.App.SetAIAPIKey = vi.fn().mockResolvedValue(undefined)
        window.go.main.App.ClearAIAPIKey = vi.fn().mockResolvedValue(undefined)
      }
    })

    const openAITab = async (): Promise<void> => {
      renderWithProviders(<Settings onClose={mockOnClose} />)
      fireEvent.click(screen.getByRole('button', { name: /^ai$/i }))
      // Wait for the async status fetch to settle.
      await screen.findByText('Enable AI query assistant')
    }

    it('renders AI options and privacy note', async () => {
      await openAITab()
      expect(screen.getByText('Enable AI query assistant')).toBeInTheDocument()
      expect(screen.getByText(/only the collection's inferred schema/i)).toBeInTheDocument()
      expect(screen.getByText('Anthropic API key')).toBeInTheDocument()
    })

    it('persists the enable toggle and model to localStorage', async () => {
      await openAITab()

      const toggle = screen.getByRole('checkbox')
      fireEvent.click(toggle)
      let saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.aiEnabled).toBe(true)

      const modelSelect = screen.getByRole('combobox')
      fireEvent.change(modelSelect, { target: { value: 'haiku' } })
      saved = JSON.parse(localStorage.getItem('mongopal-settings') || '{}')
      expect(saved.aiModel).toBe('haiku')
    })

    it('saves the API key via the binding and never to localStorage', async () => {
      await openAITab()

      const keyInput = screen.getByPlaceholderText(/sk-ant-/i)
      fireEvent.change(keyInput, { target: { value: 'sk-ant-secret' } })
      fireEvent.click(screen.getByRole('button', { name: /^set$/i }))

      await waitForBinding(() => {
        expect(window.go?.main?.App?.SetAIAPIKey).toHaveBeenCalledWith('sk-ant-secret')
      })

      const stored = JSON.stringify(localStorage)
      expect(stored).not.toContain('sk-ant-secret')
    })

    it('clears the API key via the binding when configured', async () => {
      if (window.go?.main?.App) {
        window.go.main.App.GetAIAPIKeyStatus = vi.fn().mockResolvedValue('configured')
      }
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      renderWithProviders(<Settings onClose={mockOnClose} />)
      fireEvent.click(screen.getByRole('button', { name: /^ai$/i }))
      await screen.findByText(/Configured \(stored in OS keyring\)/i)

      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))
      await waitForBinding(() => {
        expect(window.go?.main?.App?.ClearAIAPIKey).toHaveBeenCalled()
      })
      confirmSpy.mockRestore()
    })

    it('surfaces a keyring read error status', async () => {
      if (window.go?.main?.App) {
        window.go.main.App.GetAIAPIKeyStatus = vi.fn().mockResolvedValue('error')
      }
      renderWithProviders(<Settings onClose={mockOnClose} />)
      fireEvent.click(screen.getByRole('button', { name: /^ai$/i }))

      await screen.findByText(/Keyring error/i)
      // The input remains available so the user can retry.
      expect(screen.getByPlaceholderText(/sk-ant-/i)).toBeInTheDocument()
    })

    it('reflects env-provided key by hiding the input', async () => {
      if (window.go?.main?.App) {
        window.go.main.App.GetAIAPIKeyStatus = vi.fn().mockResolvedValue('env')
      }
      renderWithProviders(<Settings onClose={mockOnClose} />)
      fireEvent.click(screen.getByRole('button', { name: /^ai$/i }))

      await screen.findByText(/cannot be changed here/i)
      expect(screen.queryByPlaceholderText(/sk-ant-/i)).not.toBeInTheDocument()
    })
  })
})

// Small helper to await async binding assertions without importing waitFor twice.
async function waitForBinding(fn: () => void): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      fn()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  fn()
}
