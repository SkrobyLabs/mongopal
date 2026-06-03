import React, { useState, useRef, useEffect, KeyboardEvent, DragEvent, MouseEvent } from 'react'
import { useTab, Tab } from './contexts/TabContext'

// =============================================================================
// Icon Component Types
// =============================================================================

interface IconProps {
  className?: string
}

interface PinIconProps extends IconProps {
  filled?: boolean
}

// =============================================================================
// Icon Components
// =============================================================================

const CloseIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const PlusIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
)

const PinIcon: React.FC<PinIconProps> = ({ className = "w-4 h-4", filled = false }) => (
  <svg className={className} fill={filled ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
)

const DocumentIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const PlayIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const SchemaIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
  </svg>
)

const EyeIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
)

const EditIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
)

const IndexIcon: React.FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6v12M15 6v12" />
  </svg>
)

// =============================================================================
// Context Menu Types
// =============================================================================

interface ContextMenuState {
  x: number
  y: number
  tabId: string
  pinned: boolean
}

// =============================================================================
// TabBar Component
// =============================================================================

export default function TabBar(): React.JSX.Element {
  const {
    tabs,
    activeTab,
    setActiveTab,
    closeTab,
    openNewQueryTab,
    pinTab,
    renameTab,
    reorderTabs,
    convertViewOnlyToEditable,
  } = useTab()

  const [draggedTab, setDraggedTab] = useState<Tab | null>(null)
  const [dragOverTab, setDragOverTab] = useState<string | null>(null)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Scroll active tab into view
  useEffect(() => {
    if (activeTab && tabRefs.current[activeTab]) {
      const tab = tabRefs.current[activeTab]
      const container = tab?.parentElement
      if (tab && container) {
        const tabLeft = tab.offsetLeft
        const tabRight = tabLeft + tab.offsetWidth
        const containerLeft = container.scrollLeft
        const containerRight = containerLeft + container.clientWidth

        if (tabLeft < containerLeft) {
          container.scrollTo({ left: tabLeft - 8, behavior: 'smooth' })
        } else if (tabRight > containerRight) {
          container.scrollTo({ left: tabRight - container.clientWidth + 8, behavior: 'smooth' })
        }
      }
    }
  }, [activeTab])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [contextMenu])

  // Focus input when editing
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingTabId])

  if (tabs.length === 0) {
    return (
      <div className="h-9 bg-surface-secondary border-b border-border flex items-center px-2 titlebar-drag">
        <span className="text-xs text-text-muted">No open tabs</span>
      </div>
    )
  }

  // Sort tabs: pinned first, then by order
  const sortedTabs = [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  const handleDragStart = (e: DragEvent<HTMLDivElement>, tab: Tab): void => {
    setDraggedTab(tab)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tab.id)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, tab: Tab): void => {
    e.preventDefault()
    if (draggedTab && draggedTab.id !== tab.id) {
      if (draggedTab.pinned === tab.pinned) {
        setDragOverTab(tab.id)
      }
    }
  }

  const handleDragLeave = (): void => {
    setDragOverTab(null)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetTab: Tab): void => {
    e.preventDefault()
    if (draggedTab && draggedTab.id !== targetTab.id && reorderTabs) {
      if (draggedTab.pinned === targetTab.pinned) {
        reorderTabs(draggedTab.id, targetTab.id)
      }
    }
    setDraggedTab(null)
    setDragOverTab(null)
  }

  const handleDragEnd = (): void => {
    setDraggedTab(null)
    setDragOverTab(null)
  }

  const handleContextMenu = (e: MouseEvent<HTMLDivElement>, tab: Tab): void => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId: tab.id,
      pinned: tab.pinned
    })
  }

  const handleDoubleClick = (tab: Tab): void => {
    setEditingTabId(tab.id)
    setEditValue(tab.label)
  }

  const handleEditSubmit = (tabId: string): void => {
    if (editValue.trim() && renameTab) {
      renameTab(tabId, editValue.trim())
    }
    setEditingTabId(null)
    setEditValue('')
  }

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, tabId: string): void => {
    if (e.key === 'Enter') {
      handleEditSubmit(tabId)
    } else if (e.key === 'Escape') {
      setEditingTabId(null)
      setEditValue('')
    }
  }

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, tabId: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setActiveTab(tabId)
    }
  }

  return (
    <div className="h-9 bg-surface-secondary border-b border-border flex items-center overflow-x-auto overflow-y-hidden titlebar-drag">
      {sortedTabs.map(tab => (
        <div
          key={tab.id}
          ref={el => { tabRefs.current[tab.id] = el }}
          className={`tab titlebar-no-drag ${activeTab === tab.id ? 'active' : ''} group ${
            dragOverTab === tab.id ? 'ring-2 ring-primary ring-inset' : ''
          } ${draggedTab?.id === tab.id ? 'opacity-50' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab)}
          onDoubleClick={() => handleDoubleClick(tab)}
          draggable={editingTabId !== tab.id}
          onDragStart={(e) => handleDragStart(e, tab)}
          onDragOver={(e) => handleDragOver(e, tab)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, tab)}
          onDragEnd={handleDragEnd}
          tabIndex={0}
          role="tab"
          aria-selected={activeTab === tab.id}
          onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
        >
          {/* Connection color indicator */}
          {tab.color && (
            <span
              className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
              style={{ backgroundColor: tab.color }}
            />
          )}

          {/* Pin indicator */}
          {tab.pinned && (
            <PinIcon className="w-3 h-3 text-primary flex-shrink-0" filled />
          )}

          {/* Tab type icon */}
          {tab.type === 'document' && tab.viewOnly ? (
            <EyeIcon className="w-3.5 h-3.5 text-info flex-shrink-0" />
          ) : tab.type === 'document' ? (
            <DocumentIcon className="w-3.5 h-3.5 text-warning flex-shrink-0" />
          ) : tab.type === 'insert' ? (
            <PlusIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          ) : tab.type === 'schema' ? (
            <SchemaIcon className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
          ) : tab.type === 'indexes' ? (
            <IndexIcon className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
          ) : (
            <PlayIcon className="w-3 h-3 text-primary flex-shrink-0" />
          )}

          {/* Tab label - editable or static */}
          {editingTabId === tab.id ? (
            <input
              ref={editInputRef}
              type="text"
              className="bg-surface-hover text-text-light text-xs px-2 py-0.5 rounded w-48 outline-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => handleEditKeyDown(e, tab.id)}
              onBlur={() => handleEditSubmit(tab.id)}
              onClick={(e) => e.stopPropagation()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          ) : (
            <span className="truncate max-w-[150px]">{tab.label}</span>
          )}

          {/* Dirty indicator dot - show when document has unsaved changes */}
          {tab.dirty && !tab.pinned && editingTabId !== tab.id && (
            <span
              className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
              title="Unsaved changes"
            />
          )}

          {tab.type === 'document' && tab.viewOnly && editingTabId !== tab.id && (
            <button
              className="icon-btn p-0.5 hover:bg-surface-active rounded text-info flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                convertViewOnlyToEditable(tab.id)
              }}
              title="Make editable"
              aria-label={`Make ${tab.label} editable`}
            >
              <EditIcon className="w-3 h-3" />
            </button>
          )}

          {/* Close button - always visible on active tab, hover on others, hidden for pinned */}
          {!tab.pinned && editingTabId !== tab.id && (
            <button
              className={`icon-btn p-0.5 hover:bg-surface-active rounded transition-opacity ${
                activeTab === tab.id
                  ? 'opacity-60 hover:opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              title="Close tab"
              aria-label={`Close ${tab.label}`}
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}

      {/* Add tab button */}
      <button
        className="icon-btn p-1.5 mx-1 hover:bg-surface-hover text-text-muted hover:text-text-light titlebar-no-drag"
        onClick={openNewQueryTab}
        title="New Query Tab"
      >
        <PlusIcon className="w-4 h-4" />
      </button>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-surface border border-border rounded-lg shadow-xl py-1 z-50 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item w-full px-3 py-1.5 text-left text-sm text-text-light hover:bg-surface-hover"
            onClick={() => {
              const tab = tabs.find(t => t.id === contextMenu.tabId)
              if (tab) handleDoubleClick(tab)
              setContextMenu(null)
            }}
          >
            Rename
          </button>
          <button
            className="context-menu-item w-full px-3 py-1.5 text-left text-sm text-text-light hover:bg-surface-hover"
            onClick={() => {
              if (pinTab) pinTab(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            {contextMenu.pinned ? 'Unpin' : 'Pin'}
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="context-menu-item w-full px-3 py-1.5 text-left text-sm text-text-light hover:bg-surface-hover"
            onClick={() => {
              // Close all unpinned tabs except the right-clicked one
              tabs.filter(t => !t.pinned && t.id !== contextMenu.tabId).forEach(t => closeTab(t.id))
              setContextMenu(null)
            }}
          >
            Close Others
          </button>
          <button
            className="context-menu-item w-full px-3 py-1.5 text-left text-sm text-text-light hover:bg-surface-hover"
            onClick={() => {
              // Close all unpinned tabs
              tabs.filter(t => !t.pinned).forEach(t => closeTab(t.id))
              setContextMenu(null)
            }}
          >
            Close All
          </button>
          <div className="border-t border-border my-1" />
          <button
            className="context-menu-item w-full px-3 py-1.5 text-left text-sm text-error hover:bg-surface-hover"
            onClick={() => {
              closeTab(contextMenu.tabId)
              setContextMenu(null)
            }}
          >
            Close Tab
          </button>
        </div>
      )}
    </div>
  )
}
