import { cn } from '@/lib/utils'
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline' | 'destructive'
  size?: 'sm' | 'md' | 'icon'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-primary text-primary-foreground hover:bg-primary/90': variant === 'default',
            'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
            'border border-border bg-transparent hover:bg-accent': variant === 'outline',
            'bg-destructive text-destructive-foreground hover:bg-destructive/90': variant === 'destructive',
          },
          {
            'h-7 px-3 text-xs': size === 'sm',
            'h-9 px-4 text-sm': size === 'md',
            'h-8 w-8 p-0': size === 'icon',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

// ─── ConfirmDialog ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  const dialog = (
    <>
      <div className="fixed inset-0 bg-black/60 z-[1200]" onClick={onCancel} />
      <div
        className="fixed z-[1201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            {danger && (
              <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
            )}
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {description && <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{description}</p>}
            </div>
          </div>
          <button onClick={onCancel} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>
        {danger && (
          <div className="mx-5 mb-4 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
            <p className="text-[11px] text-red-400/90 leading-relaxed">
              ⚠ This action is <span className="font-semibold">irreversible</span>. Resource permanently removed from cluster.
            </p>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${danger ? 'bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25' : 'bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
  return dialog
}