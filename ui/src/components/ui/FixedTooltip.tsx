import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Tooltip that escapes every overflow/scroll ancestor by rendering
 * via ReactDOM.createPortal at position:fixed on document.body.
 */
export function FixedTooltip({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom'
}) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = () => {
    console.log('[FixedTooltip] show fired, ref=', wrapRef.current)
    if (!wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    console.log('[FixedTooltip] rect=', r, 'content=', content)
    setPos({
      x: r.left + r.width / 2,
      y: side === 'top' ? r.top - 6 : r.bottom + 6,
    })
  }

  console.log('[FixedTooltip] render, pos=', pos, 'content=', content)

  return (
    <>
      <span
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={() => { console.log('[FixedTooltip] hide'); setPos(null) }}
        style={{ display: 'inline' }}
      >
        {children}
      </span>
      {pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="max-w-[min(360px,calc(100vw-32px))] rounded-md bg-[#0f172a] px-2.5 py-1.5 text-[10px] font-medium text-foreground shadow-xl whitespace-normal break-words border border-white/10"
        >
          {content}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              ...(side === 'top'
                ? { bottom: -4, borderTop: '4px solid #0f172a', borderLeft: '4px solid transparent', borderRight: '4px solid transparent' }
                : { top: -4, borderBottom: '4px solid #0f172a', borderLeft: '4px solid transparent', borderRight: '4px solid transparent' }),
            }}
          />
        </div>,
        document.body,
      )}
    </>
  )
}
