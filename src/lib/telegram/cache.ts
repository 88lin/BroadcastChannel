import { LRUCache } from 'lru-cache'

const FRESH_TTL = 5 * 60 * 1000
const STALE_TTL = 24 * 60 * 60 * 1000
interface Entry { value: object, freshUntil: number }

// One shared budget for parsed source pages, merged timelines and individual posts.
// The estimate includes UTF-16 strings and object overhead, not a heap guarantee.
const cache = new LRUCache<string, Entry>({ max: 256, maxSize: 8 * 1024 * 1024, ttl: STALE_TTL })
const inFlight = new Map<string, Promise<object | null>>()
const sizes = new WeakMap<object, number>()

function freezeAndEstimate(value: unknown): number {
  if (typeof value === 'string')
    return 2 * value.length
  if (!value || typeof value !== 'object')
    return 8
  const known = sizes.get(value)
  if (known !== undefined)
    return known
  let size = 64
  for (const [key, child] of Object.entries(value)) {
    size += 16 + 2 * key.length + freezeAndEstimate(child)
  }
  Object.freeze(value)
  sizes.set(value, size)
  return size
}

export function getCachedValue<T extends object>(key: string): T | undefined {
  const entry = cache.get(key)
  return entry && entry.freshUntil > Date.now() ? entry.value as T : undefined
}

export function setCacheValue(key: string, value: object): void {
  const size = freezeAndEstimate(value) + key.length * 2 + 64
  cache.set(key, { value, freshUntil: Date.now() + FRESH_TTL }, { size })
}

export async function loadCachedValue<T extends object | null>(key: string, load: () => Promise<T>, allowStale = true): Promise<T> {
  const fresh = getCachedValue<NonNullable<T>>(key)
  if (fresh)
    return fresh as T
  const pending = inFlight.get(key)
  if (pending)
    return pending as Promise<T>
  const request = load().then((value) => {
    if (value)
      setCacheValue(key, value)
    return value
  }).catch((error) => {
    const stale = allowStale ? cache.get(key) : undefined
    if (stale) {
      console.warn('Serving stale cache after fetch failure', {
        key,
        error: error instanceof Error ? error.message : String(error),
      })
      return stale.value as T
    }
    throw error
  }).finally(() => { inFlight.delete(key) })
  inFlight.set(key, request)
  return request
}
