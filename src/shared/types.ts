/** Real power state of the LXC as reported by Proxmox. */
export type ServerState = 'running' | 'stopped' | 'unknown'

export interface StatusResponse {
  state: ServerState
}

export interface ActionResponse {
  ok: true
}

export interface ErrorResponse {
  error: string
}
