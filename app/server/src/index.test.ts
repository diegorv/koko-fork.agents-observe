import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// index.ts boots the server at import time. We mock every side-effecting
// dependency so importing it is safe in a test.

const noop = () => {}

function setupSafeMocks(opts: { repairOrphans: () => Promise<unknown> }) {
  vi.doMock('./config', () => ({
    config: { port: 0, bindHost: '127.0.0.1' },
  }))
  vi.doMock('./storage', () => ({
    createStore: () => ({
      repairOrphans: opts.repairOrphans,
      // Other store methods are not exercised by index.ts boot.
    }),
  }))
  vi.doMock('./app', () => ({
    createApp: () => ({ fetch: noop }),
  }))
  vi.doMock('./websocket', () => ({
    attachWebSocket: noop,
    broadcastToSession: noop,
    broadcastToAll: noop,
    broadcastActivity: noop,
  }))
  vi.doMock('./consumer-tracker', () => ({
    startConsumerSweep: noop,
  }))
  // Mock the http server so listening on PORT=0 doesn't actually bind.
  vi.doMock('@hono/node-server', () => ({
    serve: (_opts: unknown, cb?: () => void) => {
      if (cb) cb()
      return { on: noop, close: noop }
    },
  }))
}

describe('index.ts — repairOrphans error handling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('rejection from repairOrphans triggers process.exit(1) and logs', async () => {
    const repairError = new Error('boom')
    setupSafeMocks({
      repairOrphans: () => Promise.reject(repairError),
    })

    const exitSpy = vi
      .spyOn(process, 'exit')
      // Casting to never matches the real signature; the spy short-circuits exit.
      .mockImplementation(((_code?: number) => undefined as never) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop)

    await import('./index')

    // Allow the rejected microtask + .catch handler to settle.
    await new Promise((resolve) => setImmediate(resolve))

    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls[0]?.join(' ') ?? ''
    expect(logged).toMatch(/repairOrphans failed/)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('successful repair does not exit and does not log on zero-row result', async () => {
    setupSafeMocks({
      repairOrphans: async () => ({
        sessionsReassigned: 0,
        agentsDeleted: 0,
        agentsReparented: 0,
        eventsDeleted: 0,
      }),
    })

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined as never) as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(noop)

    await import('./index')
    await new Promise((resolve) => setImmediate(resolve))

    expect(exitSpy).not.toHaveBeenCalledWith(1)
    expect(errorSpy).not.toHaveBeenCalled()
    // Server start logs are fine; we only assert no "[startup] Repaired" log
    // for the zero-result case.
    const startupLogs = logSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.includes('[startup] Repaired'))
    expect(startupLogs).toEqual([])
  })
})
