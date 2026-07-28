# Multi-server / multi-backend foundations — Design

**Date:** 2026-07-28
**Status:** Approved
**Phase:** 1 of the public-release roadmap

## Vision & roadmap context

Pylote evolves from "my personal Enshrouded toggle" into a small, public,
self-hostable dashboard: **the universal on/off button for your game servers**.
You already run servers somewhere (Proxmox LXC/VM, Docker on a VPS); Pylote
gives you a polished mobile PWA to power them on and off. Nothing to install
on the target machines — Pylote talks to the APIs you already have.

Positioning vs Pterodactyl: Pterodactyl *manages* game servers (installs them,
consoles, files, users) and requires its Wings daemon on every node. Pylote
stays deliberately tiny: 5-minute install, zero agents, great mobile UX.

Roadmap (each phase = its own spec + PR):

1. **Multi-server / multi-backend foundations** ← this spec
2. Public release: showcase README (EN), install docs, published Docker image,
   LICENSE, CONTRIBUTING, auth guidance (VPN/reverse-proxy)
3. Live game status: Steam A2S / Minecraft ping, players online on cards
4. Smart shutdown: warn/block when players online, auto-off when empty
5. Console / logs (to be re-scoped later)

Out of scope for phase 1: authentication (phase 2 with docs), game icons/logos
(asset/rights question, phase 2/3), game status queries, any agent/daemon,
admin UI for editing servers (config stays file-based; a UI may come later on
top of the yaml).

## Configuration: `pylote.yaml`

Loaded at startup from `PYLOTE_CONFIG` (default `./pylote.yaml`), parsed with
the `yaml` npm package, validated exhaustively at boot. Invalid config →
precise error list (e.g. `servers[1].vmid missing`) and the process exits.
Missing file → error explaining where to put it, with an inline example.

```yaml
port: 3000            # optional, default 3000

servers:
  - id: enshrouded            # unique slug, used as the API id
    name: Enshrouded          # display name on the card
    game: enshrouded          # optional — drives color accent, later icons
    type: proxmox-lxc         # proxmox-lxc | proxmox-vm | docker
    url: https://haven.local:8006
    tokenId: ${PROXMOX_TOKEN_ID}
    tokenSecret: ${PROXMOX_TOKEN_SECRET}
    node: haven
    vmid: 103

  - id: valheim
    name: Valheim
    type: docker
    host: unix:///var/run/docker.sock   # or tcp://my-vps:2375
    container: valheim-server
```

Rules:

- Common fields per server: `id` (unique slug), `name`, `game` (optional),
  `type`. Type-specific fields sit flat alongside them.
- `${VAR}` anywhere in a string value is interpolated from the environment.
  A missing env var is an explicit boot error.
- Secrets never live in the yaml directly — the example files use `${...}`.
- `.env.example` shrinks to secrets only. `pylote.yaml.example` ships in the
  repo. The old 5-env-var single-server config (`PROXMOX_URL`, `LXC_VMID`, …)
  is removed — breaking, acceptable pre-1.0 with a single known deployment
  (migration section below).

## Backend architecture

### Provider interface — `src/server/providers/types.ts`

```ts
interface PowerProvider {
  status(): Promise<ServerState>   // 'running' | 'stopped' | 'unknown'
  start(): Promise<void>
  stop(): Promise<void>
}
```

### Providers

- `src/server/providers/proxmox.ts` — current `src/server/proxmox.ts` moved
  and generalized. Handles `proxmox-lxc` and `proxmox-vm`: same Proxmox REST
  API, path segment `lxc/` vs `qemu/`. Config fields: `url`, `tokenId`,
  `tokenSecret`, `node`, `vmid`.
- `src/server/providers/docker.ts` — Docker Engine API:
  `GET /containers/{id}/json` for state, `POST /containers/{id}/start|stop`.
  Connects over a Unix socket (`unix:///var/run/docker.sock`, Bun fetch
  supports unix sockets) or TCP (`tcp://host:2375`). Config fields: `host`,
  `container`.

### Registry — `src/server/config.ts`

Parses + validates the yaml, interpolates env, and builds a
`Map<id, { meta, provider }>` where `meta` is `{ id, name, game, type }`.
Unknown `type`, duplicate `id`, or missing type-specific fields are boot
errors.

### API — `src/server/app.ts`

- `GET /api/servers` → `[{ id, name, game, type, state }]`. States fetched in
  parallel; an unreachable backend yields `state: 'unknown'` for that server —
  never a global 500.
- `POST /api/servers/:id/start` / `POST /api/servers/:id/stop` → `{ ok: true }`
  or error. Unknown id → 404. Backend failure → 502 with a message.
- Old routes `/api/status` and `/api/toggle` are removed.

`src/shared/types.ts` grows a `ServerSummary` type shared with the client.

## Client

- `useServers` replaces `useServerStatus`: single poll of `GET /api/servers`
  every 5 s, per-server state.
- **Dashboard**: one card per server — name, game subtitle, state badge
  (running / stopped / pending / unknown), and the living power button at card
  size.
- **Single-server case**: when exactly one server is configured, keep the
  current full-page layout (big central button, embers). Ambient animations
  (fog, embers) stay page-level in both layouts.
- **Pending states**: the current "Starting…/Stopping… until target state
  reached" logic becomes per-server (`Map<id, pendingTarget>` in
  `src/client/state.ts`).
- **`game` field**: shown as a subtitle + drives a per-game color accent
  (simple mapping, neutral fallback). No logos in phase 1.

## Error handling

- Unreachable backend → card in `unknown` state; error message revealed on
  tap; other cards unaffected.
- Failed start/stop → 502 surfaced on the card's reserved error line (no
  layout shift, as today).
- Boot-time config errors → precise, human-readable, process exits non-zero.

## Testing

Same stack (`bun test`), extending the existing suites:

- `tests/server/config.test.ts` — yaml parsing/validation: nominal case,
  missing env var, unknown type, duplicate ids, missing type-specific fields,
  missing file.
- `tests/server/proxmox.test.ts` — adapted: lxc vs qemu paths, status/start/
  stop with mocked fetch.
- `tests/server/docker.test.ts` — new: unix socket and tcp hosts, state
  mapping, error cases, mocked fetch.
- `tests/server/app.test.ts` — adapted: list endpoint (parallel states, one
  backend down → that server `unknown`), start/stop, unknown id → 404,
  backend failure → 502.
- `tests/client/state.test.ts` — per-server pending logic.

## Migration of the existing deployment

The PR ships `pylote.yaml.example`. The real deployment (node `haven`, LXC
103, existing token env vars) gets an equivalent `pylote.yaml` mounted next to
the app; `.env` keeps only `PROXMOX_TOKEN_ID` / `PROXMOX_TOKEN_SECRET`. README
is updated minimally (new config format); the full showcase README is phase 2.
