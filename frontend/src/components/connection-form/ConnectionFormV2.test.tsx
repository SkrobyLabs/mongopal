/**
 * ConnectionFormV2 Tests
 *
 * NOTE: Some tests are currently failing due to complex DOM queries and conditional rendering.
 * TODO: Refine test selectors and add data-testid attributes to improve test reliability.
 *
 * Current status: 17/27 tests passing (63%)
 * - All core functionality tests pass
 * - Some edge case tests need refinement
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConnectionFormV2 } from './ConnectionFormV2'

// Mock connection type
interface MockSavedConnection {
  id: string
  name: string
  uri: string
  folderId: string
  color: string
  readOnly: boolean
  createdAt: string
  lastAccessedAt: string
}

// Mock window.go.main.App
const mockTestConnection = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  // Partial mock of Wails bindings for testing
  ;(window as any).go = {
    main: {
      App: {
        TestConnection: mockTestConnection,
      },
    },
  }
})

const mockFolders = [
  { id: 'folder1', name: 'Folder 1' },
  { id: 'folder2', name: 'Folder 2' },
]

const mockConnection: MockSavedConnection = {
  id: 'conn1',
  name: 'Test Connection',
  uri: 'mongodb://localhost:27017',
  folderId: '',
  color: '#4CC38A',
  readOnly: false,
  createdAt: '2024-01-01T00:00:00Z',
  lastAccessedAt: '',
}

describe('ConnectionFormV2', () => {
  describe('Form Mode', () => {
    it('renders in Form mode by default', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      expect(screen.getByText('New Connection')).toBeInTheDocument()
      expect(screen.getByText('Connection')).toBeInTheDocument()
      expect(screen.getByText('Authentication')).toBeInTheDocument()
      expect(screen.getByText('Network')).toBeInTheDocument()
      expect(screen.getByText('Options')).toBeInTheDocument()
      expect(screen.getByText('Safety')).toBeInTheDocument()
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })

    it('shows Edit Connection when editing', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 connection={mockConnection} folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      expect(screen.getByText('Edit Connection')).toBeInTheDocument()
    })

    it('displays form tabs', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Tab navigation should be present (6 tabs)
      expect(screen.getByText('Connection')).toBeInTheDocument()
      expect(screen.getByText('Authentication')).toBeInTheDocument()
      expect(screen.getByText('Network')).toBeInTheDocument()
      expect(screen.getByText('Options')).toBeInTheDocument()
      expect(screen.getByText('Safety')).toBeInTheDocument()
      expect(screen.getByText('Appearance')).toBeInTheDocument()
    })

    it('switches between tabs', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Enable advanced mode to see all sections
      const advancedToggle = screen.getByTestId('advanced-toggle')
      fireEvent.click(advancedToggle)

      // Click Authentication tab
      fireEvent.click(screen.getByText('Authentication'))
      expect(screen.getByText('Authentication Mechanism')).toBeInTheDocument()

      // Click Network tab
      fireEvent.click(screen.getByText('Network'))
      expect(screen.getByText('SSH Tunnel')).toBeInTheDocument()

      // Click Options tab
      fireEvent.click(screen.getByText('Options'))
      expect(screen.getByText('Connection Pool')).toBeInTheDocument()

      // Click Safety tab
      fireEvent.click(screen.getByText('Safety'))
      expect(screen.getByText('Destructive Operation Safety')).toBeInTheDocument()
    })

    it('updates form data when fields change', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Find connection name input by test ID
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: 'New Connection Name' } })

      expect(nameInput).toHaveValue('New Connection Name')
    })

    it('calls onCancel when Cancel button is clicked', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      const cancelButton = screen.getAllByText('Cancel')[0] // Get first Cancel button
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('URI Mode', () => {
    it('switches to URI mode', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Find and click URI mode toggle
      const uriModeButton = screen.getByText('URI')
      fireEvent.click(uriModeButton)

      // Should show generated URI and action buttons
      expect(screen.getByText('Copy URI')).toBeInTheDocument()
      expect(screen.getByText('Import from URI...')).toBeInTheDocument()
    })

    it('parses URI into form fields', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Switch to URI mode
      fireEvent.click(screen.getByText('URI'))

      // Open import overlay
      fireEvent.click(screen.getByText('Import from URI...'))

      // Enter a URI in the overlay textarea
      const textarea = screen.getByPlaceholderText(/mongodb:\/\//)
      fireEvent.change(textarea, {
        target: { value: 'mongodb://user:pass@localhost:27017/mydb' }
      })

      // Click Parse
      fireEvent.click(screen.getByText('Parse into Form'))

      // Should switch back to Form mode
      await waitFor(() => {
        expect(screen.getByText('Connection')).toBeInTheDocument()
      })
    })

    it('shows error for invalid URI', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Switch to URI mode
      fireEvent.click(screen.getByText('URI'))

      // Open import overlay
      fireEvent.click(screen.getByText('Import from URI...'))

      // Enter an invalid URI
      const textarea = screen.getByPlaceholderText(/mongodb:\/\//)
      fireEvent.change(textarea, { target: { value: 'invalid-uri' } })

      // Click Parse
      fireEvent.click(screen.getByText('Parse into Form'))

      // Should show error in overlay
      await waitFor(() => {
        expect(screen.getByText(/Failed to parse URI/)).toBeInTheDocument()
      })
    })
  })

  describe('Connection Types', () => {
    it('renders standalone connection fields', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Should show host and port fields by default (standalone)
      expect(screen.getByPlaceholderText(/localhost/i)).toBeInTheDocument()
    })

    it('switches to replica set mode', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Select replica set from dropdown
      const connectionTypeSelect = screen.getByTestId('connection-type-select')
      fireEvent.change(connectionTypeSelect, { target: { value: 'replicaset' } })

      // Should show replica set name field
      await waitFor(() => {
        expect(screen.getByTestId('replica-set-name')).toBeInTheDocument()
      })
    })

    it('switches to SRV mode', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Select SRV from dropdown
      const connectionTypeSelect = screen.getByTestId('connection-type-select')
      fireEvent.change(connectionTypeSelect, { target: { value: 'srv' } })

      // Should show SRV hostname field
      await waitFor(() => {
        expect(screen.getByTestId('srv-hostname')).toBeInTheDocument()
      })
    })
  })

  describe('Validation', () => {
    it('shows validation errors for empty required fields', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Clear connection name
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: '' } })

      // Try to save (button should be disabled)
      const saveButton = screen.getByText('Save Connection')
      expect(saveButton).toBeDisabled()

      // Should show validation error (appears in multiple places - field and summary)
      await waitFor(() => {
        const errors = screen.getAllByText('Connection name is required')
        expect(errors.length).toBeGreaterThan(0)
      })

      expect(onSave).not.toHaveBeenCalled()
    })

    it('disables save button when there are errors', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Clear required field
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: '' } })

      // Save button should be disabled
      const saveButton = screen.getByText('Save Connection')
      expect(saveButton).toBeDisabled()
    })

    it('shows tab badges with error counts', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Clear connection name to trigger validation error
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: '' } })

      // Connection tab should show error badge
      await waitFor(() => {
        const connectionTab = screen.getByText('Connection').closest('button')
        expect(connectionTab).toHaveTextContent('1') // Error count
      })
    })
  })

  describe('Test Connection', () => {
    it('calls TestConnection API', async () => {
      mockTestConnection.mockResolvedValue({
        success: true,
        serverVersion: '7.0.4',
        topology: 'standalone',
        latency: 42,
      })

      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Click Test Connection
      const testButton = screen.getByText('Test Connection')
      fireEvent.click(testButton)

      // Should show testing state
      await waitFor(() => {
        expect(screen.getByText('Testing...')).toBeInTheDocument()
      })

      // Should call API
      expect(mockTestConnection).toHaveBeenCalledTimes(1)

      // Should show success message with server details
      await waitFor(() => {
        expect(screen.getByText(/Connection successful/i)).toBeInTheDocument()
        expect(screen.getByText(/MongoDB 7\.0\.4/)).toBeInTheDocument()
      })
    })

    it('shows error when test fails', async () => {
      mockTestConnection.mockResolvedValue({
        success: false,
        error: 'Connection refused',
        hint: 'Check that MongoDB is running',
      })

      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Click Test Connection
      const testButton = screen.getByText('Test Connection')
      fireEvent.click(testButton)

      // Should show error message with hint
      await waitFor(() => {
        expect(screen.getByText(/Connection failed/i)).toBeInTheDocument()
        expect(screen.getByText(/Connection refused/)).toBeInTheDocument()
      })
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('closes on Escape key', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('navigates tabs with Cmd+[', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Go to Authentication tab
      fireEvent.click(screen.getByText('Authentication'))

      // Press Cmd+[ to go to previous tab
      fireEvent.keyDown(window, { key: '[', metaKey: true })

      // Should be back on Connection tab
      await waitFor(() => {
        const connectionTab = screen.getByText('Connection').closest('button')
        expect(connectionTab).toHaveClass('border-primary') // Active tab class
      })
    })

    it('navigates tabs with Cmd+]', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Press Cmd+] to go to next tab
      fireEvent.keyDown(window, { key: ']', metaKey: true })

      // Should be on Authentication tab
      await waitFor(() => {
        const authTab = screen.getByText('Authentication').closest('button')
        expect(authTab).toHaveClass('border-primary') // Active tab class
      })
    })
  })

  describe('Safety Tab', () => {
    it('allows configuring delay and confirmation settings', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Go to Safety tab
      fireEvent.click(screen.getByText('Safety'))

      // Delay slider should be present
      expect(screen.getByText('Delay Before Destructive Operations')).toBeInTheDocument()

      // Confirmation checkbox should be present
      expect(screen.getByText(/Require typing "DELETE"/)).toBeInTheDocument()
    })

    it('allows color selection on Appearance tab', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Go to Appearance tab (color picker moved from Safety)
      fireEvent.click(screen.getByText('Appearance'))

      // Should show color picker
      const colorButtons = screen.getAllByRole('button', { name: /Blue|Red|Green/ })
      expect(colorButtons.length).toBeGreaterThan(0)
    })
  })

  describe('Save Functionality', () => {
    it('calls onSave with ExtendedConnection data', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Fill in connection name
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: 'Test Connection' } })

      // Click Save
      const saveButton = screen.getByText('Save Connection')
      fireEvent.click(saveButton)

      // Should call onSave with extended connection data
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1)
        const savedData = onSave.mock.calls[0][0]
        expect(savedData).toHaveProperty('name', 'Test Connection')
        expect(savedData).toHaveProperty('mongoUri')
        expect(savedData).toHaveProperty('destructiveDelay')
        expect(savedData).toHaveProperty('requireDeleteConfirmation')
        expect(savedData).toHaveProperty('formData') // JSON blob
      })
    })

    it('includes SSH credentials when SSH is enabled', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Fill in connection name
      const nameInput = screen.getByTestId('connection-name')
      fireEvent.change(nameInput, { target: { value: 'SSH Connection' } })

      // Enable advanced mode to access SSH settings
      const advancedToggle = screen.getByTestId('advanced-toggle')
      fireEvent.click(advancedToggle)

      // Go to Network tab
      fireEvent.click(screen.getByText('Network'))

      // Enable SSH
      const sshCheckbox = screen.getByTestId('ssh-enabled')
      fireEvent.click(sshCheckbox)

      // Wait for SSH fields to appear
      await waitFor(() => {
        expect(screen.getByTestId('ssh-host')).toBeInTheDocument()
      })

      // Fill SSH fields (host, username, password for password auth method)
      const sshHostInput = screen.getByTestId('ssh-host')
      fireEvent.change(sshHostInput, { target: { value: 'ssh.example.com' } })

      const sshUserInput = screen.getByPlaceholderText('ubuntu')
      fireEvent.change(sshUserInput, { target: { value: 'testuser' } })

      const sshPasswordInput = screen.getByPlaceholderText('••••••••')
      fireEvent.change(sshPasswordInput, { target: { value: 'testpassword' } })

      // Click Save
      const saveButton = screen.getByText('Save Connection')
      fireEvent.click(saveButton)

      // Should include SSH data
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1)
        const savedData = onSave.mock.calls[0][0]
        expect(savedData).toHaveProperty('sshEnabled', true)
        expect(savedData).toHaveProperty('sshHost', 'ssh.example.com')
        expect(savedData).toHaveProperty('sshUser', 'testuser')
      })
    })
  })

  describe('URI Generation', () => {
    it('generates correct standalone URI', () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Switch to URI mode
      fireEvent.click(screen.getByText('URI'))

      // Should display generated URI containing localhost
      expect(screen.getByText(/mongodb:\/\/localhost/)).toBeInTheDocument()
    })

    it('generates correct SRV URI', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Switch to SRV connection type
      const connectionTypeSelect = screen.getByTestId('connection-type-select')
      fireEvent.change(connectionTypeSelect, { target: { value: 'srv' } })

      // Switch to URI mode
      fireEvent.click(screen.getByText('URI'))

      // Should display SRV URI
      await waitFor(() => {
        expect(screen.getByText(/mongodb\+srv:\/\//)).toBeInTheDocument()
      })
    })

    it('includes authentication in URI', async () => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<ConnectionFormV2 folders={mockFolders} onSave={onSave} onCancel={onCancel} />)

      // Go to Authentication tab
      fireEvent.click(screen.getByText('Authentication'))

      // Change auth mechanism to SCRAM-SHA-256
      const authMechanismSelect = screen.getByTestId('auth-mechanism')
      fireEvent.change(authMechanismSelect, { target: { value: 'scram-sha-256' } })

      // Fill in username (should now be visible)
      await waitFor(() => {
        const usernameInput = screen.getByTestId('username')
        fireEvent.change(usernameInput, { target: { value: 'testuser' } })
      })

      // Switch to URI mode
      fireEvent.click(screen.getByText('URI'))

      // Enable credentials checkbox (off by default)
      fireEvent.click(screen.getByLabelText('Include credentials'))

      // URI should include username
      await waitFor(() => {
        expect(screen.getByText(/mongodb:\/\/testuser@/)).toBeInTheDocument()
      })
    })
  })
})
