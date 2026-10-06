import { useEffect, useRef, useState } from 'react'
import { startGame } from './renderer3d'
import { phase, samples, id, onPhase, setName } from './net'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [named, setNamed] = useState(false)

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

  // score baseline, re-snapped at every round start, so the END screen can show
  // what THIS round earned. Phase changes are rare — react instantly, no 1Hz wait.
  const [base, setBase] = useState(0)
  useEffect(
    () =>
      onPhase((m) => {
        setNow(Date.now())
        if (m.phase === 'SEARCH')
          setBase(samples[samples.length - 1]?.players.find((p) => p.id === id)?.score ?? 0)
      }),
    [],
  )

  const last = samples[samples.length - 1]
  const me = last?.players.find((p) => p.id === id)
  const sec = phase && phase.endsAt > 0 && now > 0 ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : 0
  const label = !phase
    ? ''
    : `ROUND ${phase.round} · ${
        phase.phase === 'SEARCH'
          ? 'SEARCH — find the poison'
          : phase.phase === 'HUNT'
            ? `HUNT — ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
            : phase.winner === 'prey'
              ? 'PREYS WIN'
              : 'HUNTERS WIN'
      }`
  const you =
    me?.role === 'hunter'
      ? 'YOU ARE THE HUNTER — click to infect'
      : me?.role === 'zombie'
        ? 'INFECTED — click to infect the rest'
        : ''
  const ended = phase?.phase === 'END'
  const delta = ended && me ? me.score - base : 0
  const board = ended && last ? [...last.players].sort((a, b) => b.score - a.score) : []

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#050505]">
      <canvas className="block h-full w-full" ref={ref} />
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 select-none rounded bg-black/50 px-4 py-1 text-center font-mono text-white">
        {label && <div className="text-xl tracking-widest">{label}</div>}
        {you && <div className="mt-1 text-sm tracking-wider text-amber-300">{you}</div>}
        {me && (
          <div className="mt-1 text-sm tracking-wider text-white/80">
            {me.name} · PTS {me.score}
          </div>
        )}
        {ended && (
          <div className="mt-2 border-t border-white/20 pt-2 text-sm leading-6">
            <div className="tracking-widest text-amber-300">
              THIS ROUND {delta >= 0 ? '+' : ''}
              {delta}
            </div>
            {board.map((p) => (
              <div key={p.id} className={p.id === id ? 'text-amber-300' : 'text-white/70'}>
                {p.name} — {p.score}
              </div>
            ))}
          </div>
        )}
      </div>
      {!named && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <form
            className="flex flex-col items-center gap-4 rounded border border-white/10 bg-black/80 px-8 py-6 font-mono"
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get('name')
              if (typeof v === 'string' && v.trim()) setName(v)
              setNamed(true)
            }}
          >
            <div className="text-sm tracking-widest text-white/70">ENTER YOUR NAME</div>
            <input
              name="name"
              autoFocus
              maxLength={12}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              className="w-56 rounded border border-white/20 bg-black/60 px-3 py-1 text-center font-mono text-white outline-none placeholder:text-white/30 focus:border-amber-300"
              placeholder="…or Enter to skip"
            />
            <button type="submit" className="rounded bg-amber-300 px-4 py-1 text-sm font-bold text-black">
              PLAY
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
