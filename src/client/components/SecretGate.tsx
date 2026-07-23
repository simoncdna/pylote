// src/client/components/SecretGate.tsx
import { useState } from 'react'

export function SecretGate({ onSubmit }: { onSubmit: (secret: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="gate"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <h1 className="brand">Pylote</h1>
      <p className="sub">Enter access token</p>
      <input
        className="gate-input"
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Access token"
        autoFocus
      />
      <button className="gate-btn" type="submit">
        Connect
      </button>
    </form>
  )
}
