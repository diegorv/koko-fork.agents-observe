import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseWsMessage } from './ws-parse'

describe('parseWsMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a valid event frame', () => {
    const raw = JSON.stringify({ type: 'event', data: { id: 1 } })
    expect(parseWsMessage(raw)).toEqual({ type: 'event', data: { id: 1 } })
  })

  it('returns null and logs on malformed JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseWsMessage('{not-json')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/dropped malformed message/)
  })

  it('returns null and logs on non-string payload', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseWsMessage(new Blob())).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropped non-string message/))
  })

  it('truncates raw preview to 120 chars on parse failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseWsMessage('x'.repeat(500))
    const logged = warn.mock.calls[0]?.[0] as string
    const match = logged.match(/raw: (.*)\)$/)
    expect(match).not.toBeNull()
    expect(match![1].length).toBeLessThanOrEqual(120)
  })
})
