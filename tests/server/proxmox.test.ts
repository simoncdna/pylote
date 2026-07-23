import { test, expect } from 'bun:test'
import { createProxmoxClient } from '../../src/server/proxmox.ts'
import type { Config } from '../../src/server/config.ts'

const cfg: Config = {
  proxmoxUrl: 'https://pve.local:8006',
  tokenId: 'pylote@pve!toggle',
  tokenSecret: 'secret',
  node: 'pve',
  vmid: '105',
  authToken: 'x',
  port: 3000,
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, calls }
}

test('getStatus maps Proxmox running → running and sends token header', async () => {
  const { fn, calls } = fakeFetch(200, { data: { status: 'running' } })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  const state = await client.getStatus()
  expect(state).toBe('running')
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/current',
  )
  const auth = new Headers(calls[0].init?.headers).get('Authorization')
  expect(auth).toBe('PVEAPIToken=pylote@pve!toggle=secret')
})

test('getStatus maps stopped → stopped', async () => {
  const { fn } = fakeFetch(200, { data: { status: 'stopped' } })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  expect(await client.getStatus()).toBe('stopped')
})

test('getStatus returns unknown for unexpected status value', async () => {
  const { fn } = fakeFetch(200, { data: { status: 'paused' } })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  expect(await client.getStatus()).toBe('unknown')
})

test('getStatus throws on non-2xx response', async () => {
  const { fn } = fakeFetch(500, { errors: 'boom' })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  await expect(client.getStatus()).rejects.toThrow()
})

test('start POSTs to the start endpoint', async () => {
  const { fn, calls } = fakeFetch(200, { data: 'UPID:...' })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  await client.start()
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/start',
  )
  expect(calls[0].init?.method).toBe('POST')
})

test('stop POSTs to the shutdown endpoint', async () => {
  const { fn, calls } = fakeFetch(200, { data: 'UPID:...' })
  const client = createProxmoxClient(cfg, fn as unknown as typeof fetch)
  await client.stop()
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/shutdown',
  )
  expect(calls[0].init?.method).toBe('POST')
})
