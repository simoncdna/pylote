import { test, expect } from 'bun:test'
import { createApiClient } from '../../src/client/api.ts'

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

test('listServers GETs /api/servers and returns the list', async () => {
  const servers = [
    { id: 'a', name: 'A', type: 'proxmox-lxc', state: 'running' },
  ]
  const { fn, calls } = fakeFetch(200, servers)
  const api = createApiClient(fn)
  expect(await api.listServers()).toEqual(servers)
  expect(calls[0].url).toBe('/api/servers')
})

test('start POSTs to /api/servers/:id/start', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  await createApiClient(fn).start('enshrouded')
  expect(calls[0].url).toBe('/api/servers/enshrouded/start')
  expect(calls[0].init?.method).toBe('POST')
})

test('stop POSTs to /api/servers/:id/stop', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  await createApiClient(fn).stop('enshrouded')
  expect(calls[0].url).toBe('/api/servers/enshrouded/stop')
})

test('non-2xx throws', async () => {
  const { fn } = fakeFetch(502, { error: 'down' })
  await expect(createApiClient(fn).listServers()).rejects.toThrow()
})
