# Multi-Server / Multi-Backend Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hard-coded Proxmox LXC with a `pylote.yaml`-driven registry of servers (proxmox-lxc / proxmox-vm / docker), a `/api/servers` API, and a card-based dashboard.

**Architecture:** A `PowerProvider` interface (`status/start/stop`) implemented per backend. `pylote.yaml` is parsed and validated at boot into an `AppConfig`, then turned into a `Map<id, {meta, provider}>` registry consumed by the Hono API. The client polls `GET /api/servers` and renders one card per server (full-page layout kept when exactly one server is configured). Legacy single-server code is kept compiling until the switch, then deleted in a cleanup task so every commit stays green.

**Tech Stack:** Bun 1.2, Hono, React 18, Vite, `yaml` (new dependency), `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-28-multi-server-providers-design.md`

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `BackendType`, `ServerSummary` shared client/server |
| `src/server/providers/types.ts` | create | `PowerProvider` interface |
| `src/server/providers/proxmox.ts` | create | Proxmox LXC + VM provider (options-based, no config dependency) |
| `src/server/providers/docker.ts` | create | Docker Engine API provider (unix socket or tcp) |
| `src/server/config.ts` | rewrite | `pylote.yaml` parse + validation + `${ENV}` interpolation |
| `src/server/registry.ts` | create | `AppConfig` → `Map<id, {meta, provider}>` |
| `src/server/app.ts` | rewrite | `/api/servers` list + `/api/servers/:id/start\|stop` |
| `src/server/index.ts` | rewrite | boot: load yaml, build registry, exit(1) on ConfigError |
| `src/server/proxmox.ts` | delete (Task 9) | superseded by `providers/proxmox.ts` |
| `src/client/api.ts` | rewrite | `listServers/start(id)/stop(id)` |
| `src/client/useServers.ts` | create | poll list + per-server pending/toggle logic |
| `src/client/useServerStatus.ts` | delete (Task 8) | superseded by `useServers.ts` |
| `src/client/components/ServerCard.tsx` | create | one dashboard card |
| `src/client/App.tsx` | modify | cards grid vs single-server full page |
| `src/client/styles.css` | modify | card grid styles |
| `pylote.yaml.example`, `.env.example`, `README.md` | modify/create | config docs |

Note: `bun test` only compiles files imported by tests, so intermediate tasks stay green; `bun run typecheck` is only expected to pass at Tasks 1–7 boundaries where noted, and always from Task 8 on.

---

### Task 1: Shared types + provider interface

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/server/providers/types.ts`

- [ ] **Step 1: Extend shared types (additive — keep `StatusResponse` until Task 9)**

`src/shared/types.ts` becomes:

```ts
/** Real power state of a server as reported by its backend. */
export type ServerState = 'running' | 'stopped' | 'unknown'

export type BackendType = 'proxmox-lxc' | 'proxmox-vm' | 'docker'

/** One server as returned by GET /api/servers. */
export interface ServerSummary {
  id: string
  name: string
  game?: string
  type: BackendType
  state: ServerState
}

/** Legacy single-server response — removed in the cleanup task. */
export interface StatusResponse {
  state: ServerState
}

export interface ActionResponse {
  ok: true
}

export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 2: Create the provider interface**

`src/server/providers/types.ts`:

```ts
import type { ServerState } from '../../shared/types.ts'

/** What every backend must implement to appear on the dashboard. */
export interface PowerProvider {
  status(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}
```

- [ ] **Step 3: Verify**

Run: `bun test && bun run typecheck`
Expected: all existing tests PASS, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/server/providers/types.ts
git commit -m "feat: shared ServerSummary types and PowerProvider interface"
```

---

### Task 2: Proxmox provider (lxc + qemu)

**Files:**
- Create: `src/server/providers/proxmox.ts`
- Test: `tests/server/providers/proxmox.test.ts`

The existing `src/server/proxmox.ts` stays untouched until Task 9 — this new module is options-based (no dependency on `config.ts`), and adds `qemu` support.

- [ ] **Step 1: Write the failing tests**

`tests/server/providers/proxmox.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/providers/proxmox.test.ts`
Expected: FAIL — cannot resolve `src/server/providers/proxmox.ts`.

- [ ] **Step 3: Implement the provider**

`src/server/providers/proxmox.ts`:

```ts
import type { PowerProvider } from './types.ts'

