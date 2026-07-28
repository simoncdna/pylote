import type { AppConfig, ServerConfig } from './config.ts'
import type { PowerProvider } from './providers/types.ts'
import { createProxmoxProvider } from './providers/proxmox.ts'
import { createDockerProvider } from './providers/docker.ts'
import type { BackendType } from '../shared/types.ts'

export interface ServerMeta {
  id: string
  name: string
  game?: string
  type: BackendType
}

export interface RegistryEntry {
  meta: ServerMeta
  provider: PowerProvider
}

export type Registry = Map<string, RegistryEntry>

function createProvider(server: ServerConfig, fetchFn: typeof fetch): PowerProvider {
  switch (server.type) {
    case 'proxmox-lxc':
    case 'proxmox-vm':
      return createProxmoxProvider(
        {
          url: server.url,
          tokenId: server.tokenId,
          tokenSecret: server.tokenSecret,
          node: server.node,
          vmid: server.vmid,
          kind: server.type === 'proxmox-vm' ? 'qemu' : 'lxc',
        },
        fetchFn,
      )
    case 'docker':
      return createDockerProvider(
        { host: server.host, container: server.container },
        fetchFn,
      )
  }
}

export function buildRegistry(
  config: AppConfig,
  fetchFn: typeof fetch = fetch,
): Registry {
  const registry: Registry = new Map()
  for (const server of config.servers) {
    const meta: ServerMeta = { id: server.id, name: server.name, type: server.type }
    if (server.game !== undefined) meta.game = server.game
    registry.set(server.id, { meta, provider: createProvider(server, fetchFn) })
  }
  return registry
}
