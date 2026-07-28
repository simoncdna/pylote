import type { PowerProvider } from './types.ts'

export interface ProxmoxOptions {
  url: string
  tokenId: string
  tokenSecret: string
  node: string
  vmid: string
  /** Proxmox API path segment: LXC container vs QEMU virtual machine. */
  kind: 'lxc' | 'qemu'
}

export function createProxmoxProvider(
  opts: ProxmoxOptions,
  fetchFn: typeof fetch = fetch,
): PowerProvider {
  const base = `${opts.url.replace(/\/$/, '')}/api2/json/nodes/${opts.node}/${opts.kind}/${opts.vmid}`
  const headers = {
    Authorization: `PVEAPIToken=${opts.tokenId}=${opts.tokenSecret}`,
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
    async status() {
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
