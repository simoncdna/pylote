# Pylote — Proxmox LXC Toggle PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-installable PWA that turns the Enshrouded Proxmox LXC on/off via the Proxmox API, served by a single Bun + Hono monolith.

**Architecture:** One Bun process. Hono serves the built React/Vite PWA (static files) *and* a small JSON API (`/api/status|start|stop|health`). The API delegates to a Proxmox client that calls the Proxmox REST API with an API token. The monolith runs in the always-on `app` LXC and controls a *different* LXC (Enshrouded). Auth is a shared secret sent in an `X-Auth-Token` header. Runtime config comes from environment variables.

**Tech Stack:** Bun (runtime, package manager, test runner), Hono (HTTP), React + Vite + `vite-plugin-pwa` (frontend), TypeScript everywhere.

---

## File Structure

```
pylote/
  package.json              # Bun scripts + deps
  tsconfig.json             # TS config (Bun + React)
  vite.config.ts            # Vite build, PWA plugin, dev proxy → server
  .env.example              # documents required env vars
  Dockerfile                # oven/bun image for the app LXC
  README.md                 # setup + Proxmox token/VMID guide
  src/
    shared/
      types.ts              # ServerState + API request/response types
    server/
      config.ts             # loadConfig(env) → validated Config
      proxmox.ts            # createProxmoxClient(config, fetchFn) → ProxmoxClient
      app.ts                # createApp({proxmox, authToken}) → Hono (API only)
      index.ts              # entry: wire config+proxmox+app, mount static, listen
    client/
      index.html            # Vite entry HTML
      main.tsx              # React root
      api.ts                # typed fetch wrapper (adds X-Auth-Token)
      useServerStatus.ts    # polling hook (5s) → UiState
      state.ts              # deriveUiState() pure logic (testable)
      App.tsx               # screen: SecretGate | main toggle screen
      components/
        StatusBadge.tsx
        ToggleButton.tsx
        SecretGate.tsx
      styles.css            # theme (dark + light), states
  tests/
    server/
      config.test.ts
      proxmox.test.ts
      app.test.ts
    client/
      state.test.ts
      api.test.ts
```

**Responsibilities:**
- `shared/types.ts` — single source of truth for types shared by client & server.
- `server/config.ts` — the *only* place that reads `process.env`; validates and fails fast.
- `server/proxmox.ts` — the *only* place that knows the Proxmox REST shape; `fetchFn` is injectable for tests.
- `server/app.ts` — HTTP routing, auth, error → status-code mapping; takes a `ProxmoxClient` (injected → testable, no real network).
- `server/index.ts` — composition root + static file serving + `Bun.serve`.
- Client files each own one concern; `state.ts` isolates pure logic so it's unit-testable without a DOM.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore` (already exists — verify), `src/shared/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pylote",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,client -c blue,magenta \"bun run dev:server\" \"bun run dev:client\"",
    "dev:server": "bun --watch src/server/index.ts",
    "dev:client": "vite",
    "build": "vite build",
    "start": "bun run src/server/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "bun-types": "^1.1.0",
    "concurrently": "^9.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.20.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["bun-types", "vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `src/shared/types.ts`**

```ts
/** Real power state of the LXC as reported by Proxmox. */
export type ServerState = 'running' | 'stopped' | 'unknown'

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

- [ ] **Step 4: Install dependencies**

Run: `bun install`
Expected: `node_modules/` created, `bun.lockb` written, no errors.

- [ ] **Step 5: Verify `.gitignore` covers build/secrets**

Confirm `.gitignore` contains `node_modules/`, `dist/`, `.env`, `.superpowers/`. (Created during brainstorming — add any missing lines.)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json bun.lockb src/shared/types.ts .gitignore
git commit -m "chore: scaffold Bun + TypeScript project"
```

---

## Task 2: Config loader (TDD)

**Files:**
- Create: `src/server/config.ts`
- Test: `tests/server/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/config.test.ts
import { test, expect } from 'bun:test'
import { loadConfig } from '../../src/server/config.ts'

const full = {
  PROXMOX_URL: 'https://pve.local:8006',
  PROXMOX_TOKEN_ID: 'pylote@pve!toggle',
  PROXMOX_TOKEN_SECRET: 'secret-uuid',
  PROXMOX_NODE: 'pve',
  LXC_VMID: '105',
  AUTH_TOKEN: 'shhh',
  PORT: '3000',
}

test('loadConfig returns typed config when all vars present', () => {
  const cfg = loadConfig(full)
  expect(cfg.proxmoxUrl).toBe('https://pve.local:8006')
  expect(cfg.vmid).toBe('105')
  expect(cfg.port).toBe(3000)
})

test('loadConfig defaults PORT to 3000 when absent', () => {
  const { PORT, ...noPort } = full
  expect(loadConfig(noPort).port).toBe(3000)
})

test('loadConfig throws listing every missing required var', () => {
  expect(() => loadConfig({})).toThrow(/PROXMOX_URL/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/config.test.ts`
