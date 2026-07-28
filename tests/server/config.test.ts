import { test, expect } from 'bun:test'
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
