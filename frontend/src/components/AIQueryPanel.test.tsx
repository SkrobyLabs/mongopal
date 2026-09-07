import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { NotificationProvider } from './NotificationContext'
import AIQueryPanel from './AIQueryPanel'
import type { AIQueryResult } from '../types/wails'

let mockGenerate: Mock

beforeEach(() => {
  mockGenerate = vi.fn()
  if (window.go?.main?.App) {
    window.go.main.App.GenerateAIQuery = mockGenerate
  }
  // Clipboard mock
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

const result: AIQueryResult = {
  raw: 'Fetch adults.\n```\ndb.users.find({ age: { $gt: 18 } })\n```',
  query: 'db.users.find({ age: { $gt: 18 } })',
  explanation: 'Fetch adults.',
  model: 'claude-sonnet-5',
  inputTokens: 10,
  outputTokens: 5,
}

const renderPanel = (
  props: Partial<React.ComponentProps<typeof AIQueryPanel>> = {}
): { onUseQuery: Mock; onClose: Mock } => {
  const onUseQuery = vi.fn()
  const onClose = vi.fn()
  render(
    <NotificationProvider>
      <AIQueryPanel
        connectionId="conn1"
        database="db"
        collection="users"
        queryMode="mongo"
        model="sonnet"
        onUseQuery={onUseQuery}
        onClose={onClose}
        {...props}
      />
    </NotificationProvider>
  )
  return { onUseQuery, onClose }
}

describe('AIQueryPanel', () => {
  it('generates and renders explanation + query', async () => {
    mockGenerate.mockResolvedValue(result)
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'adults over 18' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    await waitFor(() => {
      expect(screen.getByText('Fetch adults.')).toBeInTheDocument()
    })
    expect(screen.getByText('db.users.find({ age: { $gt: 18 } })')).toBeInTheDocument()
    expect(mockGenerate).toHaveBeenCalledWith(
      'conn1',
      'db',
      'users',
      'mongo',
      'adults over 18',
      'sonnet'
    )
  })

  it('inserts the query via onUseQuery without executing', async () => {
    mockGenerate.mockResolvedValue(result)
    const { onUseQuery, onClose } = renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))
    await waitFor(() => screen.getByText('db.users.find({ age: { $gt: 18 } })'))

    fireEvent.click(screen.getByRole('button', { name: /Update query/i }))
    expect(onUseQuery).toHaveBeenCalledWith('db.users.find({ age: { $gt: 18 } })')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('cancel discards a generated query without updating the editor', async () => {
    mockGenerate.mockResolvedValue(result)
    const { onUseQuery, onClose } = renderPanel()
    expect(screen.getByRole('button', { name: 'Update query' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'adults' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate query' }))
    await screen.findByText('Fetch adults.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onUseQuery).not.toHaveBeenCalled()
  })

  it('keeps generation shortcuts from reaching the query editor', async () => {
    mockGenerate.mockResolvedValue(result)
    const shortcut = vi.fn()
    window.addEventListener('keydown', shortcut)
    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'adults' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    await screen.findByText('Fetch adults.')
    expect(shortcut).not.toHaveBeenCalled()
    window.removeEventListener('keydown', shortcut)
  })

  it('can cancel during generation and ignores completion after unmount', async () => {
    let resolve!: (value: AIQueryResult) => void
    mockGenerate.mockReturnValue(
      new Promise<AIQueryResult>((r) => {
        resolve = r
      })
    )
    const onUseQuery = vi.fn()
    function Assistant() {
      const [open, setOpen] = React.useState(true)
      return open ? (
        <AIQueryPanel
          connectionId="conn1"
          database="db"
          collection="users"
          queryMode="mongo"
          model="sonnet"
          onUseQuery={onUseQuery}
          onClose={() => setOpen(false)}
        />
      ) : null
    }
    render(
      <NotificationProvider>
        <Assistant />
      </NotificationProvider>
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'adults' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate query' }))
    expect(screen.getByRole('button', { name: 'Update query' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      resolve(result)
    })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(onUseQuery).not.toHaveBeenCalled()
  })

  it('focuses the prompt without trapping keyboard navigation', () => {
    renderPanel()
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    expect(fireEvent.keyDown(cancel, { key: 'Tab' })).toBe(true)
    const close = screen.getByRole('button', { name: 'Close AI assistant' })
    close.focus()
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(true)
  })

  it('copies the query to the clipboard', async () => {
    mockGenerate.mockResolvedValue(result)
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))
    await waitFor(() => screen.getByText('db.users.find({ age: { $gt: 18 } })'))

    fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'db.users.find({ age: { $gt: 18 } })'
      )
    })
  })

  it('shows an API-key hint on auth errors', async () => {
    mockGenerate.mockRejectedValue(new Error('anthropic request failed: 401 invalid api key'))
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    await waitFor(() => {
      expect(screen.getByText(/Set your Anthropic API key/i)).toBeInTheDocument()
    })
  })

  it('shows a timeout hint on deadline errors', async () => {
    mockGenerate.mockRejectedValue(new Error('query generation failed: context deadline exceeded'))
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    await waitFor(() => {
      expect(screen.getByText(/timed out \(60s\)/i)).toBeInTheDocument()
    })
  })

  it('shows an unavailable message when the binding returns nothing', async () => {
    mockGenerate.mockResolvedValue(undefined)
    renderPanel()

    fireEvent.change(screen.getByPlaceholderText(/Describe the query/i), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    await waitFor(() => {
      expect(screen.getByText(/generation is unavailable/i)).toBeInTheDocument()
    })
  })

  it('generates via Cmd/Ctrl+Enter', async () => {
    mockGenerate.mockResolvedValue(result)
    renderPanel()

    const textarea = screen.getByPlaceholderText(/Describe the query/i)
    fireEvent.change(textarea, { target: { value: 'via keyboard' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith(
        'conn1',
        'db',
        'users',
        'mongo',
        'via keyboard',
        'sonnet'
      )
    })
  })

  it('closes on Escape', () => {
    const { onClose } = renderPanel()
    fireEvent.keyDown(screen.getByRole('region', { name: /AI query assistant/i }), {
      key: 'Escape',
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores stale responses that resolve after a newer request', async () => {
    let resolveFirst!: (v: AIQueryResult) => void
    const first = new Promise<AIQueryResult>((r) => {
      resolveFirst = r
    })
    const second: AIQueryResult = {
      ...result,
      query: 'db.users.find({ newest: true })',
      explanation: 'Newest.',
    }
    mockGenerate.mockReturnValueOnce(first).mockResolvedValueOnce(second)

    renderPanel()
    const textarea = screen.getByPlaceholderText(/Describe the query/i)

    fireEvent.change(textarea, { target: { value: 'first' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    // Fire a second request while the first is pending.
    fireEvent.change(textarea, { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate query/i }))

    await waitFor(() => screen.getByText('Newest.'))

    // Resolving the stale first request must not overwrite the newer result.
    await act(async () => {
      resolveFirst(result)
      await Promise.resolve()
    })
    expect(screen.getByText('Newest.')).toBeInTheDocument()
    expect(screen.queryByText('Fetch adults.')).not.toBeInTheDocument()
  })
})
