import { useEffect, useRef } from 'react'

// Calls fn now and every interval; pauses while the tab is hidden and fires once on return.
export default function usePolling(fn: () => void, ms: number, deps: unknown[] = []) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | undefined
    const start = () => { ref.current(); t = setInterval(() => ref.current(), ms) }
    const stop = () => clearInterval(t)
    const onVis = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}
