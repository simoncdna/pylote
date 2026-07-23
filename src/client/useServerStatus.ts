// src/client/useServerStatus.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerState } from '../shared/types.ts'
import type { ApiClient } from './api.ts'

const POLL_MS = 5000
// Proxmox start/stop are async tasks: the API returns as soon as the task is
// queued, long before the LXC actually reaches the target state. While a toggle
// is in flight we poll faster and keep `busy` set until the target is reached
// (or we give up), so the loading animation lasts the whole transition instead
// of flickering off after the first (near-instant) API response.
const TRANSITION_POLL_MS = 2000
const TRANSITION_TIMEOUT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Which direction a toggle is heading while `busy`. */
export type PendingAction = 'start' | 'stop'

export interface ServerStatus {
  state: ServerState
  busy: boolean
  error: boolean
  /** Set while a toggle is in flight, so the UI can say "Starting…"/"Stopping…". */
  pendingAction: PendingAction | null
  toggle: () => void
}

export function useServerStatus(api: ApiClient): ServerStatus {
  const [state, setState] = useState<ServerState>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy

  const refresh = useCallback(async () => {
    if (busyRef.current) return // don't fight an in-flight action
    try {
      setState(await api.getStatus())
      setError(false)
    } catch {
      setError(true)
    }
  }, [api])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    const action: PendingAction = state === 'running' ? 'stop' : 'start'
    const target: ServerState = action === 'stop' ? 'stopped' : 'running'
    setBusy(true)
    setPendingAction(action)
    setError(false)
    try {
      if (action === 'stop') await api.stop()
      else await api.start()

      // Wait for the LXC to actually reach the target state.
      const deadline = Date.now() + TRANSITION_TIMEOUT_MS
      while (Date.now() < deadline) {
        await sleep(TRANSITION_POLL_MS)
        try {
          const current = await api.getStatus()
          setState(current)
          if (current === target) break
        } catch {
          // Transient failure mid-transition (e.g. node briefly busy): keep
          // waiting rather than aborting the whole toggle.
        }
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
      setPendingAction(null)
      refresh()
    }
  }, [api, state, refresh])

  return { state, busy, error, pendingAction, toggle }
}
