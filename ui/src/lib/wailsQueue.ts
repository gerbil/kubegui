/**
 * wailsQueue.ts
 *
 * Wails v3 alpha serializes binding calls internally. Firing multiple calls
 * concurrently causes them to queue in Go; calls waiting more than 90 s are
 * killed by the Wails timeout.
 *
 * This module exposes a single-slot queue: at most one Wails call is in-flight
 * at any time. Any call made while the slot is busy waits in line — it does
 * NOT create a second concurrent round-trip to Go.
 *
 * Usage:
 *   import { wailsCall } from '../lib/wailsQueue'
 *   const result = await wailsCall(() => SomeBackendMethod(arg1, arg2))
 */

interface QueueEntry {
  fn: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const _queue: QueueEntry[] = []
let _running = false

function _drain() {
  if (_running || _queue.length === 0) return
  const entry = _queue.shift()!
  _running = true
  entry
    .fn()
    .then(entry.resolve)
    .catch(entry.reject)
    .finally(() => {
      _running = false
      _drain()
    })
}

/**
 * Enqueue a Wails binding call. Returns a Promise that resolves/rejects
 * with the same value as the underlying call, but is guaranteed to run
 * only when no other call is in-flight.
 */
export function wailsCall<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _queue.push({
      fn: fn as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
    })
    _drain()
  })
}

/** Current queue depth (in-flight + waiting). Useful for debugging. */
export function wailsQueueDepth(): number {
  return _queue.length + (_running ? 1 : 0)
}

