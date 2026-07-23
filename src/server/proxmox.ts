import type { Config } from './config.ts'
import type { ServerState } from '../shared/types.ts'

export interface ProxmoxClient {
  getStatus(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}

export function createProxmoxClient(
  config: Config,
  fetchFn: typeof fetch = fetch,
): ProxmoxClient {
  const base = `${config.proxmoxUrl}/api2/json/nodes/${config.node}/lxc/${config.vmid}`
  const headers = {
    Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`,
  }
  // Proxmox typically uses a self-signed cert; accept it (server-side only).
  const tls = { rejectUnauthorized: false }

  async function call(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers,
      // Bun-specific fetch option for self-signed certs (typed via bun-types).
      tls,
    })
    if (!res.ok) {
      throw new Error(`Proxmox ${method} ${path} failed: ${res.status}`)
    }
    return res.json()
  }

  return {
    async getStatus() {
      const body = (await call('/status/current', 'GET')) as {
        data?: { status?: string }
      }
      const status = body.data?.status
      if (status === 'running') return 'running'
      if (status === 'stopped') return 'stopped'
      return 'unknown'
    },
    async start() {
      await call('/status/start', 'POST')
    },
    async stop() {
      await call('/status/shutdown', 'POST')
    },
  }
}
