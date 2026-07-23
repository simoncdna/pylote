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

Then open `http://<app-lxc-ip>:3000` on your phone (over the VPN) and install
it as a PWA.
