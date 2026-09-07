type NSOption = { value: string; label: string }

export function NamespaceSelect({
  id,
  value,
  onChange,
  options,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: NSOption[]
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        className="text-[10px] uppercase tracking-wider text-muted-foreground font-label shrink-0"
        htmlFor={id}
      >
        Namespace
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-8 rounded-md border border-border bg-muted px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 font-label min-w-[220px] appearance-none cursor-pointer"
        spellCheck={false}
        autoComplete="off"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