Expected: FAIL — cannot find module `config.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/config.ts
export interface Config {
  proxmoxUrl: string
  tokenId: string
  tokenSecret: string
  node: string
  vmid: string
  authToken: string
  port: number
}

type Env = Record<string, string | undefined>

export function loadConfig(env: Env): Config {
  const required = {
    PROXMOX_URL: env.PROXMOX_URL,
    PROXMOX_TOKEN_ID: env.PROXMOX_TOKEN_ID,
    PROXMOX_TOKEN_SECRET: env.PROXMOX_TOKEN_SECRET,
    PROXMOX_NODE: env.PROXMOX_NODE,
    LXC_VMID: env.LXC_VMID,
    AUTH_TOKEN: env.AUTH_TOKEN,
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
    authToken: required.AUTH_TOKEN!,
    port: env.PORT ? Number(env.PORT) : 3000,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts tests/server/config.test.ts
git commit -m "feat: env config loader with validation"
```

---

## Task 3: Proxmox client (TDD)

**Files:**
- Create: `src/server/proxmox.ts`
- Test: `tests/server/proxmox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/proxmox.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/proxmox.test.ts`
Expected: FAIL — cannot find module `proxmox.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/proxmox.ts
import type { Config } from './config.ts'
import type { ServerState } from '../shared/types.ts'

export interface ProxmoxClient {
  getStatus(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}

export function createProxmoxClient(
  config: Config,
  fetchFn: typeof fetch = fetch,
): ProxmoxClient {
  const base = `${config.proxmoxUrl}/api2/json/nodes/${config.node}/lxc/${config.vmid}`
  const headers = {
    Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`,
  }
  // Proxmox typically uses a self-signed cert; accept it (server-side only).
  const tls = { rejectUnauthorized: false }

  async function call(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers,
      // @ts-expect-error Bun-specific fetch option for self-signed certs
      tls,
    })
    if (!res.ok) {
      throw new Error(`Proxmox ${method} ${path} failed: ${res.status}`)
    }
    return res.json()
  }

  return {
    async getStatus() {
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

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/proxmox.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/proxmox.ts tests/server/proxmox.test.ts
git commit -m "feat: Proxmox API client with injectable fetch"
```

---

## Task 4: HTTP app — routes, auth, errors (TDD)

**Files:**
- Create: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/app.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/server/app.test.ts`
Expected: FAIL — cannot find module `app.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/app.ts
import { Hono } from 'hono'
import type { ProxmoxClient } from './proxmox.ts'
import type {
  StatusResponse,
  ActionResponse,
  ErrorResponse,
} from '../shared/types.ts'

export interface AppDeps {
  proxmox: ProxmoxClient
  authToken: string
}

export function createApp({ proxmox, authToken }: AppDeps): Hono {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  // Shared-secret auth for every other /api route.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()
    if (c.req.header('X-Auth-Token') !== authToken) {
      return c.json<ErrorResponse>({ error: 'unauthorized' }, 401)
    }
    await next()
  })

  app.get('/api/status', async (c) => {
    try {
      const state = await proxmox.getStatus()
      return c.json<StatusResponse>({ state })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  app.post('/api/start', async (c) => {
    try {
      await proxmox.start()
      return c.json<ActionResponse>({ ok: true })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  app.post('/api/stop', async (c) => {
    try {
      await proxmox.stop()
      return c.json<ActionResponse>({ ok: true })
    } catch {
      return c.json<ErrorResponse>({ error: 'Proxmox unreachable' }, 502)
    }
  })

  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/server/app.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/server/app.test.ts
git commit -m "feat: HTTP API with shared-secret auth and error mapping"
```

---

## Task 5: Server entry — composition + static serving

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Write the entry**

```ts
// src/server/index.ts
import { serveStatic } from 'hono/bun'
import { loadConfig } from './config.ts'
import { createProxmoxClient } from './proxmox.ts'
import { createApp } from './app.ts'

const config = loadConfig(process.env)
const proxmox = createProxmoxClient(config)
const app = createApp({ proxmox, authToken: config.authToken })

// Serve the built PWA. API routes are already registered (they win over static).
const CLIENT_DIR = './dist/client'
app.use('/*', serveStatic({ root: CLIENT_DIR }))
// SPA fallback: any unmatched GET returns index.html.
app.get('/*', serveStatic({ path: `${CLIENT_DIR}/index.html` }))

console.log(`Pylote listening on http://0.0.0.0:${config.port}`)

export default {
  port: config.port,
  fetch: app.fetch,
}
```

- [ ] **Step 2: Verify it boots (with dummy env, no client build yet)**

Run:
```bash
PROXMOX_URL=https://pve.local:8006 PROXMOX_TOKEN_ID=x PROXMOX_TOKEN_SECRET=y \
PROXMOX_NODE=pve LXC_VMID=105 AUTH_TOKEN=z PORT=3000 \
bun run src/server/index.ts &
sleep 1
curl -s http://localhost:3000/api/health
kill %1
```
Expected: prints `{"ok":true}`.

- [ ] **Step 3: Verify missing env fails fast**

Run: `bun run src/server/index.ts`
Expected: exits with error `Missing required env vars: PROXMOX_URL, ...`.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: server entry wiring config, proxmox, static serving"
```

---

## Task 6: Frontend scaffolding — Vite + React + PWA

**Files:**
- Create: `vite.config.ts`, `src/client/index.html`, `src/client/main.tsx`, `.env.example`

- [ ] **Step 1: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    // In dev, forward API calls to the Bun server.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Pylote',
        short_name: 'Pylote',
        description: 'Server control',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
```

- [ ] **Step 2: Create `src/client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0d1117" />
    <title>Pylote</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/client/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Proxmox connection
PROXMOX_URL=https://192.168.1.10:8006
PROXMOX_TOKEN_ID=pylote@pve!toggle
PROXMOX_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PROXMOX_NODE=pve
LXC_VMID=105

# App
AUTH_TOKEN=choose-a-long-random-secret
PORT=3000
```

- [ ] **Step 5: Add placeholder PWA icons**

Add any 192×192 and 512×512 PNGs at `src/client/icon-192.png` and `src/client/icon-512.png` (can be simple solid-color placeholders for now; replace later). Vite copies files in the client root to the build output.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts src/client/index.html src/client/main.tsx .env.example src/client/icon-192.png src/client/icon-512.png
git commit -m "feat: frontend scaffold with Vite + React + PWA manifest"
```

---

## Task 7: UI state derivation (TDD)

The button/badge appearance is driven by a small state machine. Isolate the pure logic so it's testable without a DOM.

**Files:**
- Create: `src/client/state.ts`
- Test: `tests/client/state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/state.test.ts
import { test, expect } from 'bun:test'
import { deriveUiState } from '../../src/client/state.ts'

test('server running, not busy → on', () => {
  expect(deriveUiState({ state: 'running', busy: false, error: false })).toBe('on')
})

test('server stopped, not busy → off', () => {
  expect(deriveUiState({ state: 'stopped', busy: false, error: false })).toBe('off')
})

test('busy always → pending regardless of state', () => {
  expect(deriveUiState({ state: 'running', busy: true, error: false })).toBe('pending')
  expect(deriveUiState({ state: 'stopped', busy: true, error: false })).toBe('pending')
})

test('error (and not busy) → error', () => {
  expect(deriveUiState({ state: 'unknown', busy: false, error: true })).toBe('error')
})

test('unknown state without error → error (cannot trust display)', () => {
  expect(deriveUiState({ state: 'unknown', busy: false, error: false })).toBe('error')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/state.test.ts`
Expected: FAIL — cannot find module `state.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/client/state.ts
import type { ServerState } from '../shared/types.ts'

export type UiState = 'on' | 'off' | 'pending' | 'error'

export interface UiInputs {
  state: ServerState
  busy: boolean
  error: boolean
}

export function deriveUiState({ state, busy, error }: UiInputs): UiState {
  if (busy) return 'pending'
  if (error) return 'error'
  if (state === 'running') return 'on'
  if (state === 'stopped') return 'off'
  return 'error'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/state.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/state.ts tests/client/state.test.ts
git commit -m "feat: UI state derivation logic"
```

---

## Task 8: API client (TDD)

**Files:**
- Create: `src/client/api.ts`
- Test: `tests/client/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/api.test.ts
import { test, expect } from 'bun:test'
import { createApiClient } from '../../src/client/api.ts'

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { fn, calls }
}

test('getStatus sends X-Auth-Token and returns state', async () => {
  const { fn, calls } = fakeFetch(200, { state: 'running' })
  const api = createApiClient(() => 'my-secret', fn as unknown as typeof fetch)
  const state = await api.getStatus()
  expect(state).toBe('running')
  expect(calls[0].url).toBe('/api/status')
  expect(new Headers(calls[0].init?.headers).get('X-Auth-Token')).toBe('my-secret')
})

test('start POSTs to /api/start', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  const api = createApiClient(() => 's', fn as unknown as typeof fetch)
  await api.start()
  expect(calls[0].url).toBe('/api/start')
  expect(calls[0].init?.method).toBe('POST')
})

test('start POSTs to /api/stop for stop()', async () => {
  const { fn, calls } = fakeFetch(200, { ok: true })
  const api = createApiClient(() => 's', fn as unknown as typeof fetch)
  await api.stop()
  expect(calls[0].url).toBe('/api/stop')
})

test('401 throws an UnauthorizedError', async () => {
  const { fn } = fakeFetch(401, { error: 'unauthorized' })
  const api = createApiClient(() => 'bad', fn as unknown as typeof fetch)
  await expect(api.getStatus()).rejects.toThrow(/unauthorized/i)
})

test('502 throws a generic error', async () => {
  const { fn } = fakeFetch(502, { error: 'Proxmox unreachable' })
  const api = createApiClient(() => 's', fn as unknown as typeof fetch)
  await expect(api.getStatus()).rejects.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/api.test.ts`
Expected: FAIL — cannot find module `api.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/client/api.ts
import type { ServerState, StatusResponse } from '../shared/types.ts'

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export interface ApiClient {
  getStatus(): Promise<ServerState>
  start(): Promise<void>
  stop(): Promise<void>
}

export function createApiClient(
  getSecret: () => string,
  fetchFn: typeof fetch = fetch,
): ApiClient {
  async function req(path: string, method: 'GET' | 'POST'): Promise<unknown> {
    const res = await fetchFn(path, {
      method,
      headers: { 'X-Auth-Token': getSecret() },
    })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }

  return {
    async getStatus() {
      const body = (await req('/api/status', 'GET')) as StatusResponse
      return body.state
    },
    async start() {
      await req('/api/start', 'POST')
    },
    async stop() {
      await req('/api/stop', 'POST')
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/api.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/api.ts tests/client/api.test.ts
git commit -m "feat: frontend API client with auth header"
```

---

## Task 9: Polling hook

**Files:**
- Create: `src/client/useServerStatus.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/client/useServerStatus.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerState } from '../shared/types.ts'
import { UnauthorizedError, type ApiClient } from './api.ts'

const POLL_MS = 5000

export interface ServerStatus {
  state: ServerState
  busy: boolean
  error: boolean
  unauthorized: boolean
  toggle: () => void
}

export function useServerStatus(api: ApiClient): ServerStatus {
  const [state, setState] = useState<ServerState>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const busyRef = useRef(busy)
  busyRef.current = busy

  const refresh = useCallback(async () => {
    if (busyRef.current) return // don't fight an in-flight action
    try {
      setState(await api.getStatus())
      setError(false)
      setUnauthorized(false)
    } catch (e) {
      if (e instanceof UnauthorizedError) setUnauthorized(true)
      else setError(true)
    }
  }, [api])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  const toggle = useCallback(async () => {
    if (busyRef.current) return
    setBusy(true)
    setError(false)
    try {
      if (state === 'running') await api.stop()
      else await api.start()
    } catch (e) {
      if (e instanceof UnauthorizedError) setUnauthorized(true)
      else setError(true)
    } finally {
      setBusy(false)
      refresh()
    }
  }, [api, state, refresh])

  return { state, busy, error, unauthorized, toggle }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/useServerStatus.ts
git commit -m "feat: polling hook with toggle action"
```

---

## Task 10: UI components

**Files:**
- Create: `src/client/components/StatusBadge.tsx`, `src/client/components/ToggleButton.tsx`, `src/client/components/SecretGate.tsx`

- [ ] **Step 1: Create `StatusBadge.tsx`**

```tsx
// src/client/components/StatusBadge.tsx
import type { UiState } from '../state.ts'

const LABEL: Record<UiState, string> = {
  on: 'Online',
  off: 'Offline',
  pending: 'Starting…',
  error: 'Error',
}

export function StatusBadge({ ui }: { ui: UiState }) {
  return (
    <span className={`badge badge-${ui}`}>
      <span className="badge-dot" />
      {LABEL[ui]}
    </span>
  )
}
```

- [ ] **Step 2: Create `ToggleButton.tsx`**

```tsx
// src/client/components/ToggleButton.tsx
import type { UiState } from '../state.ts'

interface Props {
  ui: UiState
  onToggle: () => void
}

export function ToggleButton({ ui, onToggle }: Props) {
  const disabled = ui === 'pending'
  return (
    <div className="toggle-wrap">
      {ui === 'pending' && (
        <>
          <span className="ring" />
          <span className="ring ring-2" />
        </>
      )}
      <button
        className={`toggle toggle-${ui}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label="Toggle server"
      >
        {ui === 'on' && 'ON'}
        {ui === 'off' && 'OFF'}
        {ui === 'error' && '!'}
        {ui === 'pending' && (
          <span className="dots">
            <span />
            <span />
            <span />
          </span>
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `SecretGate.tsx`**

```tsx
// src/client/components/SecretGate.tsx
import { useState } from 'react'

export function SecretGate({ onSubmit }: { onSubmit: (secret: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="gate"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <h1 className="brand">Pylote</h1>
      <p className="sub">Enter access token</p>
      <input
        className="gate-input"
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Access token"
        autoFocus
      />
      <button className="gate-btn" type="submit">
        Connect
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/components
git commit -m "feat: StatusBadge, ToggleButton, SecretGate components"
```

---

## Task 11: App shell + secret persistence

**Files:**
- Create: `src/client/App.tsx`

- [ ] **Step 1: Create `App.tsx`**

```tsx
// src/client/App.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiClient } from './api.ts'
import { useServerStatus } from './useServerStatus.ts'
import { deriveUiState } from './state.ts'
import { StatusBadge } from './components/StatusBadge.tsx'
import { ToggleButton } from './components/ToggleButton.tsx'
import { SecretGate } from './components/SecretGate.tsx'

const SECRET_KEY = 'pylote.secret'
const SERVER_NAME = 'Enshrouded'

export function App() {
  const [secret, setSecret] = useState<string>(
    () => localStorage.getItem(SECRET_KEY) ?? '',
  )

  const saveSecret = useCallback((s: string) => {
    localStorage.setItem(SECRET_KEY, s)
    setSecret(s)
  }, [])

  if (!secret) return <SecretGate onSubmit={saveSecret} />
  return <Dashboard secret={secret} onLogout={() => saveSecret('')} />
}

function Dashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const api = useMemo(() => createApiClient(() => secret), [secret])
  const { state, busy, error, unauthorized, toggle } = useServerStatus(api)
  const ui = deriveUiState({ state, busy, error })

  // Wrong/expired secret: clear it and go back to the gate (in an effect,
  // never during render).
  useEffect(() => {
    if (unauthorized) onLogout()
  }, [unauthorized, onLogout])

  return (
    <main className="screen">
      <header className="header">
        <h1 className="brand">Pylote</h1>
        <p className="sub">Server control</p>
      </header>
      <section className="center">
        <StatusBadge ui={ui} />
        <ToggleButton ui={ui} onToggle={toggle} />
        <span className="name">{SERVER_NAME}</span>
        {ui === 'error' && <span className="err-msg">Proxmox unreachable</span>}
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/App.tsx
git commit -m "feat: app shell with secret gate and dashboard"
```

---

## Task 12: Styles — gaming/neon theme (dark + light, all states)

**Files:**
- Create: `src/client/styles.css`

- [ ] **Step 1: Create `styles.css`**

```css
/* src/client/styles.css */
:root {
  --bg: #0d1117;
  --fg: #e6edf3;
  --sub: rgba(230, 237, 243, 0.55);
  --card-border: #1f2733;
  --accent: #3fe78c;
  --accent-dim: #0d3a26;
  --off: #5b6675;
  --off-border: #2a333f;
  --pending: #fbbf24;
  --error: #f87171;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f4f6f9;
    --fg: #101826;
    --sub: rgba(16, 24, 38, 0.55);
    --card-border: #e2e6ec;
    --accent: #12b364;
    --accent-dim: #daf6e6;
    --off: #98a2b3;
    --off-border: #d3d8e0;
  }
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.screen, .gate {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: env(safe-area-inset-top) 20px 24px;
}
.header { margin-top: 28px; text-align: center; }
.brand { font-size: 28px; font-weight: 800; letter-spacing: 0.5px; margin: 0; }
.sub { font-size: 13px; color: var(--sub); margin: 4px 0 0; }

.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
}
.name { font-size: 14px; color: var(--sub); }
.err-msg { font-size: 13px; color: var(--error); }

/* Badge */
.badge {
  font-size: 12px; font-weight: 700; padding: 6px 15px; border-radius: 999px;
  letter-spacing: 0.6px; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid transparent;
}
.badge-dot { width: 7px; height: 7px; border-radius: 50%; }
.badge-on { background: rgba(63,231,140,.12); color: var(--accent); border-color: rgba(63,231,140,.35); }
.badge-on .badge-dot { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
.badge-off { background: rgba(148,163,184,.12); color: var(--off); border-color: rgba(148,163,184,.3); }
.badge-off .badge-dot { background: var(--off); }
.badge-pending { background: rgba(250,204,21,.12); color: var(--pending); border-color: rgba(250,204,21,.35); }
.badge-pending .badge-dot { background: var(--pending); box-shadow: 0 0 6px var(--pending); animation: blink 1s infinite; }
.badge-error { background: rgba(248,113,113,.12); color: var(--error); border-color: rgba(248,113,113,.4); }
.badge-error .badge-dot { background: var(--error); box-shadow: 0 0 6px var(--error); }

/* Toggle button */
.toggle-wrap { position: relative; display: flex; align-items: center; justify-content: center; width: 128px; height: 128px; }
.toggle {
  width: 128px; height: 128px; border-radius: 50%;
  font-weight: 800; font-size: 18px; letter-spacing: 1px;
  cursor: pointer; border: 2px solid var(--off-border);
  background: #161b22; color: var(--off);
  display: flex; align-items: center; justify-content: center;
  transition: transform .12s ease;
}
.toggle:active { transform: scale(0.96); }
.toggle:disabled { cursor: default; }
.toggle-on {
  background: radial-gradient(circle at 30% 28%, #1b6b45, var(--accent-dim));
  color: var(--accent); border-color: var(--accent);
  box-shadow: 0 0 28px rgba(63,231,140,.5), inset 0 0 18px rgba(63,231,140,.25);
}
.toggle-off { background: #161b22; color: var(--off); }
@media (prefers-color-scheme: light) {
  .toggle-off { background: #e7eaef; }
  .toggle-on { background: radial-gradient(circle at 30% 28%, #2fe084, var(--accent)); color: #053b22; }
}
.toggle-pending { color: var(--pending); border-color: rgba(250,204,21,.55); }
.toggle-error { color: var(--error); border-color: rgba(248,113,113,.5); font-size: 34px; }

/* Ring pulse (transition) */
.ring {
  position: absolute; width: 128px; height: 128px; border-radius: 50%;
  border: 2px solid var(--pending); animation: ringPulse 1.6s ease-out infinite;
}
.ring-2 { animation-delay: .8s; }
@keyframes ringPulse {
  0% { transform: scale(1); opacity: .7; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* Bouncing dots */
.dots { display: flex; gap: 8px; }
.dots span { width: 10px; height: 10px; border-radius: 50%; background: var(--pending); animation: bounce 1.2s infinite; }
.dots span:nth-child(2) { animation-delay: .2s; }
.dots span:nth-child(3) { animation-delay: .4s; }
@keyframes bounce { 0%,100% { opacity:.3; transform: translateY(0); } 50% { opacity:1; transform: translateY(-4px); } }
@keyframes blink { 50% { opacity: .3; } }

/* Secret gate */
.gate { justify-content: center; gap: 14px; }
.gate-input {
  width: 100%; max-width: 280px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--card-border); background: #161b22; color: var(--fg); font-size: 16px;
}
@media (prefers-color-scheme: light) { .gate-input { background: #fff; } }
.gate-btn {
  padding: 11px 22px; border-radius: 12px; border: none; cursor: pointer;
  background: var(--accent); color: #04150c; font-weight: 700; font-size: 15px;
}
```

- [ ] **Step 2: Visual check in dev**

Run (two terminals or `bun run dev`):
```bash
bun run dev
```
Open `http://localhost:5173`. Expected: secret gate appears; after entering a token, the dashboard renders with badge + toggle. (Status will show error until a real Proxmox is configured — that's expected here.)

- [ ] **Step 3: Commit**

```bash
git add src/client/styles.css
git commit -m "feat: gaming/neon theme with dark+light and all states"
```

---

## Task 13: Production build + full test run

**Files:** none (verification task)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: all tests pass (config, proxmox, app, state, api).

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Build the client**

Run: `bun run build`
Expected: `dist/client/` contains `index.html`, hashed JS/CSS, `manifest.webmanifest`, and a service worker (`sw.js`).

- [ ] **Step 4: Smoke-test the monolith serving the built PWA**

Run:
```bash
PROXMOX_URL=https://pve.local:8006 PROXMOX_TOKEN_ID=x PROXMOX_TOKEN_SECRET=y \
PROXMOX_NODE=pve LXC_VMID=105 AUTH_TOKEN=z PORT=3000 \
bun run start &
sleep 1
curl -s http://localhost:3000/ | grep -q '<div id="root">' && echo "PWA served OK"
curl -s http://localhost:3000/api/health
kill %1
```
Expected: prints `PWA served OK` then `{"ok":true}`.

- [ ] **Step 5: Commit (if any lockfile/config changed)**

```bash
git add -A
git commit -m "chore: verify build and full test suite" || echo "nothing to commit"
```

---

## Task 14: Dockerfile + README (deployment)

**Files:**
- Create: `Dockerfile`, `README.md`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS run
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]
```

- [ ] **Step 2: Create `README.md`**

````markdown
# Pylote

A small PWA to turn the Enshrouded Proxmox LXC on/off from your phone.

Monolith: Bun + Hono serves the React/Vite PWA and a tiny API that calls the
Proxmox REST API. Runs in the always-on `app` LXC; controls a *different* LXC.

## Configure

Copy `.env.example` to `.env` and fill in the values.

### Create a Proxmox API token
1. Proxmox UI → **Datacenter → Permissions → API Tokens → Add**.
   Pick a user (e.g. `pylote@pve`) and a token name (e.g. `toggle`).
   Copy the **Token ID** (`pylote@pve!toggle`) and the **Secret** (shown once).
2. Give the token power rights: **Datacenter → Permissions → Add → API Token
   Permission**. Path `/vms/<VMID>` (or a pool), role with `VM.PowerMgmt` +
   `VM.Audit`.
3. Find the **VMID** and **node name**: shown next to the LXC in the Proxmox tree
   (e.g. VMID `105`, node `pve`).

## Develop

```bash
bun install
bun run dev          # Vite on :5173 (proxied API → Bun on :3000)
bun test             # run tests
```

## Deploy (in the `app` LXC)

```bash
bun run build        # builds dist/client
bun run start        # serves PWA + API on $PORT
```

Or with Docker:

```bash
docker build -t pylote .
docker run -d --env-file .env -p 3000:3000 --restart unless-stopped pylote
```

Then open `http://<app-lxc-ip>:3000` on your phone (over the VPN), enter the
access token, and install it as a PWA.
````

- [ ] **Step 3: Commit**

```bash
git add Dockerfile README.md
git commit -m "docs: Dockerfile and setup/deploy README"
```

---

## Task 15: Push

- [ ] **Step 1: Push all work**

Run: `git push origin main`
Expected: branch updated on GitHub.

---

## Notes for the implementer

- **Dependency versions** in `package.json` are floor versions; `bun install`
  will resolve current compatibles. If `hono/bun`'s `serveStatic` import path
  differs in the installed version, check the Hono docs — the API is stable in v4.
- **Self-signed Proxmox cert**: the `tls: { rejectUnauthorized: false }` option in
  `proxmox.ts` is Bun-specific and only used at runtime (tests inject `fetchFn`,
  so they never hit TLS). If Proxmox has a valid cert, this option is harmless.
- **PWA icons** are placeholders in Task 6 — replace `icon-192.png` / `icon-512.png`
  with a real icon before considering it "done".
- **`Starting…` vs `Stopping…`**: the badge label in `StatusBadge` shows
  `Starting…` for all pending states for simplicity (matches the validated
  mockup). Distinguishing start vs stop is a trivial future tweak (pass the
  intended direction into the badge).
```
