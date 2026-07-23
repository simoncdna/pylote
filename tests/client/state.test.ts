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
