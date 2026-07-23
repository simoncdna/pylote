import type { ServerState } from '../shared/types.ts'

export type UiState = 'on' | 'off' | 'pending' | 'error'

export interface UiInputs {
  state: ServerState
  busy: boolean
  error: boolean
}

export function deriveUiState({ state, busy, error }: UiInputs): UiState {
  if (busy) return 'pending'
  if (error) return 'error'
  if (state === 'running') return 'on'
  if (state === 'stopped') return 'off'
  return 'error'
}
