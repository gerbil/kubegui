/**
 * Returns a function that coalesces rapid repeated calls into a single
 * invocation after `ms` milliseconds of silence.  Repeated calls within the
 * debounce window restart the timer (classic debounce).
 *
 * Usage inside a useEffect:
 *   const trigger = coalesce(() => void fetchData(), 500)
 *   const off = Events.On('someInformerChanged', trigger)
 *   return () => { trigger.cancel(); off?.() }
 */
export function coalesce(fn: () => void, ms = 500): { (): void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = () => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return debounced
}