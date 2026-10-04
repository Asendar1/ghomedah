import { useEffect, useRef } from 'react'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) startGame(ref.current); }, []);
  return <canvas ref={ref} width={800} height={800} />;
}


