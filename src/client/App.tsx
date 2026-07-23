// src/client/App.tsx
import { useMemo } from 'react'
import { createApiClient } from './api.ts'
import { useServerStatus } from './useServerStatus.ts'
import { deriveUiState } from './state.ts'
import { StatusBadge } from './components/StatusBadge.tsx'
import { ToggleButton } from './components/ToggleButton.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { Embers } from './components/Embers.tsx'
import { useTheme } from './useTheme.ts'

const SERVER_NAME = 'Enshrouded'

export function App() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <Dashboard />
    </>
  )
}

function Dashboard() {
  const api = useMemo(() => createApiClient(), [])
  const { state, busy, error, pendingAction, toggle } = useServerStatus(api)
  const ui = deriveUiState({ state, busy, error })

  return (
    <main className="screen">
      <Embers active={ui === 'on'} />
      <header className="header">
        <h1 className="brand">Pylote</h1>
        <p className="sub">Server control</p>
      </header>
      <section className="center">
        <StatusBadge ui={ui} pendingAction={pendingAction} />
        <ToggleButton ui={ui} onToggle={toggle} />
        <span className="name">{SERVER_NAME}</span>
        {/* Always rendered so its reserved height keeps the block from shifting
            when the error line appears/disappears. */}
        <span className="err-msg">{ui === 'error' ? 'Proxmox unreachable' : ''}</span>
      </section>
    </main>
  )
}
