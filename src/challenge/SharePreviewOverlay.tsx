import { useEffect, useRef, useState } from 'react'
import ShareCard, { type ShareCardProps } from './ShareCard'
import { shareVisibleElementImage } from './shareImage'

type SharePreviewOverlayProps = {
  card: Omit<ShareCardProps, 'captureRef'>
  fileName: string
  title: string
  text: string
  url?: string
  backgroundColor?: string
  autoShare?: boolean
  onClose: () => void
}

export function SharePreviewOverlay({
  card,
  fileName,
  title,
  text,
  url,
  backgroundColor = '#050b16',
  autoShare = true,
  onClose,
}: SharePreviewOverlayProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const autoStartedRef = useRef(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'working' | 'done' | 'error'>('loading')

  const runShare = async () => {
    if (!cardRef.current || status === 'working') return
    setStatus('working')
    try {
      await shareVisibleElementImage(cardRef.current, {
        fileName,
        title,
        text,
        url,
        backgroundColor,
      })
      setStatus('done')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('ready')
        return
      }
      console.error('Share preview failed:', error)
      setStatus('error')
    }
  }

  useEffect(() => {
    let cancelled = false
    const prepare = async () => {
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => setTimeout(resolve, 180))
      if (cancelled) return
      setStatus('ready')
      if (autoShare && !autoStartedRef.current) {
        autoStartedRef.current = true
        void runShare()
      }
    }
    void prepare()
    return () => { cancelled = true }
  // runShare intentionally reads the latest ref/status when the preview becomes visible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShare])

  const buttonLabel = status === 'working'
    ? 'Partage...'
    : status === 'loading'
      ? 'Preparation...'
      : 'Partager'

  return (
    <div className="brakup-share-preview" role="dialog" aria-modal="true" aria-label="Apercu du partage">
      <div className="brakup-share-preview__stage">
        <ShareCard captureRef={cardRef} {...card} />
      </div>
      <div className="brakup-share-preview__actions">
        <button type="button" className="brakup-share-preview__close" onClick={onClose} aria-label="Fermer">×</button>
        <button type="button" className="brakup-share-preview__button" onClick={() => void runShare()} disabled={status === 'loading' || status === 'working'}>
          <span aria-hidden="true">↗</span>
          {buttonLabel}
        </button>
        {status === 'done' ? <small>Image prete.</small> : null}
        {status === 'error' ? <small className="is-error">Partage indisponible. Retente avec le bouton.</small> : null}
      </div>
    </div>
  )
}

export default SharePreviewOverlay
