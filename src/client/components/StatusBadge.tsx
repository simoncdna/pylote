// src/client/components/StatusBadge.tsx
import type { UiState } from '../state.ts'

const LABEL: Record<UiState, string> = {
  on: 'Online',
  off: 'Offline',
  pending: 'Starting…',
  error: 'Error',
}

export function StatusBadge({ ui }: { ui: UiState }) {
  return (
    <span className={`badge badge-${ui}`}>
      <span className="badge-dot" />
      {LABEL[ui]}
    </span>
  )
}
