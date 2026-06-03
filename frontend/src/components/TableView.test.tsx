import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import TableView, { loadMaskedColumns, saveMaskedColumns, TableViewProps } from './TableView'
import { MongoDocument } from '../utils/tableViewUtils'

// Mock ResizeObserver
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock

// Mock localStorage - using any to allow calling mock methods
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string): string | null => store[key] || null),
    setItem: vi.fn((key: string, value: string): void => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string): void => {
      delete store[key]
    }),
    clear: vi.fn((): void => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock Settings to avoid dependency issues
vi.mock('./Settings', () => ({
  loadSettings: () => ({ freezeIdColumn: false }),
}))

describe('TableView Field Masking', () => {
  const sampleDocuments: MongoDocument[] = [
    { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'John Doe', email: 'john@example.com', ssn: '123-45-6789' },
    { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'Jane Smith', email: 'jane@example.com', ssn: '987-65-4321' },
    { _id: { $oid: '507f1f77bcf86cd799439013' }, name: 'Bob Wilson', email: 'bob@example.com', ssn: '456-78-9012' },
  ]

  const defaultProps: TableViewProps = {
    documents: sampleDocuments,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    selectedIds: new Set<string>(),
    onSelectionChange: vi.fn(),
    connectionId: 'conn-1',
    database: 'testdb',
    collection: 'users',
  }

  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  describe('loadMaskedColumns', () => {
    it('returns empty Set when localStorage is empty', () => {
      const result = loadMaskedColumns('conn-1', 'testdb', 'users')
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(0)
    })

    it('loads masked columns from localStorage', () => {
      const data = { 'conn-1:testdb:users': ['ssn', 'email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      const result = loadMaskedColumns('conn-1', 'testdb', 'users')
      expect(result).toBeInstanceOf(Set)
      expect(result.has('ssn')).toBe(true)
      expect(result.has('email')).toBe(true)
      expect(result.size).toBe(2)
    })

    it('returns empty Set for different collection', () => {
      const data = { 'conn-1:testdb:users': ['ssn'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      const result = loadMaskedColumns('conn-1', 'testdb', 'orders')
      expect(result.size).toBe(0)
    })

    it('handles malformed JSON gracefully', () => {
      localStorageMock.setItem('mongopal-masked-columns', 'not-valid-json')

      const result = loadMaskedColumns('conn-1', 'testdb', 'users')
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(0)
    })
  })

  describe('saveMaskedColumns', () => {
    it('saves masked columns to localStorage', () => {
      const maskedColumns = new Set(['ssn', 'email'])
      saveMaskedColumns('conn-1', 'testdb', 'users', maskedColumns)

      expect(localStorageMock.setItem).toHaveBeenCalled()
      const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
      expect(savedData['conn-1:testdb:users']).toEqual(['ssn', 'email'])
    })

    it('preserves other collections when saving', () => {
      const existingData = { 'conn-1:testdb:orders': ['creditCard'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(existingData))

      const maskedColumns = new Set(['ssn'])
      saveMaskedColumns('conn-1', 'testdb', 'users', maskedColumns)

      const savedData = JSON.parse(localStorageMock.setItem.mock.calls[1][1])
      expect(savedData['conn-1:testdb:orders']).toEqual(['creditCard'])
      expect(savedData['conn-1:testdb:users']).toEqual(['ssn'])
    })

    it('saves empty array when no columns masked', () => {
      saveMaskedColumns('conn-1', 'testdb', 'users', new Set())

      const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
      expect(savedData['conn-1:testdb:users']).toEqual([])
    })
  })

  describe('rendering masked columns', () => {
    it('displays actual values when column is not masked', () => {
      render(<TableView {...defaultProps} />)

      // Check that actual values are displayed
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })

    it('displays masked values when column is masked', () => {
      // Pre-set masked columns
      const data = { 'conn-1:testdb:users': ['email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      // Email should be masked (8 filled circles)
      const maskedValues = screen.getAllByTitle('Value is masked')
      expect(maskedValues.length).toBeGreaterThan(0)
      expect(maskedValues[0].textContent).toBe('\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF')

      // Name should still be visible
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('shows mask indicator icon in header for masked columns', () => {
      const data = { 'conn-1:testdb:users': ['ssn'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      // The masked column header should have an indicator
      const maskedIndicators = screen.getAllByTitle('Column is masked')
      expect(maskedIndicators.length).toBe(1)
    })

    it('applies special styling to masked column header', () => {
      const data = { 'conn-1:testdb:users': ['email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      // Find the email header text element (it should have amber styling)
      const headers = screen.getAllByRole('columnheader')
      const emailHeader = headers.find(h => h.textContent?.includes('email'))
      expect(emailHeader).toBeInTheDocument()

      // The span inside should have amber text color class
      const span = within(emailHeader!).getByText('email')
      expect(span.className).toContain('text-warning')
    })
  })

  describe('header context menu', () => {
    it('shows context menu on right-click', () => {
      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)

      // Context menu should appear with mask option
      expect(screen.getByRole('menu', { name: 'Column actions' })).toBeInTheDocument()
      expect(screen.getByText('Mask Column')).toBeInTheDocument()
    })

    it('shows "Mask Column" option for unmasked column', () => {
      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)

      expect(screen.getByText('Mask Column')).toBeInTheDocument()
      expect(screen.queryByText('Unmask Column')).not.toBeInTheDocument()
    })

    it('shows "Unmask Column" option for masked column', () => {
      const data = { 'conn-1:testdb:users': ['name'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)

      expect(screen.getByText('Unmask Column')).toBeInTheDocument()
      expect(screen.queryByText('Mask Column')).not.toBeInTheDocument()
    })

    it('toggles mask state when clicking mask option', () => {
      render(<TableView {...defaultProps} />)

      // Open context menu on name column
      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)

      // Click mask option
      fireEvent.click(screen.getByText('Mask Column'))

      // Verify localStorage was updated
      expect(localStorageMock.setItem).toHaveBeenCalled()
      const savedData = JSON.parse(localStorageMock.setItem.mock.calls.find((c: string[]) => c[0] === 'mongopal-masked-columns')![1])
      expect(savedData['conn-1:testdb:users']).toContain('name')
    })

    it('closes context menu after toggling mask', () => {
      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)
      expect(screen.getByRole('menu', { name: 'Column actions' })).toBeInTheDocument()

      fireEvent.click(screen.getByText('Mask Column'))

      // Context menu should be closed
      expect(screen.queryByRole('menu', { name: 'Column actions' })).not.toBeInTheDocument()
    })
  })

  describe('unmask all columns', () => {
    it('shows "Unmask All Columns" when multiple columns are masked', () => {
      const data = { 'conn-1:testdb:users': ['email', 'ssn'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const emailHeader = headers.find(h => h.textContent?.includes('email'))

      fireEvent.contextMenu(emailHeader!)

      expect(screen.getByText('Unmask All Columns')).toBeInTheDocument()
    })

    it('does not show "Unmask All Columns" when only one column is masked', () => {
      const data = { 'conn-1:testdb:users': ['email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const emailHeader = headers.find(h => h.textContent?.includes('email'))

      fireEvent.contextMenu(emailHeader!)

      expect(screen.queryByText('Unmask All Columns')).not.toBeInTheDocument()
    })

    it('clears all masked columns when clicking "Unmask All"', () => {
      const data = { 'conn-1:testdb:users': ['email', 'ssn', 'name'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const emailHeader = headers.find(h => h.textContent?.includes('email'))

      fireEvent.contextMenu(emailHeader!)
      fireEvent.click(screen.getByText('Unmask All Columns'))

      // Verify localStorage was updated with empty array
      const setItemCalls = localStorageMock.setItem.mock.calls.filter((c: string[]) => c[0] === 'mongopal-masked-columns')
      const lastCall = setItemCalls[setItemCalls.length - 1]
      const savedData = JSON.parse(lastCall[1])
      expect(savedData['conn-1:testdb:users']).toEqual([])
    })
  })

  describe('collection change behavior', () => {
    it('reloads masked columns when collection changes', () => {
      const data = {
        'conn-1:testdb:users': ['email'],
        'conn-1:testdb:orders': ['creditCard'],
      }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      const { rerender } = render(<TableView {...defaultProps} />)

      // Initially users collection - email should be masked
      expect(screen.getAllByTitle('Value is masked').length).toBeGreaterThan(0)

      // Change to orders collection
      const ordersDocuments: MongoDocument[] = [
        { _id: { $oid: '507f1f77bcf86cd799439020' }, orderId: 'ORD-001', creditCard: '4111-1111-1111-1111' },
      ]

      rerender(<TableView {...defaultProps} documents={ordersDocuments} collection="orders" />)

      // creditCard should be masked in orders collection
      expect(screen.getAllByTitle('Value is masked').length).toBeGreaterThan(0)
    })
  })

  describe('masked value display', () => {
    it('masked value is not selectable', () => {
      const data = { 'conn-1:testdb:users': ['email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const maskedValues = screen.getAllByTitle('Value is masked')
      maskedValues.forEach(value => {
        expect(value.className).toContain('select-none')
      })
    })

    it('masked value has correct visual styling', () => {
      const data = { 'conn-1:testdb:users': ['email'] }
      localStorageMock.setItem('mongopal-masked-columns', JSON.stringify(data))

      render(<TableView {...defaultProps} />)

      const maskedValues = screen.getAllByTitle('Value is masked')
      maskedValues.forEach(value => {
        expect(value.className).toContain('text-text-dim')
      })
    })
  })

  describe('empty document handling', () => {
    it('renders empty state when no documents', () => {
      render(<TableView {...defaultProps} documents={[]} />)

      expect(screen.getByText('No documents to display')).toBeInTheDocument()
    })
  })

  describe('document context menu positioning', () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

    const setViewport = (width: number, height: number): void => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    }

    const mockDocumentMenuSize = (
      width: number,
      height: number,
      containerRect: Partial<DOMRect> = {}
    ): void => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.getAttribute('aria-label') === 'Document actions') {
          return {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            width,
            height,
            toJSON: () => ({}),
          } as DOMRect
        }

        if (this.className === 'flex-1 overflow-auto') {
          const left = containerRect.left ?? 0
          const top = containerRect.top ?? 0
          const rectWidth = containerRect.width ?? window.innerWidth
          const rectHeight = containerRect.height ?? window.innerHeight
          return {
            x: left,
            y: top,
            left,
            top,
            right: containerRect.right ?? left + rectWidth,
            bottom: containerRect.bottom ?? top + rectHeight,
            width: rectWidth,
            height: rectHeight,
            toJSON: () => ({}),
          } as DOMRect
        }

        return originalGetBoundingClientRect.call(this)
      })
    }

    const openDocumentMenu = (clientX: number, clientY: number): HTMLElement => {
      render(<TableView {...defaultProps} />)

      fireEvent.contextMenu(screen.getByText('John Doe'), { clientX, clientY })

      return screen.getByRole('menu', { name: 'Document actions' })
    }

    afterEach(() => {
      vi.restoreAllMocks()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    })

    it('positions the document actions menu downward when it fits below the pointer', async () => {
      setViewport(800, 600)
      mockDocumentMenuSize(220, 160)

      const menu = openDocumentMenu(100, 120)

      await waitFor(() => {
        expect(menu.style.left).toBe('100px')
        expect(menu.style.top).toBe('120px')
      })
      expect(menu.style.maxHeight).toBe('')
      expect(menu.style.overflowY).toBe('')
    })

    it('positions the document actions menu upward when it fits above the pointer', async () => {
      setViewport(800, 600)
      mockDocumentMenuSize(220, 160)

      const menu = openDocumentMenu(100, 560)

      await waitFor(() => {
        expect(menu.style.left).toBe('100px')
        expect(menu.style.top).toBe('400px')
      })
      expect(menu.style.maxHeight).toBe('')
      expect(menu.style.overflowY).toBe('')
    })

    it('clamps and scrolls the document actions menu when neither direction fully fits', async () => {
      setViewport(800, 400)
      mockDocumentMenuSize(220, 520)

      const menu = openDocumentMenu(100, 180)

      await waitFor(() => {
        expect(menu.style.left).toBe('100px')
        expect(menu.style.top).toBe('8px')
        expect(menu.style.maxHeight).toBe('384px')
        expect(menu.style.overflowY).toBe('auto')
      })
    })

    it('uses viewport space instead of constraining to a short table container', async () => {
      setViewport(800, 600)
      mockDocumentMenuSize(220, 160, { top: 0, bottom: 180, left: 0, right: 800, width: 800, height: 180 })

      const menu = openDocumentMenu(100, 120)

      await waitFor(() => {
        expect(menu.style.left).toBe('100px')
        expect(menu.style.top).toBe('120px')
      })
      expect(menu.style.maxHeight).toBe('')
      expect(menu.style.overflowY).toBe('')
    })
  })

  describe('integration with freeze columns', () => {
    it('shows both mask and freeze options in context menu', () => {
      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)

      expect(screen.getByText('Mask Column')).toBeInTheDocument()
      expect(screen.getByText('Freeze Column')).toBeInTheDocument()
    })

    it('can mask a frozen column', () => {
      // Pre-freeze a column
      const frozenData = { 'conn-1:testdb:users': ['name'] }
      localStorageMock.setItem('mongopal-frozen-columns', JSON.stringify(frozenData))

      render(<TableView {...defaultProps} />)

      const headers = screen.getAllByRole('columnheader')
      const nameHeader = headers.find(h => h.textContent?.includes('name'))

      fireEvent.contextMenu(nameHeader!)
      fireEvent.click(screen.getByText('Mask Column'))

      // Should save masked state
      const setItemCalls = localStorageMock.setItem.mock.calls.filter((c: string[]) => c[0] === 'mongopal-masked-columns')
      expect(setItemCalls.length).toBeGreaterThan(0)
    })
  })
})
