// app/server/src/routes/sessions.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'
import { apiError } from '../errors'

function deriveSessionStatus(stoppedAt: number | null | undefined): string {
  return stoppedAt ? 'ended' : 'active'
}

function parseAgentClasses(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return raw.split(',').filter(Boolean)
}

/** Hard cap on `?limit=` for any list endpoint. Above this the request
 *  has no useful UX intent and risks loading the world into memory. */
export const MAX_LIST_LIMIT = 500

/** Parse a positive-integer query parameter. Returns:
 *   - { ok: true, value } when valid (or falls back to `defaultValue` if raw is undefined),
 *   - { ok: false, reason } otherwise.
 *  `max` caps the value to MAX_LIST_LIMIT by default. */
export function parsePositiveIntParam(
  raw: string | undefined,
  paramName: string,
  opts: { defaultValue?: number; max?: number } = {},
): { ok: true; value: number | undefined } | { ok: false; reason: string } {
  if (raw === undefined || raw === '') {
    return { ok: true, value: opts.defaultValue }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: `${paramName} must be a non-negative integer` }
  }
  const max = opts.max ?? MAX_LIST_LIMIT
  if (n > max) return { ok: true, value: max }
  return { ok: true, value: n }
}

/** Parse a JSON column without throwing. A corrupt row used to crash the
 *  entire list endpoint; now it returns null and logs once so the row id
 *  is traceable. */
