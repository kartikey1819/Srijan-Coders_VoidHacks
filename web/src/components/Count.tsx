import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion, useLookName } from '../look'

/** A number that counts up to its value in the Gen-Z look (ease-out, ~700 ms). Official and reduced motion show it at once.
 *  The final text is always the exact formatted value, so nothing is approximated. */
export function Count({ value, format }: { value: number; format: (n: number) => string }) {
  const look = useLookName()
  const animate = look === 'genz' && !prefersReducedMotion()
  const [shown, setShown] = useState(animate ? 0 : value)
  const from = useRef(0)
  useEffect(() => {
    if (!animate) { setShown(value); return }
    const start = performance.now(), a = from.current, dur = 700
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3)
      setShown(k >= 1 ? value : a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, animate])
  return <span aria-label={format(value)}>{format(shown === value ? value : Math.round(shown))}</span>
}
