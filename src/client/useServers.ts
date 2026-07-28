// src/client/useServers.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerState, ServerSummary } from '../shared/types.ts'
import type { ApiClient } from './api.ts'

const POLL_MS = 5000
// Start/stop are async on the backends (Proxmox queues a task, Docker stop
// waits for the process): keep the server "pending" until the target state is
// actually reached so the loading animation covers the whole transition.
const TRANSITION_POLL_MS = 2000
const TRANSITION_TIMEOUT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Which direction a toggle is heading while pending. */
export type PendingAction = 'start' | 'stop'

export interface ServerView extends ServerSummary {
  busy: boolean
  error: boolean
  pendingAction: PendingAction | null
  toggle: () => void
}

export interface ServersStatus {
  servers: ServerView[]
  /** True once the first /api/servers response (or failure) arrived. */
  loaded: boolean
  /** True when the list itself cannot be fetched (Pylote backend down). */
  listError: boolean
}

export function useServers(api: ApiClient): ServersStatus {
  const [list, setList] = useState<ServerSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [listError, setListError] = useState(false)
  const [pending, setPending] = useState<Record<string, PendingAction>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  // Guards against the 5s interval refresh and the 2s transition poll racing:
  // a stale response landing after a newer one has already resolved must not
  // overwrite `list` with outdated data.
  const seqRef = useRef(0)

  const fetchList = useCallback(async (): Promise<ServerSummary[]> => {
    const seq = ++seqRef.current
    const servers = await api.listServers()
    if (seq === seqRef.current) setList(servers)
    return servers
  }, [api])

  const refresh = useCallback(async () => {
    try {
      await fetchList()
      setListError(false)
    } catch {
      setListError(true)
    } finally {
      setLoaded(true)
    }
  }, [fetchList])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const toggle = useCallback(
    async (id: string, state: ServerState) => {
      if (pendingRef.current[id]) return
      const action: PendingAction = state === 'running' ? 'stop' : 'start'
      const target: ServerState = action === 'stop' ? 'stopped' : 'running'
      setPending((p) => ({ ...p, [id]: action }))
      setErrors((e) => ({ ...e, [id]: false }))
      try {
        if (action === 'stop') await api.stop(id)
        else await api.start(id)

        let reached = false
        const deadline = Date.now() + TRANSITION_TIMEOUT_MS
        while (Date.now() < deadline) {
          await sleep(TRANSITION_POLL_MS)
          try {
            const servers = await fetchList()
            if (servers.find((s) => s.id === id)?.state === target) {
              reached = true
              break
            }
          } catch {
            // Transient failure mid-transition: keep waiting.
          }
        }
        if (!reached) setErrors((e) => ({ ...e, [id]: true }))
      } catch {
        setErrors((e) => ({ ...e, [id]: true }))
      } finally {
        setPending((p) => {
          const { [id]: _drop, ...rest } = p
          return rest
        })
      }
    },
    [api, fetchList],
  )

  const servers: ServerView[] = list.map((s) => ({
    ...s,
    busy: Boolean(pending[s.id]),
    error: Boolean(errors[s.id]),
    pendingAction: pending[s.id] ?? null,
    toggle: () => toggle(s.id, s.state),
  }))

  return { servers, loaded, listError }
}
