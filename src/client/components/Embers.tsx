// src/client/components/Embers.tsx
// Ambient layer: blue embers drifting up through a bluish haze (the Shroud),
// like sparks off a fire just below the frame. Pure CSS animation — each ember
// gets its own randomized path/size/timing via inline custom properties, so the
// swarm never looks like a synchronized loop.
//
// When the server is switched OFF (active: true → false) the fire is put out: a
// shockwave rings out from the button and the whole field is blown outward from
// centre and vanishes. Switching back ON whooshes it all back in.
import { useEffect, useMemo, useRef, useState } from 'react'

const EMBER_COUNT = 40

type EmberStyle = React.CSSProperties & Record<`--${string}`, string>

function makeEmbers(): EmberStyle[] {
  return Array.from({ length: EMBER_COUNT }, () => {
    const size = 2 + Math.random() * 4 // 2–6px
    return {
      '--x': `${Math.random() * 100}vw`,
      '--size': `${size.toFixed(1)}px`,
      '--dx': `${(Math.random() * 2 - 1) * 90}px`, // lateral drift ±90px
      '--dur': `${(5 + Math.random() * 5).toFixed(1)}s`, // 5–10s climb
      '--delay': `${(-Math.random() * 10).toFixed(1)}s`, // negative = pre-warmed
      '--s': (0.7 + Math.random() * 0.7).toFixed(2), // start scale 0.7–1.4
      '--o': (0.45 + Math.random() * 0.45).toFixed(2), // peak opacity
      '--glow': `${(size * 2).toFixed(1)}px`,
    }
  })
}

export function Embers({ active }: { active: boolean }) {
  const embers = useMemo(makeEmbers, [])
  const prev = useRef(active)
  // Bumped on every real ON → OFF transition to remount (retrigger) the ring.
  const [blastKey, setBlastKey] = useState(0)

  useEffect(() => {
    // Ring only when the fire actually goes out — not on initial mount when the
    // server is already off.
    if (prev.current && !active) setBlastKey((k) => k + 1)
    prev.current = active
  }, [active])

  return (
    <div className="embers" aria-hidden="true">
      <div className={`ember-field${active ? '' : ' blown'}`}>
        <div className="fog" />
        <div className="ember-base" />
        {embers.map((style, i) => (
          <span key={i} className="ember" style={style} />
        ))}
      </div>
      {blastKey > 0 && <span key={blastKey} className="shockwave" />}
    </div>
  )
}
