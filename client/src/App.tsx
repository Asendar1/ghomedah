import { useEffect, useRef } from 'react'
import { startGame } from './renderer'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current) return
    return startGame(ref.current) // cleanup on unmount — also keeps StrictMode's double-run harmless
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505]">
      <canvas  className='border-8 border-amber-200' ref={ref} width={800} height={800} />
    </div>
  )
}