export function safeParseJson(raw: unknown, context: string): unknown | null {
  if (raw == null) return null
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[sessions] corrupt ${context} JSON dropped: ${reason}`)
    return null
  }
}

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

function rowToRecentSession(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectSlug: r.project_slug,
    slug: r.slug,
    transcriptPath: r.transcript_path || null,
    startCwd: r.start_cwd || null,
    status: deriveSessionStatus(r.stopped_at),
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    metadata: safeParseJson(r.metadata, `session ${r.id} metadata`),
    agentCount: r.agent_count,
    eventCount: r.event_count,
    lastActivity: r.last_activity,
    agentClasses: parseAgentClasses(r.agent_classes),
  }
}

// GET /sessions/recent
router.get('/sessions/recent', async (c) => {
  const store = c.get('store')
  const parsed = parsePositiveIntParam(c.req.query('limit'), 'limit', { defaultValue: 20 })
  if (!parsed.ok) return apiError(c, 400, parsed.reason)
  const rows = await store.getRecentSessions(parsed.value ?? 20)
  return c.json(rows.map(rowToRecentSession))
})

// GET /sessions/unassigned — sessions with project_id IS NULL, used by
// the sidebar's "Unassigned" bucket. Avoids the previous client-side
// filter on /sessions/recent that pulled rows the sidebar would
// immediately throw away.
router.get('/sessions/unassigned', async (c) => {
  const store = c.get('store')
  const parsed = parsePositiveIntParam(c.req.query('limit'), 'limit', { defaultValue: 100 })
  if (!parsed.ok) return apiError(c, 400, parsed.reason)
  const rows = await store.getUnassignedSessions(parsed.value ?? 100)
  return c.json(rows.map(rowToRecentSession))
})

// GET /sessions/:id
router.get('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const row = await store.getSessionById(sessionId)
  if (!row) return apiError(c, 404, 'Session not found')
  return c.json({
    id: row.id,
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    slug: row.slug,
    status: deriveSessionStatus(row.stopped_at),
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    transcriptPath: row.transcript_path || null,
    startCwd: row.start_cwd || null,
    metadata: safeParseJson(row.metadata, `session ${row.id} metadata`),
    agentCount: row.agent_count,
    eventCount: row.event_count,
    lastActivity: row.last_activity,
    agentClasses: parseAgentClasses(row.agent_classes),
  })
})

// GET /sessions/:id/agents
router.get('/sessions/:id/agents', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const rows = await store.getAgentsForSession(sessionId)
  const agents = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    agentType: r.agent_type || null,
    agentClass: r.agent_class || null,
  }))
  return c.json(agents)
})

// Allow-list of opt-in `fields=` values. Default response omits all of
// these; clients pass `?fields=sessionId,cwd,createdAt,_meta` to opt in.
const OPT_IN_FIELDS = new Set(['sessionId', 'cwd', 'createdAt', '_meta'])

// GET /sessions/:id/events
router.get('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = decodeURIComponent(c.req.param('id'))
  const sinceParam = c.req.query('since')
  const agentIdParam = c.req.query('agentId')
  const fieldsParam = c.req.query('fields')

  const requested = new Set(
    (fieldsParam ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => OPT_IN_FIELDS.has(f)),
  )

  let rows
  if (sinceParam !== undefined) {
    // `since` has no sensible upper bound — it is a millisecond timestamp,
    // not a row limit — so we validate it as a non-negative integer with no
    // cap. Allow the natural Number.MAX_SAFE_INTEGER ceiling.
    const sinceParsed = parsePositiveIntParam(sinceParam, 'since', {
      max: Number.MAX_SAFE_INTEGER,
    })
    if (!sinceParsed.ok) return apiError(c, 400, sinceParsed.reason)
    rows = await store.getEventsSince(sessionId, sinceParsed.value ?? 0)
  } else {
    const limitParsed = parsePositiveIntParam(c.req.query('limit'), 'limit')
    if (!limitParsed.ok) return apiError(c, 400, limitParsed.reason)
    const offsetParsed = parsePositiveIntParam(c.req.query('offset'), 'offset', {
      max: Number.MAX_SAFE_INTEGER,
    })
    if (!offsetParsed.ok) return apiError(c, 400, offsetParsed.reason)
    rows = await store.getEventsForSession(sessionId, {
      agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
      hookName: c.req.query('hookName') || undefined,
      search: c.req.query('search') || undefined,
      limit: limitParsed.value,
      offset: offsetParsed.value,
    })
  }

  interface EventRow {
    id: number
    agentId: string
    hookName: string
    timestamp: number
    payload: unknown
    [key: string]: unknown
  }

  const events: EventRow[] = rows.map((r) => {
    const base: EventRow = {
      id: r.id,
      agentId: r.agent_id,
      hookName: r.hook_name,
      timestamp: r.timestamp,
      payload: safeParseJson(r.payload, `event ${r.id} payload`),
    }
    if (requested.has('sessionId')) base.sessionId = r.session_id
    if (requested.has('cwd')) base.cwd = r.cwd ?? null
    if (requested.has('createdAt')) base.createdAt = r.created_at ?? r.timestamp
    if (requested.has('_meta')) base._meta = safeParseJson(r._meta, `event ${r.id} _meta`)
    return base
  })

  // Lazy session status correction based on event history.
  if (events.length > 0) {
    let lastSessionEndIdx = -1
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].hookName === 'SessionEnd') {
        lastSessionEndIdx = i
        break
      }
    }
    const session = await store.getSessionById(sessionId)
    if (session) {
      const isStopped = !!session.stopped_at
      if (lastSessionEndIdx >= 0 && lastSessionEndIdx === events.length - 1 && !isStopped) {
        await store.updateSessionStatus(sessionId, 'stopped')
      } else if (lastSessionEndIdx >= 0 && lastSessionEndIdx < events.length - 1 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      } else if (lastSessionEndIdx < 0 && isStopped) {
        await store.updateSessionStatus(sessionId, 'active')
      }
    }
  }

  return c.json(events)
})

// PATCH /sessions/:id — update session table fields (slug, projectId)
router.patch('/sessions/:id', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (typeof data.slug === 'string') {
      const slug = data.slug.trim()
      if (!slug) return apiError(c, 400, 'slug must not be empty')
      await store.updateSessionSlug(sessionId, slug)

      if (LOG_LEVEL === 'debug') {
        console.log(`[METADATA] Session ${sessionId.slice(0, 8)} slug: ${slug}`)
      }

      broadcastToAll({ type: 'session_update', data: { id: sessionId, slug } as any })
    }

    if (data.projectId && typeof data.projectId === 'number') {
      await store.updateSessionProject(sessionId, data.projectId)
      broadcastToAll({
        type: 'session_update',
        data: { id: sessionId, projectId: data.projectId },
      })
    }

    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

// PATCH /sessions/:id/metadata — merge keys into session metadata JSON
router.patch('/sessions/:id/metadata', async (c) => {
  const store = c.get('store')

  try {
    const sessionId = decodeURIComponent(c.req.param('id'))
    const patch = (await c.req.json()) as Record<string, unknown>

    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return apiError(c, 400, 'Provide at least one key to patch')
    }

    await store.patchSessionMetadata(sessionId, patch)
    return c.json({ ok: true })
  } catch {
    return apiError(c, 400, 'Invalid request')
  }
})

export default router
