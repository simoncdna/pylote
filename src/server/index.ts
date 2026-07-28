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
