// src/client/App.tsx
import { useMemo } from 'react'
import { createApiClient } from './api.ts'
import { useServers, type ServerView } from './useServers.ts'
import { deriveUiState } from './state.ts'
import { StatusBadge } from './components/StatusBadge.tsx'
import { ToggleButton } from './components/ToggleButton.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { Embers } from './components/Embers.tsx'
import { ServerCard } from './components/ServerCard.tsx'
import { useTheme } from './useTheme.ts'

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
  const { servers, loaded, listError } = useServers(api)
  const anyOn = servers.some((s) => !s.busy && !s.error && s.state === 'running')

  return (
    <main className="screen">
      <Embers active={anyOn} />
      <header className="header">
        <h1 className="brand">Pylote</h1>
        <p className="sub">Server control</p>
      </header>
      {!loaded ? null : listError ? (
        <section className="center">
          <span className="err-msg">Pylote backend unreachable</span>
        </section>
      ) : servers.length === 1 ? (
        <SingleServer server={servers[0]} />
      ) : (
        <section className="cards">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </section>
      )}
    </main>
  )
}

/** The original full-page layout, kept when exactly one server is configured. */
function SingleServer({ server }: { server: ServerView }) {
  const ui = deriveUiState({
    state: server.state,
    busy: server.busy,
    error: server.error,
  })
  return (
    <section className="center">
      <StatusBadge ui={ui} pendingAction={server.pendingAction} />
      <ToggleButton ui={ui} onToggle={server.toggle} name={server.name} />
      <span className="name">{server.name}</span>
      {/* Always rendered so its reserved height keeps the block from shifting
          when the error line appears/disappears. */}
      <span className="err-msg">{ui === 'error' ? 'Backend unreachable' : ''}</span>
    </section>
  )
}
