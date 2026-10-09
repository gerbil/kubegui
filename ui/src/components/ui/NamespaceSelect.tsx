import { CloseButton, Select as MantineSelect } from '@mantine/core'

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
        data={options}
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
