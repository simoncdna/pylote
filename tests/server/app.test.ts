import { test, expect } from 'bun:test'
import { createApp } from '../../src/server/app.ts'
import type { ProxmoxClient } from '../../src/server/proxmox.ts'

function fakeProxmox(over: Partial<ProxmoxClient> = {}): ProxmoxClient {
  return {
    getStatus: async () => 'running',
    start: async () => {},
    stop: async () => {},
    ...over,
  }
}

const AUTH = 'sekret'
const authed = { 'X-Auth-Token': AUTH }

test('GET /api/health needs no auth and returns ok', async () => {
  const app = createApp({ proxmox: fakeProxmox(), authToken: AUTH })
  const res = await app.request('/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('GET /api/status without token → 401', async () => {
  const app = createApp({ proxmox: fakeProxmox(), authToken: AUTH })
  const res = await app.request('/api/status')
  expect(res.status).toBe(401)
})

test('GET /api/status with token returns state', async () => {
  const app = createApp({ proxmox: fakeProxmox(), authToken: AUTH })
  const res = await app.request('/api/status', { headers: authed })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ state: 'running' })
})

test('POST /api/start calls proxmox.start and returns ok', async () => {
  let started = false
  const app = createApp({
    proxmox: fakeProxmox({ start: async () => { started = true } }),
    authToken: AUTH,
  })
  const res = await app.request('/api/start', { method: 'POST', headers: authed })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(started).toBe(true)
})

test('POST /api/stop calls proxmox.stop', async () => {
  let stopped = false
  const app = createApp({
    proxmox: fakeProxmox({ stop: async () => { stopped = true } }),
    authToken: AUTH,
  })
  const res = await app.request('/api/stop', { method: 'POST', headers: authed })
  expect(res.status).toBe(200)
  expect(stopped).toBe(true)
})

test('status maps proxmox failure → 502 with error message', async () => {
  const app = createApp({
    proxmox: fakeProxmox({ getStatus: async () => { throw new Error('down') } }),
    authToken: AUTH,
  })
  const res = await app.request('/api/status', { headers: authed })
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'Proxmox unreachable' })
})
