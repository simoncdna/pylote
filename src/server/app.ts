import { Hono } from 'hono'
import type { ProxmoxClient } from './proxmox.ts'
import type {
  StatusResponse,
  ActionResponse,
  ErrorResponse,
} from '../shared/types.ts'

export interface AppDeps {
  proxmox: ProxmoxClient
  authToken: string
}

export function createApp({ proxmox, authToken }: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  // Shared-secret auth for every other /api route.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()
    if (c.req.header('X-Auth-Token') !== authToken) {
      return c.json<ErrorResponse>({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/api/status', async (c) => {
    try {
      const state = await proxmox.getStatus()
      return c.json<StatusResponse>({ state })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  app.post('/api/start', async (c) => {
    try {
      await proxmox.start()
      return c.json<ActionResponse>({ ok: true })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  app.post('/api/stop', async (c) => {
    try {
      await proxmox.stop()
      return c.json<ActionResponse>({ ok: true })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  return app
}
