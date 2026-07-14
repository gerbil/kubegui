import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  ColumnFiltersState,
  RowData,
  ColumnOrderState,
  RowSelectionState,
  type FilterFn,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState, useMemo, useEffect, type ReactNode } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UiTooltip } from '@/components/ui/UiTooltip'

type ColumnMetaClass = {
  thClassName?: string
  tdClassName?: string
  shrink?: boolean
  fixedWidth?: number
  disableOverflowTooltip?: boolean
  allowWrap?: boolean
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseRegexLiteral(input: string): { source: string; flags: string } | null {
  if (!input.startsWith('/')) return null
  const lastSlash = input.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const source = input.slice(1, lastSlash)
  const flags = input.slice(lastSlash + 1)
  if (!source) return null
  return { source, flags }
}

function toFilterText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((v) => toFilterText(v)).join(' ')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

function matchesSmartFilter(value: unknown, rawQuery: unknown): boolean {
  const query = String(rawQuery ?? '').trim()
  if (!query) return true

  const haystack = toFilterText(value)

  // Support explicit regex literals like /abc-.+-123/i
  const literal = parseRegexLiteral(query)
  if (literal) {
    try {
      return new RegExp(literal.source, literal.flags).test(haystack)
    } catch {
      // Fall through to plain contains when regex is invalid.
    }
  }

  // Support wildcard patterns like abc-*-123
  if (query.includes('*')) {
    const pattern = `^${escapeRegExp(query).replace(/\\\*/g, '.*')}$`
    try {
      return new RegExp(pattern, 'i').test(haystack)
    } catch {
      // Fall through to plain contains.
    }
  }

  return haystack.toLowerCase().includes(query.toLowerCase())
}

function OverflowTooltipCell({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [label, setLabel] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const updateLabel = () => {
      // Prevent native browser tooltips from overriding UiTooltip inside shared datatable cells.
      host.querySelectorAll<HTMLElement>('[title]').forEach((node) => node.removeAttribute('title'))

      const text = host.innerText.replace(/\s+/g, ' ').trim()
      const childOverflow = Array.from(host.querySelectorAll<HTMLElement>('*')).some(
        (node) => node.scrollWidth - node.clientWidth > 1,
      )
      const isOverflowing = host.scrollWidth - host.clientWidth > 1 || childOverflow
      setLabel(isOverflowing && text ? text : '')
    }

    updateLabel()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateLabel)
    observer.observe(host)
    return () => observer.disconnect()
  }, [children])

  return (
    <UiTooltip
      disabled={!label}
      compact
      content={label}
    >
      <div ref={hostRef} className="block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {children}
      </div>
    </UiTooltip>
  )
}

interface DataTableProps<T extends RowData> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  globalFilter?: string
  onGlobalFilterChange?: (v: string) => void
  estimateSize?: number
  emptyLabel?: string
  loading?: boolean
  columnOrder?: ColumnOrderState
  onColumnOrderChange?: (updater: ColumnOrderState | ((old: ColumnOrderState) => ColumnOrderState)) => void
  persistKey?: string
  defaultSorting?: SortingState
  onSelectedRowsChange?: (rows: T[]) => void
  rowSelectionResetKey?: number
  onRowClick?: (row: T) => void
}

