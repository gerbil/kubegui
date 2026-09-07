import { useId, useState } from 'react'
import React from "react"

export function BubbleTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom'
  align?: 'center' | 'start'
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute z-[100] w-fit max-w-[min(420px,calc(100vw-32px))] whitespace-normal break-words rounded-md border border-border bg-[#0f172a] px-2.5 py-2 text-[10px] font-medium text-foreground shadow-xl ${
            align === 'start' ? 'left-0 translate-x-0' : 'left-1/2 -translate-x-1/2'
          } ${
            side === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
          }`}
        >
          {content}
          <span
            className={`absolute h-2 w-2 rotate-45 border-border bg-[#0f172a] ${
              align === 'start' ? 'left-3' : 'left-1/2 -translate-x-1/2'
            } ${
              side === 'top'
                ? 'bottom-[-5px] border-b border-r'
                : 'top-[-5px] border-l border-t'
            }`}
          />
        </span>
      )}
    </span>
  )
}