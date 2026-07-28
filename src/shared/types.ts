/** Real power state of a server as reported by its backend. */
export type ServerState = 'running' | 'stopped' | 'unknown'

export type BackendType = 'proxmox-lxc' | 'proxmox-vm' | 'docker'

/** One server as returned by GET /api/servers. */
export interface ServerSummary {
  id: string
  name: string
  game?: string
  type: BackendType
  state: ServerState
}

export interface ActionResponse {
  ok: true
}

export interface ErrorResponse {
  error: string
}
