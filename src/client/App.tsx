// src/client/App.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiClient } from './api.ts'
import { useServerStatus } from './useServerStatus.ts'
import { deriveUiState } from './state.ts'
import { StatusBadge } from './components/StatusBadge.tsx'
import { ToggleButton } from './components/ToggleButton.tsx'
import { SecretGate } from './components/SecretGate.tsx'

const SECRET_KEY = 'pylote.secret'
const SERVER_NAME = 'Enshrouded'

export function App() {
  const [secret, setSecret] = useState<string>(
    () => localStorage.getItem(SECRET_KEY) ?? '',
  )

  const saveSecret = useCallback((s: string) => {
    localStorage.setItem(SECRET_KEY, s)
    setSecret(s)
  }, [])

  if (!secret) return <SecretGate onSubmit={saveSecret} />
  return <Dashboard secret={secret} onLogout={() => saveSecret('')} />
}

function Dashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const api = useMemo(() => createApiClient(() => secret), [secret])
  const { state, busy, error, unauthorized, toggle } = useServerStatus(api)
  const ui = deriveUiState({ state, busy, error })

  // Wrong/expired secret: clear it and go back to the gate (in an effect,
  // never during render).
  useEffect(() => {
    if (unauthorized) onLogout()
  }, [unauthorized, onLogout])

  return (
    <main className="screen">
      <header className="header">
        <h1 className="brand">Pylote</h1>
        <p className="sub">Server control</p>
      </header>
      <section className="center">
        <StatusBadge ui={ui} />
        <ToggleButton ui={ui} onToggle={toggle} />
        <span className="name">{SERVER_NAME}</span>
        {ui === 'error' && <span className="err-msg">Proxmox unreachable</span>}
      </section>
    </main>
  )
}
