import { useEffect, useRef, useState } from 'react'
import { startGame } from './renderer3d'
import { phase, samples, id, onPhase } from './net'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current) return
    return startGame(ref.current) // cleanup on unmount — also keeps StrictMode's double-run harmless
  }, [])

  // 1Hz clock state — refreshes the overlay and drives the countdown, no per-frame state
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tickNow = () => setNow(Date.now())
    tickNow()
    const i = setInterval(tickNow, 1000)
    return () => clearInterval(i)
  }, [])

  // instant reaction to phase changes (rare events) — no waiting for the 1Hz tick
  useEffect(() => onPhase(() => setNow(Date.now())), [])

  const last = samples[samples.length - 1]
  const me = last?.players.find((p) => p.id === id)
  const sec = phase && phase.endsAt > 0 && now > 0 ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : 0
  const label = !phase
    ? ''
    : phase.phase === 'SEARCH'
      ? 'SEARCH — find the poison'
      : phase.phase === 'HUNT'
        ? `HUNT — ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
        : phase.winner === 'prey'
          ? 'PREYS WIN'
          : 'HUNTERS WIN'
  const you =
    me?.role === 'hunter'
      ? 'YOU ARE THE HUNTER — hold E to infect'
      : me?.role === 'zombie'
        ? 'INFECTED — hold E to infect the rest'
        : ''

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050505]">
      <canvas className="block h-full w-full" ref={ref} />
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 select-none rounded bg-black/50 px-4 py-1 text-center font-mono text-white">
        {label && <div className="text-xl tracking-widest">{label}</div>}
        {you && <div className="mt-1 text-sm tracking-wider text-amber-300">{you}</div>}
      </div>
    </div>
  )
}
