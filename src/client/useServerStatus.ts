// src/client/useServerStatus.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerState } from '../shared/types.ts'
import type { ApiClient } from './api.ts'

const POLL_MS = 5000

export interface ServerStatus {
  state: ServerState
  busy: boolean
  error: boolean
  toggle: () => void
}

export function useServerStatus(api: ApiClient): ServerStatus {
  const [state, setState] = useState<ServerState>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
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
    setBusy(true)
    setError(false)
    try {
      if (state === 'running') await api.stop()
      else await api.start()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
      refresh()
    }
  }, [api, state, refresh])

  return { state, busy, error, toggle }
}
