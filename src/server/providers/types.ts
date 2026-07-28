import type { ServerState } from '../../shared/types.ts'

/** What every backend must implement to appear on the dashboard. */
export interface PowerProvider {
  status(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}
