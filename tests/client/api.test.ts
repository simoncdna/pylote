import { test, expect } from 'bun:test'
import { createApiClient } from '../../src/client/api.ts'

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, calls }
}

test('getStatus returns state', async () => {
  const { fn, calls } = fakeFetch(200, { state: 'running' })
  const api = createApiClient(fn as unknown as typeof fetch)
  const state = await api.getStatus()
  expect(state).toBe('running')
  expect(calls[0].url).toBe('/api/status')
})

test('start POSTs to /api/start', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  const api = createApiClient(fn as unknown as typeof fetch)
  await api.start()
  expect(calls[0].url).toBe('/api/start')
  expect(calls[0].init?.method).toBe('POST')
})

test('stop POSTs to /api/stop', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  const api = createApiClient(fn as unknown as typeof fetch)
  await api.stop()
  expect(calls[0].url).toBe('/api/stop')
})

test('502 throws a generic error', async () => {
  const { fn } = fakeFetch(502, { error: 'Proxmox unreachable' })
  const api = createApiClient(fn as unknown as typeof fetch)
  await expect(api.getStatus()).rejects.toThrow()
})
