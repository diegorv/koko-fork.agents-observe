// app/client/src/hooks/ws-parse.ts
// Pure helper extracted from use-websocket so the parse path can be unit-tested
// without booting React + jsdom WebSocket scaffolding.

import type { WSMessage } from '@/types'

/** Parse an inbound WS frame. Returns null and logs a warning on parse
 *  failure so malformed frames are visible in the browser console rather
 *  than silently dropped. */
export function parseWsMessage(data: unknown): WSMessage | null {
  if (typeof data !== 'string') {
    console.warn(`[WS] dropped non-string message (type: ${typeof data})`)
    return null
  }
  try {
    return JSON.parse(data) as WSMessage
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[WS] dropped malformed message: ${reason} (raw: ${data.slice(0, 120)})`)
    return null
  }
}
