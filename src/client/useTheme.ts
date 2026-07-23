// src/client/useTheme.ts
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'pylote.theme'

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => unknown
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function storedTheme(): Theme | null {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Manual light/dark theme with persistence and a crossfade.
 * Defaults to the OS preference until the user makes an explicit choice; once
 * chosen, the choice is stored and applied via `data-theme` on <html>.
 * The swap runs through the View Transitions API for a smooth crossfade
 * (styled in styles.css), falling back to an instant swap where unsupported.
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
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const apply = () => {
      localStorage.setItem(THEME_KEY, next)
      document.documentElement.dataset.theme = next
      setTheme(next)
    }

    const doc = document as ViewTransitionDoc
    if (!doc.startViewTransition || prefersReducedMotion()) {
      apply()
      return
    }
    // Default View Transition = crossfade between old and new theme snapshots.
    doc.startViewTransition(apply)
  }, [theme])

  return { theme, toggle }
}
