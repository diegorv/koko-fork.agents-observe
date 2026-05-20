import { describe, test, expect } from 'vitest'
import { processEvent } from './index'
import { compileFilters } from '@/lib/filters/compile'
import type { Filter } from '@/types'
import type { ProcessingContext } from '../types'

const ALL_FILTER: Filter = {
  id: 'default-all',
  name: 'All',
  pillName: 'All',
  display: 'primary',
  combinator: 'and',
  patterns: [{ target: 'hook', regex: '^PostToolBatch$', negate: true }],
  kind: 'default',
  enabled: true,
  config: {},
  createdAt: 0,
  updatedAt: 0,
}

function ctx(filters: Filter[] = [ALL_FILTER]): ProcessingContext {
  return {
    dedupEnabled: true,
    compiledFilters: compileFilters(filters),
    getAgent: () => undefined,
    getGroupedEvents: () => [],
    getAgentEvents: () => [],
    getCurrentTurn: () => null,
    setCurrentTurn: () => {},
    clearCurrentTurn: () => {},
    getPendingGroup: () => null,
    setPendingGroup: () => {},
    clearPendingGroup: () => {},
    stashPendingAgentMeta: () => {},
    consumePendingAgentMeta: () => null,
    updateEvent: () => {},
  }
}

describe('default processEvent — All filter gating', () => {
  test('hides PostToolBatch events when default-all is enabled', () => {
    const raw = {
      id: 1,
      agentId: 'a',
      hookName: 'PostToolBatch',
      timestamp: 0,
      payload: {},
    }
    const { event } = processEvent(raw, ctx())
    expect(event.displayEventStream).toBe(false)
    expect(event.displayTimeline).toBe(false)
  })

  test('shows other events with default-all enabled', () => {
    const raw = {
      id: 1,
      agentId: 'a',
      hookName: 'UserPromptSubmit',
      timestamp: 0,
      payload: {},
    }
    const { event } = processEvent(raw, ctx())
    expect(event.displayEventStream).toBe(true)
    expect(event.displayTimeline).toBe(true)
  })
})
