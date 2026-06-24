import { useEffect, useRef } from 'react'

type SwipeOptions = {
  onSwipe: (startX: number, startY: number, endX: number, endY: number) => void
  minDistance?: number
  mouseMinDistance?: number
}

type SwipePoint = { x: number; y: number }

export function useSwipe({ onSwipe, minDistance = 50, mouseMinDistance = 1 }: SwipeOptions) {
  const touchesRef = useRef(new Map<number, SwipePoint>())
  const mouseRef = useRef<SwipePoint | null>(null)
  const mouseCleanupRef = useRef<(() => void) | null>(null)
  const lastTouchAtRef = useRef(-1000)

  const complete = (start: SwipePoint | undefined | null, endX: number, endY: number, minDist = minDistance) => {
    if (!start || Math.hypot(endX - start.x, endY - start.y) < minDist) return
    onSwipe(start.x, start.y, endX, endY)
  }

  useEffect(() => () => mouseCleanupRef.current?.(), [])

  return {
    onTouchStart: (event: React.TouchEvent<Element>) => {
      lastTouchAtRef.current = event.timeStamp
      for (const touch of Array.from(event.changedTouches)) {
        touchesRef.current.set(touch.identifier, { x: touch.clientX, y: touch.clientY })
      }
    },
    onTouchEnd: (event: React.TouchEvent<Element>) => {
      lastTouchAtRef.current = event.timeStamp
      for (const touch of Array.from(event.changedTouches)) {
        complete(touchesRef.current.get(touch.identifier), touch.clientX, touch.clientY)
        touchesRef.current.delete(touch.identifier)
      }
    },
    onTouchCancel: (event: React.TouchEvent<Element>) => {
      for (const touch of Array.from(event.changedTouches)) touchesRef.current.delete(touch.identifier)
    },
    onMouseDown: (event: React.MouseEvent<Element>) => {
      if (event.timeStamp - lastTouchAtRef.current <= 500) return
      const start = { x: event.clientX, y: event.clientY }
      mouseRef.current = start
      mouseCleanupRef.current?.()
      const handleWindowMouseUp = (mouseEvent: MouseEvent) => {
        complete(start, mouseEvent.clientX, mouseEvent.clientY, mouseMinDistance)
        mouseRef.current = null
        mouseCleanupRef.current?.()
        mouseCleanupRef.current = null
      }
      window.addEventListener('mouseup', handleWindowMouseUp, { once: true })
      mouseCleanupRef.current = () => window.removeEventListener('mouseup', handleWindowMouseUp)
    },
    onMouseUp: (event: React.MouseEvent<Element>) => {
      if (event.timeStamp - lastTouchAtRef.current <= 500) return
      complete(mouseRef.current, event.clientX, event.clientY, mouseMinDistance)
      mouseRef.current = null
      mouseCleanupRef.current?.()
      mouseCleanupRef.current = null
    },
    onMouseLeave: () => undefined,
  }
}
