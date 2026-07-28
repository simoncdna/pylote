import { test, expect } from 'bun:test'
import {
  createProxmoxProvider,
  type ProxmoxOptions,
} from '../../../src/server/providers/proxmox.ts'

const opts: ProxmoxOptions = {
  url: 'https://pve.local:8006',
  tokenId: 'pylote@pve!toggle',
  tokenSecret: 'secret',
  node: 'pve',
  vmid: '105',
  kind: 'lxc',
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

test('status maps running → running and sends token header', async () => {
  const { fn, calls } = fakeFetch(200, { data: { status: 'running' } })
  const p = createProxmoxProvider(opts, fn)
  expect(await p.status()).toBe('running')
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/current',
  )
  const auth = new Headers(calls[0].init?.headers).get('Authorization')
  expect(auth).toBe('PVEAPIToken=pylote@pve!toggle=secret')
})

test('status maps stopped → stopped and unexpected → unknown', async () => {
  const stopped = fakeFetch(200, { data: { status: 'stopped' } })
  expect(await createProxmoxProvider(opts, stopped.fn).status()).toBe('stopped')
  const paused = fakeFetch(200, { data: { status: 'paused' } })
  expect(await createProxmoxProvider(opts, paused.fn).status()).toBe('unknown')
})

test('status throws on non-2xx response', async () => {
  const { fn } = fakeFetch(500, { errors: 'boom' })
  await expect(createProxmoxProvider(opts, fn).status()).rejects.toThrow()
})

test('kind qemu targets the qemu path', async () => {
  const { fn, calls } = fakeFetch(200, { data: { status: 'running' } })
  await createProxmoxProvider({ ...opts, kind: 'qemu', vmid: '200' }, fn).status()
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/qemu/200/status/current',
  )
})

test('start POSTs to start, stop POSTs to shutdown', async () => {
  const a = fakeFetch(200, { data: 'UPID:...' })
  await createProxmoxProvider(opts, a.fn).start()
  expect(a.calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/start',
  )
  expect(a.calls[0].init?.method).toBe('POST')

  const b = fakeFetch(200, { data: 'UPID:...' })
  await createProxmoxProvider(opts, b.fn).stop()
  expect(b.calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/shutdown',
  )
})

test('trailing slash in url is tolerated', async () => {
  const { fn, calls } = fakeFetch(200, { data: { status: 'running' } })
  await createProxmoxProvider({ ...opts, url: 'https://pve.local:8006/' }, fn).status()
  expect(calls[0].url).toBe(
    'https://pve.local:8006/api2/json/nodes/pve/lxc/105/status/current',
  )
})