export interface ProxmoxOptions {
  url: string
  tokenId: string
  tokenSecret: string
  node: string
  vmid: string
  /** Proxmox API path segment: LXC container vs QEMU virtual machine. */
  kind: 'lxc' | 'qemu'
}

export function createProxmoxProvider(
  opts: ProxmoxOptions,
  fetchFn: typeof fetch = fetch,
): PowerProvider {
  const base = `${opts.url.replace(/\/$/, '')}/api2/json/nodes/${opts.node}/${opts.kind}/${opts.vmid}`
  const headers = {
    Authorization: `PVEAPIToken=${opts.tokenId}=${opts.tokenSecret}`,
  }
  // Proxmox typically uses a self-signed cert; accept it (server-side only).
  const tls = { rejectUnauthorized: false }

  async function call(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers,
      // Bun-specific fetch option for self-signed certs (typed via bun-types).
      tls,
    })
    if (!res.ok) {
      throw new Error(`Proxmox ${method} ${path} failed: ${res.status}`)
    }
    return res.json()
  }

  return {
    async status() {
      const body = (await call('/status/current', 'GET')) as {
        data?: { status?: string }
      }
      const status = body.data?.status
      if (status === 'running') return 'running'
      if (status === 'stopped') return 'stopped'
      return 'unknown'
    },
    async start() {
      await call('/status/start', 'POST')
    },
    async stop() {
      await call('/status/shutdown', 'POST')
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/providers/proxmox.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/proxmox.ts tests/server/providers/proxmox.test.ts
git commit -m "feat: options-based Proxmox provider with lxc and qemu support"
```

---

### Task 3: Docker provider

**Files:**
- Create: `src/server/providers/docker.ts`
- Test: `tests/server/providers/docker.test.ts`

Talks to the Docker Engine API. `host` is either `unix:///var/run/docker.sock` (Bun fetch routes over the socket via its non-standard `unix` init option) or `tcp://host:2375`.

- [ ] **Step 1: Write the failing tests**

`tests/server/providers/docker.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/providers/docker.test.ts`
Expected: FAIL — cannot resolve `src/server/providers/docker.ts`.

- [ ] **Step 3: Implement the provider**

`src/server/providers/docker.ts`:

```ts
import type { PowerProvider } from './types.ts'
import type { ServerState } from '../../shared/types.ts'

export interface DockerOptions {
  /** `unix:///var/run/docker.sock` or `tcp://host:2375`. */
  host: string
  /** Container name or id. */
  container: string
}

function mapStatus(status: string | undefined): ServerState {
  if (status === 'running') return 'running'
  if (status === 'exited' || status === 'created') return 'stopped'
  return 'unknown'
}

export function createDockerProvider(
  opts: DockerOptions,
  fetchFn: typeof fetch = fetch,
): PowerProvider {
  const unix = opts.host.startsWith('unix://')
    ? opts.host.slice('unix://'.length)
    : undefined
  const base = unix
    ? 'http://localhost'
    : opts.host.replace(/^tcp:\/\//, 'http://').replace(/\/$/, '')
  const name = encodeURIComponent(opts.container)

  async function call(path: string, method: 'GET' | 'POST'): Promise<Response> {
    // `unix` is a Bun-specific fetch option: route the request over a socket.
    const init = { method, ...(unix ? { unix } : {}) } as RequestInit
    const res = await fetchFn(`${base}${path}`, init)
    // 304 = container already in the requested state — that's success.
    if (!res.ok && res.status !== 304) {
      throw new Error(`Docker ${method} ${path} failed: ${res.status}`)
    }
    return res
  }

  return {
    async status() {
      const res = await call(`/containers/${name}/json`, 'GET')
      const body = (await res.json()) as { State?: { Status?: string } }
      return mapStatus(body.State?.Status)
    },
    async start() {
      await call(`/containers/${name}/start`, 'POST')
    },
    async stop() {
      await call(`/containers/${name}/stop`, 'POST')
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/providers/docker.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/docker.ts tests/server/providers/docker.test.ts
git commit -m "feat: Docker provider over unix socket or tcp"
```

---

### Task 4: `pylote.yaml` config loading

**Files:**
- Modify: `src/server/config.ts` (add new API, keep legacy `Config`/`loadConfig` until Task 9)
- Modify: `package.json` (new dependency)
- Test: `tests/server/config.test.ts` (append new tests, keep legacy ones until Task 9)

- [ ] **Step 1: Add the yaml dependency**

Run: `bun add yaml`
Expected: `yaml` appears in `package.json` dependencies, lockfile updated.

- [ ] **Step 2: Write the failing tests**

Append to `tests/server/config.test.ts`:

```ts
import { parseConfig, loadConfigFile, ConfigError } from '../../src/server/config.ts'

const VALID_YAML = `
port: 4000
servers:
  - id: enshrouded
    name: Enshrouded
    game: enshrouded
    type: proxmox-lxc
    url: https://haven.local:8006
    tokenId: \${TOKEN_ID}
    tokenSecret: \${TOKEN_SECRET}
    node: haven
    vmid: 103
  - id: valheim
    name: Valheim
    type: docker
    host: unix:///var/run/docker.sock
    container: valheim-server
`

const ENV = { TOKEN_ID: 'pylote@pve!toggle', TOKEN_SECRET: 'secret' }

test('parseConfig parses servers and interpolates env vars', () => {
  const cfg = parseConfig(VALID_YAML, ENV)
  expect(cfg.port).toBe(4000)
  expect(cfg.servers).toHaveLength(2)
  const [px, dk] = cfg.servers
  expect(px).toEqual({
    id: 'enshrouded',
    name: 'Enshrouded',
    game: 'enshrouded',
    type: 'proxmox-lxc',
    url: 'https://haven.local:8006',
    tokenId: 'pylote@pve!toggle',
    tokenSecret: 'secret',
    node: 'haven',
    vmid: '103',
  })
  expect(dk).toEqual({
    id: 'valheim',
    name: 'Valheim',
    type: 'docker',
    host: 'unix:///var/run/docker.sock',
    container: 'valheim-server',
  })
})

test('parseConfig defaults port to 3000', () => {
  const cfg = parseConfig(
    'servers:\n  - {id: a, name: A, type: docker, host: tcp://h:2375, container: c}\n',
    {},
  )
  expect(cfg.port).toBe(3000)
})

test('parseConfig reports a missing env var with its name and location', () => {
  expect(() => parseConfig(VALID_YAML, { TOKEN_ID: 'x' })).toThrow(
    /servers\[0\]\.tokenSecret.*TOKEN_SECRET/,
  )
})

test('parseConfig rejects unknown type', () => {
  expect(() =>
    parseConfig('servers:\n  - {id: a, name: A, type: kubernetes}\n', {}),
  ).toThrow(/servers\[0\]\.type/)
})

test('parseConfig rejects duplicate ids', () => {
  const yaml = `
servers:
  - {id: a, name: A, type: docker, host: tcp://h:2375, container: c}
  - {id: a, name: B, type: docker, host: tcp://h:2375, container: d}
`
  expect(() => parseConfig(yaml, {})).toThrow(/servers\[1\]\.id.*duplicated/)
})

test('parseConfig lists every missing type-specific field', () => {
  expect(() => parseConfig('servers:\n  - {id: a, name: A, type: docker}\n', {}))
    .toThrow(/servers\[0\]\.host[\s\S]*servers\[0\]\.container/)
})

test('parseConfig rejects an empty server list and invalid yaml', () => {
  expect(() => parseConfig('servers: []', {})).toThrow(/non-empty/)
  expect(() => parseConfig('servers: [!!', {})).toThrow(ConfigError)
})

test('loadConfigFile explains a missing file with an example', async () => {
  await expect(loadConfigFile('/nonexistent/pylote.yaml', {})).rejects.toThrow(
    /Config file not found[\s\S]*servers:/,
  )
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/server/config.test.ts`
Expected: legacy tests PASS, new tests FAIL (`parseConfig` not exported).

- [ ] **Step 4: Implement**

Add to `src/server/config.ts` **above** the existing legacy code (keep `Config` and `loadConfig` untouched at the bottom of the file, under a `// ---- legacy single-server env config (removed once app.ts is switched) ----` divider):

```ts
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
      if (!TYPES.includes(type)) {
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/server/config.test.ts && bun run typecheck`
Expected: all PASS (legacy + new), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/server/config.ts tests/server/config.test.ts
git commit -m "feat: pylote.yaml config parsing with env interpolation and validation"
```

---

### Task 5: Registry

**Files:**
- Create: `src/server/registry.ts`
- Test: `tests/server/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/server/registry.test.ts`:

```ts
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
  await buildRegistry(config, fn).get('win')!.provider.status()
  expect(calls[0]).toContain('/qemu/200/')
})

test('docker entries talk to the Docker engine', async () => {
  const { fn, calls } = fakeFetch()
  await buildRegistry(config, fn).get('valheim')!.provider.status()
  expect(calls[0]).toBe('http://vps:2375/containers/valheim-server/json')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/registry.test.ts`
Expected: FAIL — cannot resolve `src/server/registry.ts`.

- [ ] **Step 3: Implement**

`src/server/registry.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/server/registry.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/registry.ts tests/server/registry.test.ts
git commit -m "feat: registry building providers from parsed config"
```

---

### Task 6: New API (`/api/servers`) + boot wiring

**Files:**
- Rewrite: `src/server/app.ts`
- Rewrite: `src/server/index.ts`
- Rewrite: `tests/server/app.test.ts`

- [ ] **Step 1: Rewrite the app tests (failing)**

`tests/server/app.test.ts` becomes:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/server/app.test.ts`
Expected: FAIL — `createApp` still expects `{ proxmox }`.

- [ ] **Step 3: Rewrite `src/server/app.ts`**

```ts
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Registry } from './registry.ts'
import type {
  ServerSummary,
  ServerState,
  ActionResponse,
  ErrorResponse,
} from '../shared/types.ts'

export interface AppDeps {
  registry: Registry
}

export function createApp({ registry }: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/servers', async (c) => {
    const summaries: ServerSummary[] = await Promise.all(
      [...registry.values()].map(async ({ meta, provider }) => {
        let state: ServerState = 'unknown'
        try {
          state = await provider.status()
        } catch {
          // Unreachable backend → unknown for this card, never a global 500.
        }
        return { ...meta, state }
      }),
    )
    return c.json(summaries)
  })

  function action(kind: 'start' | 'stop') {
    return async (c: Context) => {
      const entry = registry.get(c.req.param('id'))
      if (!entry) return c.json<ErrorResponse>({ error: 'Unknown server' }, 404)
      try {
        await entry.provider[kind]()
        return c.json<ActionResponse>({ ok: true })
      } catch {
        return c.json<ErrorResponse>(
          { error: `${entry.meta.name}: backend unreachable` },
          502,
        )
      }
    }
  }

  app.post('/api/servers/:id/start', action('start'))
  app.post('/api/servers/:id/stop', action('stop'))

  return app
}
```

- [ ] **Step 4: Rewrite `src/server/index.ts`**

```ts
// src/server/index.ts
import { serveStatic } from 'hono/bun'
import { loadConfigFile, ConfigError, type AppConfig } from './config.ts'
import { buildRegistry } from './registry.ts'
import { createApp } from './app.ts'

let config: AppConfig
try {
  config = await loadConfigFile(process.env.PYLOTE_CONFIG ?? './pylote.yaml', process.env)
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}

const registry = buildRegistry(config)
const app = createApp({ registry })

// Serve the built PWA. API routes are already registered (they win over static).
const CLIENT_DIR = './dist/client'
app.use('/*', serveStatic({ root: CLIENT_DIR }))
// SPA fallback: any unmatched GET returns index.html.
app.get('/*', serveStatic({ path: `${CLIENT_DIR}/index.html` }))

console.log(
  `Pylote listening on http://0.0.0.0:${config.port} — ${config.servers.length} server(s) configured`,
)

export default {
  port: config.port,
  fetch: app.fetch,
}
```

- [ ] **Step 5: Verify tests + boot errors**

Run: `bun test`
Expected: all PASS.

Run: `PYLOTE_CONFIG=/nonexistent.yaml bun run src/server/index.ts; echo "exit=$?"`
Expected: prints "Config file not found…" with the example, `exit=1`.

Note: `bun run typecheck` fails here (old `src/server/proxmox.ts` still imports the legacy `Config` — fine, it is deleted in Task 9; the legacy `Config` export is still present so it actually still compiles — if typecheck IS clean, all the better).

- [ ] **Step 6: Commit**

```bash
git add src/server/app.ts src/server/index.ts tests/server/app.test.ts
git commit -m "feat: /api/servers list and per-server start/stop routes"
```

---

### Task 7: Client API

**Files:**
- Rewrite: `src/client/api.ts`
- Rewrite: `tests/client/api.test.ts`

- [ ] **Step 1: Rewrite the client api tests (failing)**

`tests/client/api.test.ts` becomes:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/api.test.ts`
Expected: FAIL — `listServers` does not exist.

- [ ] **Step 3: Rewrite `src/client/api.ts`**

```ts
import type { ServerSummary } from '../shared/types.ts'

export interface ApiClient {
  listServers(): Promise<ServerSummary[]>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
}

export function createApiClient(fetchFn: typeof fetch = fetch): ApiClient {
  async function req(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(path, { method })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }

  return {
    async listServers() {
      return (await req('/api/servers', 'GET')) as ServerSummary[]
    },
    async start(id: string) {
      await req(`/api/servers/${encodeURIComponent(id)}/start`, 'POST')
    },
    async stop(id: string) {
      await req(`/api/servers/${encodeURIComponent(id)}/stop`, 'POST')
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test`
Expected: all PASS. (`bun run typecheck` is broken until Task 8 replaces `useServerStatus.ts` — expected.)

- [ ] **Step 5: Commit**

```bash
git add src/client/api.ts tests/client/api.test.ts
git commit -m "feat: client api for the multi-server endpoints"
```

---

### Task 8: Client UI — `useServers`, cards, single-server layout

**Files:**
- Create: `src/client/useServers.ts`
- Create: `src/client/components/ServerCard.tsx`
- Rewrite: `src/client/App.tsx`
- Modify: `src/client/styles.css` (append)
- Delete: `src/client/useServerStatus.ts`

`deriveUiState` in `src/client/state.ts` is unchanged (a server with `state: 'unknown'` renders as `error` — exactly what we want for an unreachable backend). The pending/transition logic moves from the old single-server hook into `useServers`, keyed by server id.

- [ ] **Step 1: Create `src/client/useServers.ts`**

```ts
// src/client/useServers.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerState, ServerSummary } from '../shared/types.ts'
import type { ApiClient } from './api.ts'

const POLL_MS = 5000
// Start/stop are async on the backends (Proxmox queues a task, Docker stop
// waits for the process): keep the server "pending" until the target state is
// actually reached so the loading animation covers the whole transition.
const TRANSITION_POLL_MS = 2000
const TRANSITION_TIMEOUT_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Which direction a toggle is heading while pending. */
export type PendingAction = 'start' | 'stop'

export interface ServerView extends ServerSummary {
  busy: boolean
  error: boolean
  pendingAction: PendingAction | null
  toggle: () => void
}

export interface ServersStatus {
  servers: ServerView[]
  /** True once the first /api/servers response (or failure) arrived. */
  loaded: boolean
  /** True when the list itself cannot be fetched (Pylote backend down). */
  listError: boolean
}

export function useServers(api: ApiClient): ServersStatus {
  const [list, setList] = useState<ServerSummary[]>([])
  const [loaded, setLoaded] = useState(false)
  const [listError, setListError] = useState(false)
  const [pending, setPending] = useState<Record<string, PendingAction>>({})
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  const refresh = useCallback(async () => {
    try {
      setList(await api.listServers())
      setListError(false)
    } catch {
      setListError(true)
    } finally {
      setLoaded(true)
    }
  }, [api])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const toggle = useCallback(
    async (id: string, state: ServerState) => {
      if (pendingRef.current[id]) return
      const action: PendingAction = state === 'running' ? 'stop' : 'start'
      const target: ServerState = action === 'stop' ? 'stopped' : 'running'
      setPending((p) => ({ ...p, [id]: action }))
      setErrors((e) => ({ ...e, [id]: false }))
      try {
        if (action === 'stop') await api.stop(id)
        else await api.start(id)

        const deadline = Date.now() + TRANSITION_TIMEOUT_MS
        while (Date.now() < deadline) {
          await sleep(TRANSITION_POLL_MS)
          try {
            const servers = await api.listServers()
            setList(servers)
            if (servers.find((s) => s.id === id)?.state === target) break
          } catch {
            // Transient failure mid-transition: keep waiting.
          }
        }
      } catch {
        setErrors((e) => ({ ...e, [id]: true }))
      } finally {
        setPending((p) => {
          const { [id]: _drop, ...rest } = p
          return rest
        })
      }
    },
    [api],
  )

  const servers: ServerView[] = list.map((s) => ({
    ...s,
    busy: Boolean(pending[s.id]),
    error: Boolean(errors[s.id]),
    pendingAction: pending[s.id] ?? null,
    toggle: () => toggle(s.id, s.state),
  }))

  return { servers, loaded, listError }
}
```

- [ ] **Step 2: Update the `PendingAction` import in `StatusBadge.tsx`**

In `src/client/components/StatusBadge.tsx`, change:

```ts
import type { PendingAction } from '../useServerStatus.ts'
```

to:

```ts
import type { PendingAction } from '../useServers.ts'
```

- [ ] **Step 3: Create `src/client/components/ServerCard.tsx`**

```tsx
// src/client/components/ServerCard.tsx
import type { CSSProperties } from 'react'
import type { ServerView } from '../useServers.ts'
import { deriveUiState } from '../state.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { ToggleButton } from './ToggleButton.tsx'

const GAME_ACCENTS: Record<string, string> = {
  enshrouded: '#4da6ff',
  valheim: '#e05545',
  minecraft: '#5bbf3f',
}
const DEFAULT_ACCENT = '#8a93a6'

export function ServerCard({ server }: { server: ServerView }) {
  const ui = deriveUiState({
    state: server.state,
    busy: server.busy,
    error: server.error,
  })
  const accent = GAME_ACCENTS[server.game ?? ''] ?? DEFAULT_ACCENT
  return (
    <article className="card" style={{ '--accent': accent } as CSSProperties}>
      <header className="card-head">
        <span className="card-name">{server.name}</span>
        {server.game && <span className="card-game">{server.game}</span>}
      </header>
      <StatusBadge ui={ui} pendingAction={server.pendingAction} />
      <div className="card-toggle">
        <ToggleButton ui={ui} onToggle={server.toggle} />
      </div>
      <span className="err-msg">{ui === 'error' ? 'Backend unreachable' : ''}</span>
    </article>
  )
}
```

- [ ] **Step 4: Rewrite `src/client/App.tsx`**

```tsx
// src/client/App.tsx
import { useMemo } from 'react'
import { createApiClient } from './api.ts'
import { useServers, type ServerView } from './useServers.ts'
import { deriveUiState } from './state.ts'
import { StatusBadge } from './components/StatusBadge.tsx'
import { ToggleButton } from './components/ToggleButton.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'
import { Embers } from './components/Embers.tsx'
import { ServerCard } from './components/ServerCard.tsx'
import { useTheme } from './useTheme.ts'

export function App() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      <Dashboard />
    </>
  )
}

function Dashboard() {
  const api = useMemo(() => createApiClient(), [])
  const { servers, loaded, listError } = useServers(api)
  const anyOn = servers.some((s) => !s.busy && !s.error && s.state === 'running')

  return (
    <main className="screen">
      <Embers active={anyOn} />
      <header className="header">
        <h1 className="brand">Pylote</h1>
        <p className="sub">Server control</p>
      </header>
      {!loaded ? null : listError ? (
        <section className="center">
          <span className="err-msg">Pylote backend unreachable</span>
        </section>
      ) : servers.length === 1 ? (
        <SingleServer server={servers[0]} />
      ) : (
        <section className="cards">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </section>
      )}
    </main>
  )
}

/** The original full-page layout, kept when exactly one server is configured. */
function SingleServer({ server }: { server: ServerView }) {
  const ui = deriveUiState({
    state: server.state,
    busy: server.busy,
    error: server.error,
  })
  return (
    <section className="center">
      <StatusBadge ui={ui} pendingAction={server.pendingAction} />
      <ToggleButton ui={ui} onToggle={server.toggle} />
      <span className="name">{server.name}</span>
      {/* Always rendered so its reserved height keeps the block from shifting
          when the error line appears/disappears. */}
      <span className="err-msg">{ui === 'error' ? 'Backend unreachable' : ''}</span>
    </section>
  )
}
```

- [ ] **Step 5: Delete the old hook and append card styles**

```bash
rm src/client/useServerStatus.ts
```

Append to `src/client/styles.css` (reuse existing CSS variables from the top of the file if names differ — the card must follow the theme):

```css
/* ---- multi-server cards ---- */
.cards {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
  width: min(720px, 100%);
  margin: 0 auto;
  padding: 8px 20px 40px;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 12px 8px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.card-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.card-name {
  font-weight: 600;
}

.card-game {
  font-size: 0.75rem;
  opacity: 0.7;
  text-transform: capitalize;
}

/* Shrink the living power button to card scale. */
.card-toggle {
  transform: scale(0.68);
  transform-origin: center;
  margin: -14px 0;
}
```

- [ ] **Step 6: Verify**

Run: `bun test && bun run typecheck`
Expected: all PASS, typecheck clean (nothing references `useServerStatus.ts` anymore).

Manual check: create a local `pylote.yaml` with two docker entries pointing at a bogus host, run `bun run dev`, open `http://localhost:5173`:
- two cards render, state settles to error ("Backend unreachable") without layout shift,
- with a single server in the yaml, the original full-page layout renders.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client
git commit -m "feat: card dashboard with per-server pending, single-server layout kept"
```

---

### Task 9: Delete legacy code

**Files:**
- Delete: `src/server/proxmox.ts`, `tests/server/proxmox.test.ts`
- Modify: `src/server/config.ts` (remove legacy `Config` + `loadConfig`)
- Modify: `tests/server/config.test.ts` (remove legacy tests)
- Modify: `src/shared/types.ts` (remove `StatusResponse`)

- [ ] **Step 1: Delete legacy files and code**

```bash
rm src/server/proxmox.ts tests/server/proxmox.test.ts
```

In `src/server/config.ts`: delete everything below the `// ---- legacy single-server env config` divider (the `Config` interface and `loadConfig` function).

In `tests/server/config.test.ts`: delete the legacy `loadConfig` import, the `full` fixture, and the three `loadConfig` tests (`returns typed config`, `defaults PORT`, `throws listing every missing`).

In `src/shared/types.ts`: delete the `StatusResponse` interface and its comment.

- [ ] **Step 2: Verify nothing references the deleted symbols**

Run: `grep -rn "loadConfig\b\|StatusResponse\|server/proxmox" src tests --include='*.ts' --include='*.tsx' | grep -v loadConfigFile`
Expected: no output.

Run: `bun test && bun run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: drop legacy single-server config and proxmox client"
```

---

### Task 10: Example config, env, README, final verification

**Files:**
- Create: `pylote.yaml.example`
- Rewrite: `.env.example`
- Modify: `README.md`
- Modify: `Dockerfile`

- [ ] **Step 1: Create `pylote.yaml.example`**

```yaml
# Pylote configuration — every server you want on the dashboard.
# ${VARS} are read from the environment (put secrets in .env).

port: 3000

servers:
  # A Proxmox LXC container
  - id: enshrouded
    name: Enshrouded
    game: enshrouded          # optional — colors the card
    type: proxmox-lxc
    url: https://proxmox.local:8006
    tokenId: ${PROXMOX_TOKEN_ID}
    tokenSecret: ${PROXMOX_TOKEN_SECRET}
    node: pve
    vmid: 105

  # A Proxmox virtual machine
  # - id: windows
  #   name: Windows VM
  #   type: proxmox-vm
  #   url: https://proxmox.local:8006
  #   tokenId: ${PROXMOX_TOKEN_ID}
  #   tokenSecret: ${PROXMOX_TOKEN_SECRET}
  #   node: pve
  #   vmid: 200

  # A Docker container — local socket or remote host
  # - id: valheim
  #   name: Valheim
  #   game: valheim
  #   type: docker
  #   host: unix:///var/run/docker.sock   # or tcp://my-vps:2375
  #   container: valheim-server
```

- [ ] **Step 2: Rewrite `.env.example`**

```bash
# Secrets referenced from pylote.yaml via ${...}
PROXMOX_TOKEN_ID=pylote@pve!toggle
PROXMOX_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Optional: path to the config file (default: ./pylote.yaml)
# PYLOTE_CONFIG=/config/pylote.yaml
```

- [ ] **Step 3: Update `README.md`**

Replace the `## Configure` section with:

```markdown
## Configure

Copy `pylote.yaml.example` to `pylote.yaml` and declare your servers — any mix
of Proxmox LXC containers (`proxmox-lxc`), Proxmox VMs (`proxmox-vm`) and
Docker containers (`docker`). Secrets stay out of the yaml: write `${MY_VAR}`
and provide it via the environment (`.env`, `--env-file`, …).

`PYLOTE_CONFIG` overrides the config path (default `./pylote.yaml`).

### Proxmox backends (`proxmox-lxc`, `proxmox-vm`)

Fields: `url`, `tokenId`, `tokenSecret`, `node`, `vmid`.

Create the API token:
1. Proxmox UI → **Datacenter → Permissions → API Tokens → Add**.
   Pick a user (e.g. `pylote@pve`) and a token name (e.g. `toggle`).
   Copy the **Token ID** (`pylote@pve!toggle`) and the **Secret** (shown once).
2. Give the token power rights: **Datacenter → Permissions → Add → API Token
   Permission**. Path `/vms/<VMID>` (or a pool), role with `VM.PowerMgmt` +
   `VM.Audit`.
3. The **VMID** and **node name** are shown next to the guest in the Proxmox
   tree (e.g. VMID `105`, node `pve`).

### Docker backend (`docker`)

Fields: `host` (`unix:///var/run/docker.sock` or `tcp://host:2375`) and
`container` (name or id). When Pylote runs in Docker itself, mount the socket:
`-v /var/run/docker.sock:/var/run/docker.sock`.
```

And update the Docker run command in `## Deploy`:

```markdown
docker build -t pylote .
docker run -d --env-file .env \
  -v $(pwd)/pylote.yaml:/app/pylote.yaml:ro \
  -p 3000:3000 --restart unless-stopped pylote
```

- [ ] **Step 4: Point the Dockerfile at the config location**

In `Dockerfile`, replace `ENV PORT=3000` with:

```dockerfile
ENV PYLOTE_CONFIG=/app/pylote.yaml
```

(The `port` now comes from the yaml; the env var only tells Pylote where the
mounted config lives.)

- [ ] **Step 5: Final verification**

Run: `bun test && bun run typecheck && bun run build`
Expected: all PASS, clean typecheck, successful Vite build.

Boot smoke test:

```bash
cp pylote.yaml.example /tmp/pylote-smoke.yaml
PROXMOX_TOKEN_ID=x PROXMOX_TOKEN_SECRET=y PYLOTE_CONFIG=/tmp/pylote-smoke.yaml bun run start &
sleep 1
curl -s http://localhost:3000/api/servers
kill %1
```

Expected: JSON array with one `enshrouded` entry, `state: "unknown"` (bogus Proxmox host — that's the graceful-degradation path working).

- [ ] **Step 6: Commit**

```bash
git add pylote.yaml.example .env.example README.md Dockerfile
git commit -m "docs: pylote.yaml example, env template, multi-backend README"
```

---

## Post-plan: deployment migration (not part of the PR)

Simon's own deployment (LXC 102 `apps` on node `haven`, controlling LXC 103): create on the host a `pylote.yaml` with the single Enshrouded entry (`type: proxmox-lxc`, `node: haven`, `vmid: 103`, token refs `${PROXMOX_TOKEN_ID}`/`${PROXMOX_TOKEN_SECRET}`), trim `.env` to the two token vars, and add the `-v .../pylote.yaml:/app/pylote.yaml:ro` mount to the `docker run` command.
