// src/client/useTheme.ts
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'pylote.theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function storedTheme(): Theme | null {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

/**
 * Manual light/dark theme with persistence.
 * Defaults to the OS preference until the user makes an explicit choice; once
 * chosen, the choice is stored and applied via `data-theme` on <html> (which
 * the stylesheet honours over `prefers-color-scheme`).
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())

  useEffect(() => {
    // Only pin `data-theme` when the user has an explicit stored choice;
    // otherwise leave it unset so the app keeps following the OS.
    const stored = storedTheme()
    if (stored) document.documentElement.dataset.theme = stored
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      document.documentElement.dataset.theme = next
      return next
    })
  }, [])

  return { theme, toggle }
}
