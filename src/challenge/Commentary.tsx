import { useEffect, useMemo, useState } from 'react'

export interface CommentaryProps {
  text: string
  tokens?: string[]
  displayDuration?: number
  onComplete?: () => void
}

export function Commentary({ text, tokens = [], displayDuration = 2000, onComplete }: CommentaryProps) {
  const [visibleLength, setVisibleLength] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const tokenRanges = useMemo(() => tokens.flatMap((token) => {
    const ranges: Array<[number, number]> = []
    let cursor = text.indexOf(token)
    while (cursor >= 0) {
      ranges.push([cursor, cursor + token.length])
      cursor = text.indexOf(token, cursor + token.length)
    }
    return ranges
  }), [text, tokens])

  useEffect(() => {
    const typing = window.setInterval(() => setVisibleLength((length) => {
      if (length >= text.length) {
        window.clearInterval(typing)
        return length
      }
      return length + 1
    }), 25)
    const fade = window.setTimeout(() => setLeaving(true), text.length * 25 + displayDuration)
    const done = window.setTimeout(() => onComplete?.(), text.length * 25 + displayDuration + 300)
    return () => { window.clearInterval(typing); window.clearTimeout(fade); window.clearTimeout(done) }
  }, [displayDuration, onComplete, text])

  return (
    <div className={`brakup-commentary${leaving ? ' is-leaving' : ''}`} role="status">
      {text.slice(0, visibleLength).split('').map((character, index) => {
        const highlighted = tokenRanges.some(([start, end]) => index >= start && index < end)
        return highlighted ? <strong key={index}>{character}</strong> : <span key={index}>{character}</span>
      })}
      <span className="brakup-commentary__cursor" aria-hidden="true" />
    </div>
  )
}

export default Commentary
