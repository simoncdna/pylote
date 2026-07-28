import { test, expect } from 'bun:test'
import {
  createDockerProvider,
  type DockerOptions,
} from '../../../src/server/providers/docker.ts'

const unixOpts: DockerOptions = {
  host: 'unix:///var/run/docker.sock',
  container: 'valheim-server',
}
const tcpOpts: DockerOptions = { host: 'tcp://vps:2375', container: 'valheim-server' }

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

test('unix host: requests http://localhost with the unix init option', async () => {
  const { fn, calls } = fakeFetch(200, { State: { Status: 'running' } })
  expect(await createDockerProvider(unixOpts, fn).status()).toBe('running')
  expect(calls[0].url).toBe('http://localhost/containers/valheim-server/json')
  expect((calls[0].init as { unix?: string }).unix).toBe('/var/run/docker.sock')
})

test('tcp host: requests http://host:port without unix option', async () => {
  const { fn, calls } = fakeFetch(200, { State: { Status: 'running' } })
  await createDockerProvider(tcpOpts, fn).status()
  expect(calls[0].url).toBe('http://vps:2375/containers/valheim-server/json')
  expect((calls[0].init as { unix?: string }).unix).toBeUndefined()
})

test('status maps exited and created → stopped, others → unknown', async () => {
  const exited = fakeFetch(200, { State: { Status: 'exited' } })
  expect(await createDockerProvider(unixOpts, exited.fn).status()).toBe('stopped')
  const created = fakeFetch(200, { State: { Status: 'created' } })
  expect(await createDockerProvider(unixOpts, created.fn).status()).toBe('stopped')
  const paused = fakeFetch(200, { State: { Status: 'paused' } })
  expect(await createDockerProvider(unixOpts, paused.fn).status()).toBe('unknown')
})

test('start/stop POST to the engine endpoints', async () => {
  const a = fakeFetch(204, '')
  await createDockerProvider(unixOpts, a.fn).start()
  expect(a.calls[0].url).toBe('http://localhost/containers/valheim-server/start')
  expect(a.calls[0].init?.method).toBe('POST')

  const b = fakeFetch(204, '')
  await createDockerProvider(unixOpts, b.fn).stop()
  expect(b.calls[0].url).toBe('http://localhost/containers/valheim-server/stop')
})

test('304 (already in requested state) is success', async () => {
  const { fn } = fakeFetch(304, '')
  await expect(createDockerProvider(unixOpts, fn).start()).resolves.toBeUndefined()
})

test('404 (no such container) throws', async () => {
  const { fn } = fakeFetch(404, { message: 'No such container' })
  await expect(createDockerProvider(unixOpts, fn).status()).rejects.toThrow()
})
