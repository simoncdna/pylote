import { parse } from 'yaml'
import type { BackendType } from '../shared/types.ts'

export interface ServerBase {
  id: string
  name: string
  game?: string
}

export interface ProxmoxServerConfig extends ServerBase {
  type: 'proxmox-lxc' | 'proxmox-vm'
  url: string
  tokenId: string
  tokenSecret: string
  node: string
  vmid: string
}

export interface DockerServerConfig extends ServerBase {
  type: 'docker'
  host: string
  container: string
}

export type ServerConfig = ProxmoxServerConfig | DockerServerConfig

export interface AppConfig {
  port: number
  servers: ServerConfig[]
}

/** Boot-time configuration problem: message is user-facing, process should exit. */
export class ConfigError extends Error {}

type Env = Record<string, string | undefined>

const PROXMOX_FIELDS = ['url', 'tokenId', 'tokenSecret', 'node', 'vmid'] as const
const DOCKER_FIELDS = ['host', 'container'] as const
const TYPES = ['proxmox-lxc', 'proxmox-vm', 'docker'] as const

function interpolate(
  value: string,
  env: Env,
  where: string,
  errors: string[],
): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const v = env[name]
    if (v === undefined) {
      errors.push(`${where}: environment variable ${name} is not set`)
      return ''
    }
    return v
  })
}

export function parseConfig(yamlText: string, env: Env): AppConfig {
  let raw: unknown
  try {
    raw = parse(yamlText)
  } catch (e) {
    throw new ConfigError(`pylote.yaml is not valid YAML: ${(e as Error).message}`)
  }

  const errors: string[] = []
  const root = (raw ?? {}) as Record<string, unknown>

  const port = root.port === undefined ? 3000 : Number(root.port)
  if (!Number.isInteger(port) || port <= 0) errors.push('port must be a positive integer')

  const servers: ServerConfig[] = []
  const rawServers = root.servers
  if (!Array.isArray(rawServers) || rawServers.length === 0) {
    errors.push('servers must be a non-empty list')
  } else {
    const seen = new Set<string>()
    rawServers.forEach((entry, i) => {
      const where = `servers[${i}]`
      const s = (entry ?? {}) as Record<string, unknown>

      const id = typeof s.id === 'string' ? s.id : ''
      if (!id) errors.push(`${where}.id missing`)
      else if (seen.has(id)) errors.push(`${where}.id "${id}" is duplicated`)
      seen.add(id)

      if (typeof s.name !== 'string' || !s.name) errors.push(`${where}.name missing`)

      const type = s.type as BackendType
      if (!(TYPES as readonly string[]).includes(type)) {
        errors.push(`${where}.type must be one of: ${TYPES.join(', ')}`)
        return
      }

      const out: Record<string, unknown> = { id, name: s.name, type }
      if (s.game !== undefined) out.game = String(s.game)
      const fields = type === 'docker' ? DOCKER_FIELDS : PROXMOX_FIELDS
      for (const f of fields) {
        const v = s[f]
        if (v === undefined || v === '') {
          errors.push(`${where}.${f} missing`)
          continue
        }
        // String(v): yaml turns bare vmid/ports into numbers — normalize back.
        out[f] = interpolate(String(v), env, `${where}.${f}`, errors)
      }
      servers.push(out as unknown as ServerConfig)
    })
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid pylote.yaml:\n- ${errors.join('\n- ')}`)
  }
  return { port, servers }
}

export async function loadConfigFile(path: string, env: Env): Promise<AppConfig> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new ConfigError(
      `Config file not found: ${path}\n` +
        `Create a pylote.yaml (or point PYLOTE_CONFIG at one). Minimal example:\n\n` +
        `servers:\n` +
        `  - id: my-server\n` +
        `    name: My Server\n` +
        `    type: proxmox-lxc\n` +
        `    url: https://proxmox.local:8006\n` +
        `    tokenId: \${PROXMOX_TOKEN_ID}\n` +
        `    tokenSecret: \${PROXMOX_TOKEN_SECRET}\n` +
        `    node: pve\n` +
        `    vmid: 105\n`,
    )
  }
  return parseConfig(await file.text(), env)
}

// ---- legacy single-server env config (removed once app.ts is switched) ----

export interface Config {
  proxmoxUrl: string
  tokenId: string
  tokenSecret: string
  node: string
  vmid: string
  port: number
}

export function loadConfig(env: Env): Config {
  const required = {
    PROXMOX_URL: env.PROXMOX_URL,
    PROXMOX_TOKEN_ID: env.PROXMOX_TOKEN_ID,
    PROXMOX_TOKEN_SECRET: env.PROXMOX_TOKEN_SECRET,
    PROXMOX_NODE: env.PROXMOX_NODE,
    LXC_VMID: env.LXC_VMID,
  }

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  return {
    proxmoxUrl: required.PROXMOX_URL!.replace(/\/$/, ''),
    tokenId: required.PROXMOX_TOKEN_ID!,
    tokenSecret: required.PROXMOX_TOKEN_SECRET!,
    node: required.PROXMOX_NODE!,
    vmid: required.LXC_VMID!,
    port: env.PORT ? Number(env.PORT) : 3000,
  }
}
