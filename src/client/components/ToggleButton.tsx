// src/client/components/ToggleButton.tsx
import { useEffect, useRef, useState } from 'react'
import type { UiState } from '../state.ts'

interface Props {
  ui: UiState
  onToggle: () => void
}

export function ToggleButton({ ui, onToggle }: Props) {
  const disabled = ui === 'pending'
  const prevUi = useRef(ui)
  const [landing, setLanding] = useState(false)

  // When a transition finishes (pending → on/off), play a one-shot ripple + flash.
  useEffect(() => {
    if ((ui === 'on' || ui === 'off') && prevUi.current === 'pending') {
      setLanding(true)
    }
    prevUi.current = ui
  }, [ui])

  return (
    <div className="toggle-wrap">
      {ui === 'on' && <span className="toggle-aura" />}
      {ui === 'pending' && (
        <>
          <span className="ring" />
          <span className="ring ring-2" />
        </>
      )}
      {landing && (
        <span
          className={`toggle-ripple ripple-${ui}`}
          onAnimationEnd={() => setLanding(false)}
        />
      )}
      <button
        className={`toggle toggle-${ui}${landing ? ' toggle-land' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label="Toggle server"
      >
        {ui === 'on' && 'ON'}
        {ui === 'off' && 'OFF'}
        {ui === 'error' && '!'}
        {ui === 'pending' && (
          <span className="dots">
            <span />
            <span />
            <span />
          </span>
        )}
      </button>
    </div>
  )
}
