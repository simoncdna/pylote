import type { PowerProvider } from './types.ts'
import type { ServerState } from '../../shared/types.ts'

export interface DockerOptions {
  /** `unix:///var/run/docker.sock` or `tcp://host:2375`. */
  host: string
  /** Container name or id. */
  container: string
}

function mapStatus(status: string | undefined): ServerState {
  if (status === 'running') return 'running'
  if (status === 'exited' || status === 'created') return 'stopped'
  return 'unknown'
}

export function createDockerProvider(
  opts: DockerOptions,
  fetchFn: typeof fetch = fetch,
): PowerProvider {
  const unix = opts.host.startsWith('unix://')
    ? opts.host.slice('unix://'.length)
    : undefined
  const base = unix
    ? 'http://localhost'
    : opts.host.replace(/^tcp:\/\//, 'http://').replace(/\/$/, '')
  const name = encodeURIComponent(opts.container)

  async function call(path: string, method: 'GET' | 'POST'): Promise<Response> {
    // `unix` is a Bun-specific fetch option: route the request over a socket.
    const init = { method, ...(unix ? { unix } : {}) } as RequestInit
    const res = await fetchFn(`${base}${path}`, init)
    // 304 = container already in the requested state — that's success.
    if (!res.ok && res.status !== 304) {
      throw new Error(`Docker ${method} ${path} failed: ${res.status}`)
    }
    return res
  }

  return {
    async status() {
      const res = await call(`/containers/${name}/json`, 'GET')
      const body = (await res.json()) as { State?: { Status?: string } }
      return mapStatus(body.State?.Status)
    },
    async start() {
      await call(`/containers/${name}/start`, 'POST')
    },
    async stop() {
      await call(`/containers/${name}/stop`, 'POST')
    },
  }
}
