import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

// =============================================================================
// Type Definitions for Mocks
// =============================================================================

interface MockNotify {
  success: Mock
  error: Mock
  warning: Mock
}

interface MockConnection {
  id: string
  name: string
  uri: string
  folderId?: string
}

interface MockDatabase {
  name: string
}

interface MockCollection {
  name: string
  count: number
}

// =============================================================================
// Mocks
// =============================================================================

// Mock the notification context
vi.mock('./NotificationContext', () => ({
  useNotification: (): { notify: MockNotify } => ({
    notify: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
  }),
}))

vi.mock('./CSVExportDialog', () => ({
  default: () => null,
}))

vi.mock('./JSONExportDialog', () => ({
  default: () => null,
}))

// Mock the connection context
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockDisconnectAll = vi.fn()
const mockDisconnectOthers = vi.fn()
const mockSetSelectedConnection = vi.fn()
const mockSetSelectedDatabase = vi.fn()
const mockSetSelectedCollection = vi.fn()
const mockDuplicateConnection = vi.fn()
const mockRefreshConnection = vi.fn()
const mockDropDatabase = vi.fn()
const mockDropCollection = vi.fn()
const mockClearCollection = vi.fn()
const mockCreateFolder = vi.fn()
const mockDeleteFolder = vi.fn()
const mockMoveConnectionToFolder = vi.fn()
const mockMoveFolderToFolder = vi.fn()
const mockLoadConnections = vi.fn()
const mockIsConnecting = vi.fn().mockReturnValue(false)
const mockOpenTab = vi.fn()
const mockCloseAllTabs = vi.fn()
let mockActiveConnections = ['conn1']

vi.mock('./contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connections: [
      { id: 'conn1', name: 'Production Server', uri: 'mongodb://localhost:27017' },
      { id: 'conn2', name: 'Development Server', uri: 'mongodb://localhost:27018' },
      { id: 'conn3', name: 'Test Environment', uri: 'mongodb://localhost:27019' },
    ] as MockConnection[],
    folders: [],
    activeConnections: mockActiveConnections,
    isConnecting: mockIsConnecting,
    connect: mockConnect,
    disconnect: mockDisconnect,
    disconnectAll: mockDisconnectAll,
    disconnectOthers: mockDisconnectOthers,
    setSelectedConnection: mockSetSelectedConnection,
    setSelectedDatabase: mockSetSelectedDatabase,
    setSelectedCollection: mockSetSelectedCollection,
    duplicateConnection: mockDuplicateConnection,
    refreshConnection: mockRefreshConnection,
    dropDatabase: mockDropDatabase,
    dropCollection: mockDropCollection,
    clearCollection: mockClearCollection,
    createFolder: mockCreateFolder,
    deleteFolder: mockDeleteFolder,
    moveConnectionToFolder: mockMoveConnectionToFolder,
    moveFolderToFolder: mockMoveFolderToFolder,
    loadConnections: mockLoadConnections,
  }),
}))

// Mock the tab context
vi.mock('./contexts/TabContext', () => ({
  useTab: () => ({
    openTab: mockOpenTab,
    openSchemaTab: vi.fn(),
    closeTabsForConnection: vi.fn(),
    closeTabsForDatabase: vi.fn(),
    closeTabsForCollection: vi.fn(),
    closeAllTabs: mockCloseAllTabs,
    keepOnlyConnectionTabs: vi.fn(),
  }),
}))

