import { act, renderHook, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationProvider } from '../NotificationContext'
import { ConnectionProvider, useConnection } from './ConnectionContext'
import { DebugProvider } from './DebugContext'

const connections = [
  { id: 'a', name: 'A', uri: 'mongodb://a', color: '', createdAt: '' },
  { id: 'b', name: 'B', uri: 'mongodb://b', color: '', createdAt: '' },
  { id: 'c', name: 'C', uri: 'mongodb://c', color: '', createdAt: '' },
]

const wrapper = ({ children }: { children: ReactNode }) => (
  <NotificationProvider><DebugProvider><ConnectionProvider>{children}</ConnectionProvider></DebugProvider></NotificationProvider>
)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const app = (): any => (window.go as any).main.App

describe('ConnectionContext lifecycle reconciliation', () => {
  beforeEach(() => {
    window.go = { main: { App: { ListSavedConnections: vi.fn().mockResolvedValue(connections), ListFolders: vi.fn().mockResolvedValue([]) } } } as any
  })

  it('removes logical state and tabs after a disconnect cleanup error', async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error('cleanup timed out'))
    app().Disconnect = disconnect
    const closeTabs = vi.fn()
    const { result } = renderHook(() => useConnection(), { wrapper })
    await waitFor(() => expect(result.current.connections).toHaveLength(3))
    await act(async () => { await result.current.connect('a') })
    act(() => {
      result.current.setSelectedConnection('a')
      result.current.setSelectedDatabase('db')
      result.current.setSelectedCollection('coll')
    })

    await act(async () => { await result.current.disconnect('a', closeTabs) })
    expect(result.current.activeConnections).not.toContain('a')
    expect(result.current.selectedConnection).toBeNull()
    expect(result.current.selectedDatabase).toBeNull()
    expect(result.current.selectedCollection).toBeNull()
    expect(closeTabs).toHaveBeenCalledWith('a')
  })

  it('dispatches disconnect-others concurrently and reconciles after partial failure', async () => {
    const b = deferred<void>()
    const c = deferred<void>()
    const disconnect = vi.fn((id: string) => id === 'b' ? b.promise : c.promise)
    app().Connect = vi.fn().mockResolvedValue(undefined)
    app().Disconnect = disconnect
    const closeOthers = vi.fn()
    const { result } = renderHook(() => useConnection(), { wrapper })
    await waitFor(() => expect(result.current.connections).toHaveLength(3))
    await act(async () => {
      await result.current.connect('a')
      await result.current.connect('b')
      await result.current.connect('c')
    })
    const operation = result.current.disconnectOthers('a', closeOthers)
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(2))
    await act(async () => {
      b.resolve()
      c.reject(new Error('c cleanup failed'))
      await operation
    })
    expect(result.current.activeConnections).toEqual(['a'])
    expect(closeOthers).toHaveBeenCalledWith('a')
  })
})
