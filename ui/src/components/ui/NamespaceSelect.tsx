import { useEffect, useMemo } from 'react'
import { CloseButton, Select as MantineSelect } from '@mantine/core'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useKubernetesContext } from '@/hooks/useKubernetesContext'

const RECENT_KEY = 'kubegui.recentNamespaces'
const RECENT_LIMIT = 3
const EMPTY_RECENTS: Record<string, string[]> = {}

type NSOption = { value: string; label: string }

export function NamespaceSelect({
  id,
  value,
  onChange,
  options,
  allValue = 'all',
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: NSOption[]
  allValue?: string | null
}) {
  const { context, isLoading } = useKubernetesContext()
  const [recents, setRecents] = usePersistentState<Record<string, string[]>>(RECENT_KEY, EMPTY_RECENTS)

  const known = useMemo(() => new Set(options.map((o) => o.value)), [options])

  useEffect(() => {
    if (isLoading || !value || value === allValue || value === 'all' || !known.has(value)) return
    setRecents((prev) => {
      const list = prev[context] ?? []
      if (list[0] === value) return prev
      return { ...prev, [context]: [value, ...list.filter((n) => n !== value)].slice(0, RECENT_LIMIT) }
    })
  }, [value, context, isLoading, known, allValue, setRecents])

  const data = useMemo(() => {
    const recentValues = (recents[context] ?? []).filter((n) => known.has(n))
    if (recentValues.length === 0) return options
    const recentSet = new Set(recentValues)
    const byValue = new Map(options.map((o) => [o.value, o]))
    const head = options.filter((o) => o.value === allValue || o.value === 'all')
    const rest = options.filter((o) => !recentSet.has(o.value) && !head.includes(o))
    return [
      ...head,
      { group: 'Recent', items: recentValues.map((n) => byValue.get(n) as NSOption) },
      { group: 'Other namespaces', items: rest },
    ]
  }, [options, recents, context, known, allValue])

  return (
    <div className="flex items-center gap-2">
      <label
        className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0"
        htmlFor={id}
      >
        Namespace
      </label>
      <MantineSelect
        id={id}
        value={value}
        onChange={(v) => onChange(v ?? allValue ?? value)}
        data={data}
        size="sm"
        w={320}
        searchable
        allowDeselect={false}
        spellCheck={false}
        classNames={{ input: 'pods-glass-control' }}
        styles={{ input: { fontFamily: 'Space Grotesk, sans-serif', fontSize: '0.75rem' } }}
        rightSectionPointerEvents="all"
        rightSection={
          allValue && value !== allValue ? (
            <CloseButton
              size="sm"
              aria-label="Show all namespaces"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(allValue)}
            />
          ) : undefined
        }
      />
    </div>
  )
}
