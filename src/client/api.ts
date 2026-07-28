import type { ServerSummary } from '../shared/types.ts'

export interface ApiClient {
  listServers(): Promise<ServerSummary[]>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
}

export function createApiClient(fetchFn: typeof fetch = fetch): ApiClient {
  async function req(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(path, { method })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }

  return {
    async listServers() {
      return (await req('/api/servers', 'GET')) as ServerSummary[]
    },
    async start(id: string) {
      await req(`/api/servers/${encodeURIComponent(id)}/start`, 'POST')
    },
    async stop(id: string) {
      await req(`/api/servers/${encodeURIComponent(id)}/stop`, 'POST')
    },
  }
}
