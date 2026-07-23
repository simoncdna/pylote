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
