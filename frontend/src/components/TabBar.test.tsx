import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TabBar from './TabBar'
import { useTab, Tab, TabContextValue } from './contexts/TabContext'

// Mock the TabContext to control tab state
vi.mock('./contexts/TabContext', async () => {
  const actual = await vi.importActual('./contexts/TabContext')
  return {
    ...actual,
    useTab: vi.fn(),
  }
})

// Type the mocked useTab
const mockedUseTab = useTab as Mock

describe('TabBar', () => {
  const mockSetActiveTab = vi.fn()
  const mockCloseTab = vi.fn()
  const mockOpenNewQueryTab = vi.fn()
  const mockPinTab = vi.fn()
  const mockRenameTab = vi.fn()
  const mockReorderTabs = vi.fn()
  const mockConvertViewOnlyToEditable = vi.fn()

  const defaultMockContext: TabContextValue = {
    tabs: [],
    activeTab: null,
    currentTab: undefined,
    setActiveTab: mockSetActiveTab,
    closeTab: mockCloseTab,
    openNewQueryTab: mockOpenNewQueryTab,
    pinTab: mockPinTab,
    renameTab: mockRenameTab,
    reorderTabs: mockReorderTabs,
    openTab: vi.fn(),
    openDocumentTab: vi.fn(),
    openViewDocumentTab: vi.fn(),
    openInsertTab: vi.fn(),
    openSchemaTab: vi.fn(),
    openIndexTab: vi.fn(),
    convertInsertToDocumentTab: vi.fn(),
    convertViewOnlyToEditable: mockConvertViewOnlyToEditable,
    setTabDirty: vi.fn(),
    markTabActivated: vi.fn(),
    updateTabDocument: vi.fn(),
    closeTabsForConnection: vi.fn(),
    closeTabsForDatabase: vi.fn(),
    closeTabsForCollection: vi.fn(),
    closeAllTabs: vi.fn(),
    keepOnlyConnectionTabs: vi.fn(),
    nextTab: vi.fn(),
    previousTab: vi.fn(),
    goToTab: vi.fn(),
    closeActiveTab: vi.fn(),
    sessionConnections: [],
    trackConnection: vi.fn(),
    untrackConnection: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedUseTab.mockReturnValue(defaultMockContext)
  })

  // Helper to create a test tab
  const createTab = (overrides: Partial<Tab> = {}): Tab => ({
    id: 'tab-1',
    type: 'collection',
    connectionId: 'conn-1',
    database: 'testdb',
    collection: 'testcol',
    label: 'testcol',
    color: '#4CC38A',
    pinned: false,
    ...overrides,
  })

  describe('empty state', () => {
    it('displays "No open tabs" when no tabs exist', () => {
      render(<TabBar />)
      expect(screen.getByText('No open tabs')).toBeInTheDocument()
    })

    it('does not show add tab button when no tabs', () => {
      render(<TabBar />)
      expect(screen.queryByTitle('New Query Tab')).not.toBeInTheDocument()
    })
  })

  describe('tab rendering', () => {
    it('renders collection tabs with correct label', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByText('users')).toBeInTheDocument()
    })

    it('renders document tabs with document icon', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', type: 'document', label: 'abc123...' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByText('abc123...')).toBeInTheDocument()
    })

    it('renders edit affordance for view-only document tabs', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'view-tab', type: 'document', label: 'abc123...', viewOnly: true })],
        activeTab: 'view-tab',
      })

      render(<TabBar />)
      expect(screen.getByLabelText('Make abc123... editable')).toBeInTheDocument()
    })

    it('renders insert tabs with plus icon label', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', type: 'insert', label: 'New Document' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByText('New Document')).toBeInTheDocument()
    })

    it('renders schema tabs', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', type: 'schema', label: 'Schema: users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByText('Schema: users')).toBeInTheDocument()
    })

    it('renders multiple tabs', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
          createTab({ id: 'tab-3', type: 'document', label: 'doc123...' }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByText('users')).toBeInTheDocument()
      expect(screen.getByText('orders')).toBeInTheDocument()
      expect(screen.getByText('doc123...')).toBeInTheDocument()
    })
  })

  describe('tab selection', () => {
    it('calls setActiveTab when tab is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.click(screen.getByText('orders'))
      expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2')
    })

    it('applies active styling to selected tab', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      expect(tab).toHaveClass('active')
    })
  })

  describe('view-only conversion', () => {
    it('converts a view-only document tab without activating it as a side effect', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'view-tab', type: 'document', label: 'abc123...', viewOnly: true })],
        activeTab: 'other-tab',
      })

      render(<TabBar />)
      fireEvent.click(screen.getByLabelText('Make abc123... editable'))

      expect(mockConvertViewOnlyToEditable).toHaveBeenCalledWith('view-tab')
      expect(mockSetActiveTab).not.toHaveBeenCalled()
    })
  })

  describe('close button', () => {
    it('closes tab when close button is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      const closeBtn = tab?.querySelector('button')
      if (closeBtn) fireEvent.click(closeBtn)
      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
    })

    it('does not show close button for pinned tabs', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users', pinned: true })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      // Pinned tabs shouldn't have close button (only pin icon)
      expect(tab?.querySelector('button')).not.toBeInTheDocument()
    })
  })

  describe('pinned tabs', () => {
    it('sorts pinned tabs first', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'unpinned', pinned: false }),
          createTab({ id: 'tab-2', label: 'pinned', pinned: true }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tabs = screen.getAllByText(/pinned|unpinned/)
      expect(tabs[0]).toHaveTextContent('pinned')
      expect(tabs[1]).toHaveTextContent('unpinned')
    })
  })

  describe('new query tab button', () => {
    it('renders add tab button when tabs exist', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      expect(screen.getByTitle('New Query Tab')).toBeInTheDocument()
    })

    it('calls openNewQueryTab when add button clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.click(screen.getByTitle('New Query Tab'))
      expect(mockOpenNewQueryTab).toHaveBeenCalled()
    })
  })

  describe('tab editing', () => {
    it('enters edit mode on double click', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.doubleClick(screen.getByText('users'))

      // Should show input field
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('users')
    })

    it('calls renameTab on Enter', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.doubleClick(screen.getByText('users'))

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'renamed' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(mockRenameTab).toHaveBeenCalledWith('tab-1', 'renamed')
    })

    it('cancels edit on Escape', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.doubleClick(screen.getByText('users'))

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'renamed' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(mockRenameTab).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('saves on blur', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      fireEvent.doubleClick(screen.getByText('users'))

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new-name' } })
      fireEvent.blur(input)

      expect(mockRenameTab).toHaveBeenCalledWith('tab-1', 'new-name')
    })
  })

  describe('context menu', () => {
    it('shows context menu on right click', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)

      expect(screen.getByText('Rename')).toBeInTheDocument()
      expect(screen.getByText('Pin')).toBeInTheDocument()
      expect(screen.getByText('Close Tab')).toBeInTheDocument()
    })

    it('shows Unpin option for pinned tabs', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users', pinned: true })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)

      expect(screen.getByText('Unpin')).toBeInTheDocument()
    })

    it('calls pinTab when Pin is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Pin'))

      expect(mockPinTab).toHaveBeenCalledWith('tab-1')
    })

    it('calls closeTab when Close Tab is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [createTab({ id: 'tab-1', label: 'users' })],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Close Tab'))

      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
    })

    it('shows Close Others and Close All options', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)

      expect(screen.getByText('Close Others')).toBeInTheDocument()
      expect(screen.getByText('Close All')).toBeInTheDocument()
    })

    it('closes all other unpinned tabs when Close Others is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
          createTab({ id: 'tab-3', label: 'products' }),
          createTab({ id: 'tab-4', label: 'pinned-tab', pinned: true }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Close Others'))

      // Should close tab-2 and tab-3 (unpinned others), but not tab-1 (right-clicked) or tab-4 (pinned)
      expect(mockCloseTab).toHaveBeenCalledWith('tab-2')
      expect(mockCloseTab).toHaveBeenCalledWith('tab-3')
      expect(mockCloseTab).toHaveBeenCalledTimes(2)
    })

    it('closes all unpinned tabs when Close All is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
          createTab({ id: 'tab-3', label: 'products' }),
          createTab({ id: 'tab-4', label: 'pinned-tab', pinned: true }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Close All'))

      // Should close all unpinned tabs (tab-1, tab-2, tab-3), but not tab-4 (pinned)
      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
      expect(mockCloseTab).toHaveBeenCalledWith('tab-2')
      expect(mockCloseTab).toHaveBeenCalledWith('tab-3')
      expect(mockCloseTab).toHaveBeenCalledTimes(3)
    })

    it('does not close pinned tabs when Close All is clicked', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users', pinned: true }),
          createTab({ id: 'tab-2', label: 'orders', pinned: true }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')
      if (tab) fireEvent.contextMenu(tab)
      fireEvent.click(screen.getByText('Close All'))

      // No tabs should be closed (all are pinned)
      expect(mockCloseTab).not.toHaveBeenCalled()
    })
  })

  describe('drag and drop', () => {
    it('sets dragged tab on drag start', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const tab = screen.getByText('users').closest('.tab')

      const dataTransfer = { effectAllowed: '', setData: vi.fn() }
      if (tab) fireEvent.dragStart(tab, { dataTransfer })

      expect(dataTransfer.effectAllowed).toBe('move')
      expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'tab-1')
    })

    it('calls reorderTabs on drop', () => {
      mockedUseTab.mockReturnValue({
        ...defaultMockContext,
        tabs: [
          createTab({ id: 'tab-1', label: 'users' }),
          createTab({ id: 'tab-2', label: 'orders' }),
        ],
        activeTab: 'tab-1',
      })

      render(<TabBar />)
      const usersTab = screen.getByText('users').closest('.tab')
      const ordersTab = screen.getByText('orders').closest('.tab')

      // Start drag
      const dataTransfer = { effectAllowed: '', setData: vi.fn() }
      if (usersTab) fireEvent.dragStart(usersTab, { dataTransfer })

      // Drop on orders tab
      if (ordersTab) {
        fireEvent.dragOver(ordersTab)
        fireEvent.drop(ordersTab)
      }

      expect(mockReorderTabs).toHaveBeenCalledWith('tab-1', 'tab-2')
    })
  })
})
