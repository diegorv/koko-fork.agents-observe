import { describe, it, expect, vi, afterEach } from 'vitest'
import { shouldBroadcastActivity, ACTIVITY_PING_THROTTLE_MS, parseClientMessage } from './websocket'

describe('shouldBroadcastActivity', () => {
  it('allows the first ping for an unseen session', () => {
    const map = new Map<string, number>()
    expect(shouldBroadcastActivity(map, 'sess-1', 1000)).toBe(true)
  })

  it('suppresses a second ping within the throttle window', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + 1)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS / 2)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS - 1)).toBe(false)
  })

  it('allows a ping exactly at the threshold boundary', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS)).toBe(true)
  })

  it('tracks each session independently', () => {
    const map = new Map<string, number>([['sess-1', 5000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 5001)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-2', 5001)).toBe(true)
  })

  it('honors a custom threshold', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 2000, 1000)).toBe(true)
    expect(shouldBroadcastActivity(map, 'sess-1', 2000, 10_000)).toBe(false)
  })

  it('treats a missing entry as never-sent', () => {
    const map = new Map<string, number>()
    expect(shouldBroadcastActivity(map, 'sess-1', 0)).toBe(true)
    expect(shouldBroadcastActivity(map, 'sess-1', Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('parseClientMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a valid subscribe frame', () => {
    const msg = parseClientMessage('{"type":"subscribe","sessionId":"abc"}')
    expect(msg).toEqual({ type: 'subscribe', sessionId: 'abc' })
  })

  it('returns null and logs on malformed JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const msg = parseClientMessage('{not-json')
    expect(msg).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/dropped malformed client message/)
  })

  it('truncates the raw preview to 120 characters', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bigRaw = 'x'.repeat(500) // not JSON, will throw
    parseClientMessage(bigRaw)
    const logged = warn.mock.calls[0]?.[0] as string
    // Preview is `raw: ` + at most 120 chars, then closing paren.
    const match = logged.match(/raw: (.*)\)$/)
    expect(match).not.toBeNull()
    expect(match![1].length).toBeLessThanOrEqual(120)
  })
})
