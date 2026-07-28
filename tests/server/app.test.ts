import { test, expect } from 'bun:test'
import { createApp } from '../../src/server/app.ts'
import type { Registry, RegistryEntry } from '../../src/server/registry.ts'
import type { PowerProvider } from '../../src/server/providers/types.ts'

function entry(
  id: string,
  name: string,
  provider: Partial<PowerProvider> = {},
): [string, RegistryEntry] {
  return [
    id,
    {
      meta: { id, name, type: 'proxmox-lxc' },
      provider: {
        status: async () => 'running',
        start: async () => {},
        stop: async () => {},
        ...provider,
      },
    },
  ]
}

function makeRegistry(...entries: [string, RegistryEntry][]): Registry {
  return new Map(entries)
}

test('GET /api/health returns ok', async () => {
  const app = createApp({ registry: makeRegistry(entry('a', 'A')) })
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('GET /api/servers lists every server with its state', async () => {
  const app = createApp({
    registry: makeRegistry(
      entry('a', 'A'),
      entry('b', 'B', { status: async () => 'stopped' }),
    ),
  })
  const res = await app.request('/api/servers')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([
    { id: 'a', name: 'A', type: 'proxmox-lxc', state: 'running' },
    { id: 'b', name: 'B', type: 'proxmox-lxc', state: 'stopped' },
  ])
})

test('one unreachable backend yields unknown, not a global failure', async () => {
  const app = createApp({
    registry: makeRegistry(
      entry('a', 'A'),
      entry('b', 'B', { status: async () => { throw new Error('down') } }),
    ),
  })
  const res = await app.request('/api/servers')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { id: string; state: string }[]
  expect(body.find((s) => s.id === 'a')!.state).toBe('running')
  expect(body.find((s) => s.id === 'b')!.state).toBe('unknown')
})

test('POST /api/servers/:id/start calls the provider', async () => {
  let started = false
  const app = createApp({
    registry: makeRegistry(entry('a', 'A', { start: async () => { started = true } })),
  })
  const res = await app.request('/api/servers/a/start', { method: 'POST' })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(started).toBe(true)
})

test('POST /api/servers/:id/stop calls the provider', async () => {
  let stopped = false
  const app = createApp({
    registry: makeRegistry(entry('a', 'A', { stop: async () => { stopped = true } })),
  })
  const res = await app.request('/api/servers/a/stop', { method: 'POST' })
  expect(res.status).toBe(200)
  expect(stopped).toBe(true)
})

test('unknown id → 404', async () => {
  const app = createApp({ registry: makeRegistry(entry('a', 'A')) })
  const res = await app.request('/api/servers/nope/start', { method: 'POST' })
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'Unknown server' })
})

test('backend failure on action → 502 with server name', async () => {
  const app = createApp({
    registry: makeRegistry(
      entry('a', 'Enshrouded', { start: async () => { throw new Error('down') } }),
    ),
  })
  const res = await app.request('/api/servers/a/start', { method: 'POST' })
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'Enshrouded: backend unreachable' })
})
