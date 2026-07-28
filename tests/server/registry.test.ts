import { test, expect } from 'bun:test'
import { buildRegistry } from '../../src/server/registry.ts'
import type { AppConfig } from '../../src/server/config.ts'

const config: AppConfig = {
  port: 3000,
  servers: [
    {
      id: 'enshrouded',
      name: 'Enshrouded',
      game: 'enshrouded',
      type: 'proxmox-lxc',
      url: 'https://pve.local:8006',
      tokenId: 't',
      tokenSecret: 's',
      node: 'pve',
      vmid: '103',
    },
    {
      id: 'win',
      name: 'Windows VM',
      type: 'proxmox-vm',
      url: 'https://pve.local:8006',
      tokenId: 't',
      tokenSecret: 's',
      node: 'pve',
      vmid: '200',
    },
    {
      id: 'valheim',
      name: 'Valheim',
      type: 'docker',
      host: 'tcp://vps:2375',
      container: 'valheim-server',
    },
  ],
}

function fakeFetch() {
  const calls: string[] = []
  const fn = async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify({ data: { status: 'running' }, State: { Status: 'running' } }))
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

test('buildRegistry keys entries by id with meta (no secrets)', () => {
  const { fn } = fakeFetch()
  const reg = buildRegistry(config, fn)
  expect([...reg.keys()]).toEqual(['enshrouded', 'win', 'valheim'])
  expect(reg.get('enshrouded')!.meta).toEqual({
    id: 'enshrouded',
    name: 'Enshrouded',
    game: 'enshrouded',
    type: 'proxmox-lxc',
  })
  expect(reg.get('valheim')!.meta.game).toBeUndefined()
})

test('proxmox-vm entries talk to the qemu API path', async () => {
  const { fn, calls } = fakeFetch()
  const reg = buildRegistry(config, fn)
  await reg.get('win')!.provider.status()
  expect(calls[0]).toContain('/qemu/200/')
  await reg.get('enshrouded')!.provider.status()
  expect(calls[1]).toContain('/lxc/103/')
})

test('docker entries talk to the Docker engine', async () => {
  const { fn, calls } = fakeFetch()
  await buildRegistry(config, fn).get('valheim')!.provider.status()
  expect(calls[0]).toBe('http://vps:2375/containers/valheim-server/json')
})
