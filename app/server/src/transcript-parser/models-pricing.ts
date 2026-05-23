import type { ModelPricing } from './types'

export type { ModelPricing } from './types'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

let cache: Record<string, ModelPricing> = {}
let cacheTimestamp = 0
let inFlight: Promise<Record<string, ModelPricing>> | null = null

/**
 * Returns a model-id → pricing map. Fetches from models.dev on first
 * call; caches for 24 hours. On fetch failure returns whatever is
 * cached (empty map if nothing yet). Never throws.
 */
export async function getModelsPricing(): Promise<Record<string, ModelPricing>> {
  const now = Date.now()
  if (cacheTimestamp && now - cacheTimestamp < TTL_MS) {
    return cache
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const res = await fetch(MODELS_DEV_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      cache = extractClaudePricing(body)
      cacheTimestamp = Date.now()
      return cache
    } catch (err) {
      console.warn('[models-pricing] fetch failed, returning cached map:', err)
      return cache
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

function extractClaudePricing(body: any): Record<string, ModelPricing> {
  const out: Record<string, ModelPricing> = {}
  const models = body?.anthropic?.models ?? {}
  for (const [id, raw] of Object.entries(models)) {
    if (typeof id !== 'string' || !id.startsWith('claude-')) continue
    const cost = (raw as any)?.cost
    if (!cost) continue
    const inputPerM = Number(cost.input ?? 0)
    const outputPerM = Number(cost.output ?? 0)
    const cacheReadPerM = Number(cost.cache_read ?? 0)
    // models.dev currently exposes a single `cache_write` rate; we use
    // it for both 5m and 1h. If they split later we'll read both.
    const cacheWritePerM = Number(cost.cache_write ?? cost.cache_creation ?? 0)
    out[id] = {
      inputPerM,
      outputPerM,
      cacheReadPerM,
      cacheCreate5mPerM: cacheWritePerM,
      cacheCreate1hPerM: cacheWritePerM,
    }
  }
  return out
}

/** Test-only: force the next call to re-fetch. */
export function _testForceExpiry(): void {
  cacheTimestamp = 0
}

/** Test-only: reset cache entirely. */
export function _testReset(): void {
  cache = {}
  cacheTimestamp = 0
  inFlight = null
}
