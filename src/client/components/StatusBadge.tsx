// src/client/components/StatusBadge.tsx
import type { UiState } from '../state.ts'
import type { PendingAction } from '../useServers.ts'

const LABEL: Record<UiState, string> = {
  on: 'Online',
  off: 'Offline',
  pending: 'Starting…',
  error: 'Error',
}

export function StatusBadge({
  ui,
  pendingAction,
}: {
  ui: UiState
  pendingAction?: PendingAction | null
}) {
  const label =
    ui === 'pending' && pendingAction
      ? pendingAction === 'stop'
        ? 'Stopping…'
        : 'Starting…'
      : LABEL[ui]
  return (
    <span className={`badge badge-${ui}`} role="status">
      <span className="badge-dot" />
      {label}
    </span>
  )
}
