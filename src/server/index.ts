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
