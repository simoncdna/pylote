import type { ServerState, StatusResponse } from '../shared/types.ts'

export interface ApiClient {
  getStatus(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}

export function createApiClient(fetchFn: typeof fetch = fetch): ApiClient {
  async function req(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(path, { method })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }

  return {
    async getStatus() {
      const body = (await req('/api/status', 'GET')) as StatusResponse
      return body.state
    },
    async start() {
      await req('/api/start', 'POST')
    },
    async stop() {
      await req('/api/stop', 'POST')
    },
  }
}
