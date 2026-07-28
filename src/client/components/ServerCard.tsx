// src/client/components/ServerCard.tsx
import type { CSSProperties } from 'react'
import type { ServerView } from '../useServers.ts'
import { deriveUiState } from '../state.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { ToggleButton } from './ToggleButton.tsx'

const GAME_ACCENTS: Record<string, string> = {
  enshrouded: '#4da6ff',
  valheim: '#e05545',
  minecraft: '#5bbf3f',
}
const DEFAULT_ACCENT = '#8a93a6'

export function ServerCard({ server }: { server: ServerView }) {
  const ui = deriveUiState({
    state: server.state,
    busy: server.busy,
    error: server.error,
  })
  const accent = GAME_ACCENTS[server.game ?? ''] ?? DEFAULT_ACCENT
  return (
    <article className="card" style={{ '--accent': accent } as CSSProperties}>
      <header className="card-head">
        <span className="card-name">{server.name}</span>
        {server.game && <span className="card-game">{server.game}</span>}
      </header>
      <StatusBadge ui={ui} pendingAction={server.pendingAction} />
      <div className="card-toggle">
        <ToggleButton ui={ui} onToggle={server.toggle} />
      </div>
      <span className="err-msg">{ui === 'error' ? 'Backend unreachable' : ''}</span>
    </article>
  )
}