export function DataTable<T extends RowData>({
  data,
  columns,
  globalFilter = '',
  estimateSize = 40,
  emptyLabel = 'No data found',
  loading = false,
  columnOrder,
  onColumnOrderChange,
  persistKey,
  defaultSorting = [{ id: 'name', desc: false }],
  onSelectedRowsChange,
  rowSelectionResetKey,
  onRowClick,
}: DataTableProps<T>) {
  const FIRST_COLUMN_STRICT_WIDTH = 64
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)
  const [columnFilters] = useState<ColumnFiltersState>([])
  const [internalColumnOrder, setInternalColumnOrder] = useState<ColumnOrderState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  useEffect(() => {
    if (rowSelectionResetKey == null) return
    setRowSelection({})
  }, [rowSelectionResetKey])

  const selectedRows = useMemo(
    () => Object.keys(rowSelection)
      .filter((id) => rowSelection[id])
      .map((id) => data[Number(id)])
      .filter((row): row is T => row !== undefined),
    [rowSelection, data],
  )

  useEffect(() => {
    onSelectedRowsChange?.(selectedRows)
  }, [onSelectedRowsChange, selectedRows])

  useEffect(() => {
    if (!persistKey || typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(`datatable:colorder:${persistKey}`)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        setInternalColumnOrder(parsed as ColumnOrderState)
      }
    } catch {
      // Ignore malformed localStorage entries.
    }
  }, [persistKey])

  const effectiveColumnOrder = columnOrder ?? internalColumnOrder

  const handleColumnOrderChange = (
    updater: ColumnOrderState | ((old: ColumnOrderState) => ColumnOrderState),
  ) => {
    if (onColumnOrderChange) {
      onColumnOrderChange(updater)
      return
    }
    setInternalColumnOrder((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (persistKey && typeof window !== 'undefined') {
        window.localStorage.setItem(`datatable:colorder:${persistKey}`, JSON.stringify(next))
      }
      return next
    })
  }

  const smartGlobalFilter: FilterFn<T> = (row, columnId, filterValue) => {
    return matchesSmartFilter(row.getValue(columnId), filterValue)
  }

  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, columnOrder: effectiveColumnOrder, rowSelection },
    onSortingChange: setSorting,
    onColumnOrderChange: handleColumnOrderChange,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableGlobalFilter: true,
    globalFilterFn: smartGlobalFilter,
    enableRowSelection: true,
  })

  const { rows } = table.getRowModel()

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 20,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  const paddingTop = useMemo(
    () => (virtualItems.length > 0 ? virtualItems[0].start : 0),
    [virtualItems]
  )
  const paddingBottom = useMemo(
    () =>
      virtualItems.length > 0
        ? totalSize - virtualItems[virtualItems.length - 1].end
        : 0,
    [virtualItems, totalSize]
  )

  return (
    <div ref={parentRef} className="overflow-auto h-full w-full">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface-container-high/60 backdrop-blur-md">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header, headerIndex) => {
                const canSort = header.column.getCanSort()
                const sorted = header.column.getIsSorted()
                const meta = (header.column.columnDef.meta ?? {}) as ColumnMetaClass
                const isFirstColumn = headerIndex === 0
                const fixedWidthStyle = meta.fixedWidth
                  ? {
                      width: meta.fixedWidth,
                      minWidth: meta.fixedWidth,
                      maxWidth: meta.fixedWidth,
                      whiteSpace: 'nowrap' as const,
                      overflow: 'hidden' as const,
                      textOverflow: 'ellipsis' as const,
                    }
                  : null
                return (
                  <th
                    key={header.id}
                    style={isFirstColumn
                      ? {
                          width: FIRST_COLUMN_STRICT_WIDTH,
                          minWidth: FIRST_COLUMN_STRICT_WIDTH,
                          maxWidth: FIRST_COLUMN_STRICT_WIDTH,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }
                      : fixedWidthStyle ?? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    className={cn(
                      'px-3 py-2.5 text-left text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-outline-variant/40 select-none',
                      canSort && 'cursor-pointer hover:text-foreground transition-colors',
                      meta.thClassName,
                    )}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                  >
                    {header.id === 'select' || header.id === 'phase' ? (
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded cursor-pointer align-bottom appearance-none bg-[#354065] checked:bg-[#6a7fc9] checked:border-[#6a7fc9]"
                        checked={table.getIsAllRowsSelected()}
                        onChange={table.getToggleAllRowsSelectedHandler()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1 min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="opacity-50">
                            {sorted === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : sorted === 'desc' ? (
                              <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} />
                            )}
                          </span>
                        )}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr><td style={{ height: paddingTop }} /></tr>
          )}
          {virtualItems.map((vRow) => {
            const row = rows[vRow.index]
            const isClickable = typeof onRowClick === 'function'
            return (
              <tr
                key={row.id}
                className={cn(
                  'border-b border-outline-variant/30 transition-colors',
                  isClickable
                    ? 'cursor-pointer hover:bg-surface-container-high/45 focus-within:bg-surface-container-high/45'
                    : 'hover:bg-surface-container-high/45',
                )}
                onClick={isClickable ? () => onRowClick(row.original) : undefined}
                onKeyDown={isClickable ? (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onRowClick(row.original)
                } : undefined}
                tabIndex={isClickable ? 0 : undefined}
              >
                {row.getVisibleCells().map((cell, cellIndex) => {
                  const meta = (cell.column.columnDef.meta ?? {}) as ColumnMetaClass
                  const isFirstColumn = cellIndex === 0
                  const shouldUseOverflowTooltip = !meta.disableOverflowTooltip && !meta.allowWrap
                  const fixedWidthStyle = meta.fixedWidth
                    ? {
                        width: meta.fixedWidth,
                        minWidth: meta.fixedWidth,
                        maxWidth: meta.fixedWidth,
                        whiteSpace: 'nowrap' as const,
                        overflow: 'hidden' as const,
                        textOverflow: 'ellipsis' as const,
                      }
                    : null
                  return (
                    <td
                      key={cell.id}
                      style={isFirstColumn
                        ? {
                            width: FIRST_COLUMN_STRICT_WIDTH,
                            minWidth: FIRST_COLUMN_STRICT_WIDTH,
                            maxWidth: FIRST_COLUMN_STRICT_WIDTH,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }
                        : fixedWidthStyle ?? (meta.allowWrap
                          ? { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal' }
                          : meta.disableOverflowTooltip
                            ? { overflow: 'visible', textOverflow: 'clip', whiteSpace: 'nowrap' }
                            : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 })}
                      className={cn('px-3 py-2 text-on-surface', isClickable && 'cursor-pointer', meta.tdClassName)}
                    >
                      {shouldUseOverflowTooltip
                        ? <OverflowTooltipCell>{flexRender(cell.column.columnDef.cell, cell.getContext())}</OverflowTooltipCell>
                        : flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr><td style={{ height: paddingBottom }} /></tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {loading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground/50 uppercase tracking-widest">Loading…</span>
            </div>
          ) : (
            emptyLabel
          )}
        </div>
      )}
    </div>
  )
}
