// src/client/components/ToggleButton.tsx
import type { UiState } from '../state.ts'

interface Props {
  ui: UiState
  onToggle: () => void
}

export function ToggleButton({ ui, onToggle }: Props) {
  const disabled = ui === 'pending'
  return (
    <div className="toggle-wrap">
      {ui === 'pending' && (
        <>
          <span className="ring" />
          <span className="ring ring-2" />
        </>
      )}
      <button
        className={`toggle toggle-${ui}`}
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
