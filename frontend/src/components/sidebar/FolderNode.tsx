import React from 'react'
import type { FolderNodeProps } from './types'
import { TreeNode } from './TreeNode'
import { FolderIcon } from './icons'

export function FolderNode({
  folder,
  level = 0,
  childFolders,
  folderConnections,
  expanded,
  onToggle,
  onContextMenu,
  focusedNodeId,
  onNodeFocus,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver,
  renderFolderNode,
  renderConnectionNode,
}: FolderNodeProps): React.ReactElement {
  const folderNodeId = `folder:${folder.id}`

  const handleRowDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData('application/x-mongopal-folder', folder.id)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => onDragStart?.(folder.id), 0)
  }

  const handleRowDragEnd = (): void => {
    onDragEnd?.()
  }

  return (
    <TreeNode
      label={folder.name}
      icon={<FolderIcon />}
      level={level}
      expanded={expanded}
      onToggle={onToggle}
      onDoubleClick={onToggle}
      onContextMenu={onContextMenu}
      nodeId={folderNodeId}
      isFocused={focusedNodeId === folderNodeId}
      onFocus={() => onNodeFocus?.(folderNodeId)}
      draggable={true}
      onDragStart={handleRowDragStart}
      onDragEnd={handleRowDragEnd}
      isDropTarget={true}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      isDragOver={isDragOver}
    >
      {expanded && (childFolders.length > 0 || folderConnections.length > 0) && (
        <>
          {childFolders.map((childFolder, childIndex) =>
            renderFolderNode(childFolder, childIndex, childFolders.length + folderConnections.length, level + 1)
          )}
          {folderConnections.map((conn, connIndex) =>
            renderConnectionNode(conn, childFolders.length + connIndex, childFolders.length + folderConnections.length, level + 1)
          )}
        </>
      )}
    </TreeNode>
  )
}