// Mock window.go
beforeEach(() => {
  mockActiveConnections = ['conn1']
  // Update the existing window.go from test setup
  if (window.go?.main?.App) {
    window.go.main.App.ListDatabases = vi.fn().mockResolvedValue([
      { name: 'myapp_production' },
      { name: 'myapp_staging' },
      { name: 'analytics' },
    ] as MockDatabase[])
    window.go.main.App.ListCollections = vi.fn().mockResolvedValue([
      { name: 'users', count: 1000 },
      { name: 'orders', count: 5000 },
      { name: 'products', count: 500 },
    ] as MockCollection[])
    window.go.main.App.UpdateDatabaseAccessed = vi.fn().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// Import after mocks are set up
import Sidebar from './sidebar'
import type { SidebarProps } from './sidebar'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Helper to check if a text content is present in tree items
 */
const findTreeItemWithText = (container: HTMLElement, text: string): boolean => {
  const treeItems = container.querySelectorAll('.tree-item')
  return Array.from(treeItems).some(item => item.textContent?.includes(text))
}

const getTreeItemWithText = (container: HTMLElement, text: string): HTMLElement => {
  const treeItems = container.querySelectorAll('.tree-item')
  const item = Array.from(treeItems).find(item => item.textContent?.includes(text))
  if (!item) {
    throw new Error(`Could not find tree item containing "${text}"`)
  }
  return item as HTMLElement
}

// =============================================================================
// Tests
// =============================================================================

describe('Sidebar Search', () => {
  const defaultProps: SidebarProps = {
    onManageConnections: vi.fn(),
    onEditConnection: vi.fn(),
    onDeleteConnection: vi.fn(),
    onExportDatabases: vi.fn(),
    onImportDatabases: vi.fn(),
    onExportCollections: vi.fn(),
    onImportCollections: vi.fn(),
    onShowStats: vi.fn(),
    onManageIndexes: vi.fn(),
  }

  it('renders search input with correct placeholder', () => {
    render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')
    expect(searchInput).toBeInTheDocument()
  })

  it('filters connections by name when typing in search', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    // All connections should be visible initially
    expect(findTreeItemWithText(container, 'Production Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Development Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Test Environment')).toBe(true)

    // Type in search
    fireEvent.change(searchInput, { target: { value: 'Production' } })

    // Only Production Server should be visible
    expect(findTreeItemWithText(container, 'Production Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Development Server')).toBe(false)
    expect(findTreeItemWithText(container, 'Test Environment')).toBe(false)
  })

  it('alt-click multi-selects connections and deselects selected connections', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')
    const development = getTreeItemWithText(container, 'Development Server')

    fireEvent.click(production, { altKey: true })
    fireEvent.click(development, { altKey: true })

    expect(production).toHaveAttribute('data-selected', 'true')
    expect(development).toHaveAttribute('data-selected', 'true')

    fireEvent.click(production, { altKey: true })

    expect(production).toHaveAttribute('data-selected', 'false')
    expect(development).toHaveAttribute('data-selected', 'true')
  })

  it('command-click multi-selects connections on macOS-style input', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')
    const development = getTreeItemWithText(container, 'Development Server')

    fireEvent.click(production, { metaKey: true })
    fireEvent.click(development, { metaKey: true })

    expect(production).toHaveAttribute('data-selected', 'true')
    expect(development).toHaveAttribute('data-selected', 'true')
  })

  it('normal click resets multi-selection to a single item', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')
    const development = getTreeItemWithText(container, 'Development Server')
    const test = getTreeItemWithText(container, 'Test Environment')

    fireEvent.click(production, { altKey: true })
    fireEvent.click(development, { altKey: true })
    fireEvent.click(test)

    expect(production).toHaveAttribute('data-selected', 'false')
    expect(development).toHaveAttribute('data-selected', 'false')
    expect(test).toHaveAttribute('data-selected', 'true')
  })

  it('shift-click selects a same-type range from the last selected item', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')
    const development = getTreeItemWithText(container, 'Development Server')
    const test = getTreeItemWithText(container, 'Test Environment')

    fireEvent.click(development)
    fireEvent.click(test, { shiftKey: true })

    expect(production).toHaveAttribute('data-selected', 'true')
    expect(development).toHaveAttribute('data-selected', 'true')
    expect(test).toHaveAttribute('data-selected', 'true')
  })

  it('does not multi-select different resource types', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(production)

    await waitFor(() => {
      expect(findTreeItemWithText(container, 'myapp_production')).toBe(true)
    })

    const database = getTreeItemWithText(container, 'myapp_production')
    fireEvent.click(production, { altKey: true })
    fireEvent.click(database, { altKey: true })

    expect(production).toHaveAttribute('data-selected', 'false')
    expect(database).toHaveAttribute('data-selected', 'true')
  })

  it('shows plural database actions when opening context menu on a selected database group', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const production = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(production)

    await waitFor(() => {
      expect(findTreeItemWithText(container, 'myapp_production')).toBe(true)
    })

    const productionDb = getTreeItemWithText(container, 'myapp_production')
    const stagingDb = getTreeItemWithText(container, 'myapp_staging')
    fireEvent.click(productionDb, { altKey: true })
    fireEvent.click(stagingDb, { altKey: true })
    fireEvent.contextMenu(stagingDb)

    expect(screen.getByText('Drop Databases...')).toBeInTheDocument()
    expect(screen.queryByText('Drop Database...')).not.toBeInTheDocument()
    expect(screen.queryByText('Import...')).not.toBeInTheDocument()
  })

  it('shows clear button when search has text', () => {
    render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    // No clear button initially
    expect(screen.queryByTitle('Clear search')).not.toBeInTheDocument()

    // Type in search
    fireEvent.change(searchInput, { target: { value: 'test' } })

    // Clear button should appear
    expect(screen.getByTitle('Clear search')).toBeInTheDocument()
  })

  it('clears search when clicking clear button', () => {
    render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...') as HTMLInputElement

    // Type in search
    fireEvent.change(searchInput, { target: { value: 'test' } })
    expect(searchInput.value).toBe('test')

    // Click clear button
    const clearButton = screen.getByTitle('Clear search')
    fireEvent.click(clearButton)

    // Search should be cleared
    expect(searchInput.value).toBe('')
  })

  it('performs case-insensitive search', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    // Type lowercase
    fireEvent.change(searchInput, { target: { value: 'production' } })

    // Should still find Production Server
    expect(findTreeItemWithText(container, 'Production Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Development Server')).toBe(false)
  })

  it('shows "No matching connections" when search has no results', () => {
    render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    // Type something that doesn't match anything
    fireEvent.change(searchInput, { target: { value: 'zzznomatch' } })

    // Should show no matching message
    expect(screen.getByText('No matching connections')).toBeInTheDocument()
  })

  it('shows partial text matches', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    // Search for "Server" which matches two connections
    fireEvent.change(searchInput, { target: { value: 'Server' } })

    // Both servers should match
    expect(findTreeItemWithText(container, 'Production Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Development Server')).toBe(true)
    expect(findTreeItemWithText(container, 'Test Environment')).toBe(false)
  })

  it('highlights matching text in connection names', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText('Search connections, databases, collections...')

    fireEvent.change(searchInput, { target: { value: 'Prod' } })

    // Look for highlight span with the matching text using CSS class selector
    const highlightedSpans = container.querySelectorAll('span.bg-warning\\/30')
    expect(highlightedSpans.length).toBeGreaterThan(0)
    expect(highlightedSpans[0].textContent).toBe('Prod')
    expect(highlightedSpans[0].classList.contains('text-warning')).toBe(true)
  })

  it('does not connect or expand a disconnected connection on single click', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const developmentServer = getTreeItemWithText(container, 'Development Server')

    vi.clearAllMocks()
    fireEvent.click(developmentServer)

    expect(mockConnect).not.toHaveBeenCalled()
    expect(findTreeItemWithText(container, 'myapp_production')).toBe(false)
  })

  it('connects a disconnected connection on double click', () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const developmentServer = getTreeItemWithText(container, 'Development Server')

    vi.clearAllMocks()
    fireEvent.doubleClick(developmentServer)

    expect(mockConnect).toHaveBeenCalledWith('conn2')
  })

  it('selects but does not load a database on single click', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const productionServer = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(productionServer)
    await screen.findByText('myapp_production')
    const productionDatabase = getTreeItemWithText(container, 'myapp_production')

    vi.clearAllMocks()
    fireEvent.click(productionDatabase)

    expect(mockSetSelectedDatabase).toHaveBeenCalledWith('myapp_production')
    expect(window.go?.main?.App?.ListCollections).not.toHaveBeenCalled()
    expect(findTreeItemWithText(container, 'users')).toBe(false)
  })

  it('selects and loads a database on double click', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const productionServer = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(productionServer)
    await screen.findByText('myapp_production')
    const productionDatabase = getTreeItemWithText(container, 'myapp_production')

    vi.clearAllMocks()
    fireEvent.doubleClick(productionDatabase)

    expect(mockSetSelectedDatabase).toHaveBeenCalledWith('myapp_production')
    await screen.findByText('users')
    expect(window.go?.main?.App?.ListCollections).toHaveBeenCalledWith('conn1', 'myapp_production')
  })

  it('selects a collection on single click without opening a tab', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const productionServer = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(productionServer)
    await screen.findByText('myapp_production')
    const productionDatabase = getTreeItemWithText(container, 'myapp_production')
    fireEvent.doubleClick(productionDatabase)
    await screen.findByText('users')
    const usersCollection = getTreeItemWithText(container, 'users')

    vi.clearAllMocks()
    fireEvent.click(usersCollection)

    expect(mockSetSelectedCollection).toHaveBeenCalledWith('users')
    expect(mockOpenTab).not.toHaveBeenCalled()
  })

  it('opens a collection on double click', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const productionServer = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(productionServer)
    await screen.findByText('myapp_production')
    const productionDatabase = getTreeItemWithText(container, 'myapp_production')
    fireEvent.doubleClick(productionDatabase)
    await screen.findByText('users')
    const usersCollection = getTreeItemWithText(container, 'users')

    vi.clearAllMocks()
    fireEvent.doubleClick(usersCollection)

    await waitFor(() => {
      expect(mockOpenTab).toHaveBeenCalledWith('conn1', 'myapp_production', 'users')
    })
  })

  it('disconnects all active connections from the toolbar button', async () => {
    render(<Sidebar {...defaultProps} />)

    const disconnectAllButton = screen.getByRole('button', { name: 'Disconnect all connections' })
    expect(disconnectAllButton).toHaveAttribute('title', 'Disconnect All (1)')

    fireEvent.click(disconnectAllButton)

    await waitFor(() => {
      expect(mockDisconnectAll).toHaveBeenCalledTimes(1)
    })
    expect(mockDisconnectAll).toHaveBeenCalledWith(mockCloseAllTabs)
  })

  it('prevents duplicate disconnect all clicks while pending', async () => {
    let resolveDisconnect!: () => void
    mockDisconnectAll.mockReturnValueOnce(new Promise<void>(resolve => {
      resolveDisconnect = resolve
    }))

    render(<Sidebar {...defaultProps} />)

    const disconnectAllButton = screen.getByRole('button', { name: 'Disconnect all connections' })
    fireEvent.click(disconnectAllButton)

    await waitFor(() => {
      expect(disconnectAllButton).toBeDisabled()
    })

    fireEvent.click(disconnectAllButton)
    expect(mockDisconnectAll).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDisconnect()
    })
  })

  it('clears sidebar selection and loaded tree data after disconnect all', async () => {
    const { container } = render(<Sidebar {...defaultProps} />)
    const productionServer = getTreeItemWithText(container, 'Production Server')

    fireEvent.doubleClick(productionServer)
    await screen.findByText('myapp_production')

    const productionDatabase = getTreeItemWithText(container, 'myapp_production')
    fireEvent.doubleClick(productionDatabase)
    await screen.findByText('users')

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect all connections' }))

    await waitFor(() => {
      expect(mockDisconnectAll).toHaveBeenCalledWith(mockCloseAllTabs)
    })
    expect(mockSetSelectedConnection).toHaveBeenCalledWith(null)
    expect(mockSetSelectedDatabase).toHaveBeenCalledWith(null)
    expect(mockSetSelectedCollection).toHaveBeenCalledWith(null)

    await waitFor(() => {
      expect(findTreeItemWithText(container, 'myapp_production')).toBe(false)
      expect(findTreeItemWithText(container, 'users')).toBe(false)
    })
  })

  it('hides the disconnect all toolbar button when no connections are active', () => {
    mockActiveConnections = []

    render(<Sidebar {...defaultProps} />)

    expect(screen.queryByRole('button', { name: 'Disconnect all connections' })).not.toBeInTheDocument()
  })
})
