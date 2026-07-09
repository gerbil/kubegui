import React from 'react'
import { Tooltip } from '@mantine/core'
import type { FloatingPosition } from '@mantine/core'

export function UiTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  offset = 8,
  disabled = false,
  compact = false,
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'center' | 'start'
  offset?: number
  disabled?: boolean
  /** When true the tooltip box shrinks to fit its text content instead of stretching to a default min-width. */
  compact?: boolean
}) {
  const position: FloatingPosition = align === 'start' ? `${side}-start` : side

  return (
    <Tooltip
      label={content}
      disabled={disabled}
      position={position}
      withArrow
      offset={offset}
      openDelay={80}
      closeDelay={40}
      multiline
      withinPortal
      zIndex={2000}
      styles={{
        tooltip: {
          maxWidth: 'min(420px, calc(100vw - 32px))',
          ...(compact ? { width: 'fit-content', minWidth: 0 } : {}),
          background: '#0f172a',
          border: 'none',
          color: 'var(--mantine-color-text)',
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1.4,
          whiteSpace: compact ? 'nowrap' : 'normal',
          overflowWrap: 'anywhere',
          padding: '6px 8px',
        },
        arrow: {
          background: '#0f172a',
          border: 'none',
        },
      }}
    >
      {children}
    </Tooltip>
  )
}
