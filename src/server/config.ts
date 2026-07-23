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
