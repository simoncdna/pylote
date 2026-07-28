import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Registry } from './registry.ts'
import type {
  ServerSummary,
  ServerState,
  ActionResponse,
  ErrorResponse,
} from '../shared/types.ts'

export interface AppDeps {
  registry: Registry
}

export function createApp({ registry }: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/servers', async (c) => {
    const summaries: ServerSummary[] = await Promise.all(
      [...registry.values()].map(async ({ meta, provider }) => {
        let state: ServerState = 'unknown'
        try {
          state = await provider.status()
        } catch {
          // Unreachable backend → unknown for this card, never a global 500.
        }
        return { ...meta, state }
      }),
    )
    return c.json(summaries)
  })

  function action(kind: 'start' | 'stop') {
    return async (
      c: Context<never, '/api/servers/:id/start' | '/api/servers/:id/stop'>,
    ) => {
      const entry = registry.get(c.req.param('id'))
      if (!entry) return c.json<ErrorResponse>({ error: 'Unknown server' }, 404)
      try {
        await entry.provider[kind]()
        return c.json<ActionResponse>({ ok: true })
      } catch {
        return c.json<ErrorResponse>(
          { error: `${entry.meta.name}: backend unreachable` },
          502,
        )
      }
    }
  }

  app.post('/api/servers/:id/start', action('start'))
  app.post('/api/servers/:id/stop', action('stop'))

  return app
}
