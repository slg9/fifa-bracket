import { toBlob } from 'html-to-image'

type ShareImageOptions = {
  fileName: string
  title: string
  text: string
  backgroundColor?: string
}

function downloadBlob(blob: Blob, fileName: string) {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function shareElementImage(element: HTMLElement, options: ShareImageOptions) {
  const blob = await toBlob(element, {
    cacheBust: true,
    pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
    backgroundColor: options.backgroundColor ?? '#050b16',
  })

  if (!blob) {
    throw new Error("Impossible de generer l'image.")
  }

  const file = new File([blob], options.fileName, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function' && Boolean(navigator.canShare?.({ files: [file] }))

  if (canShareFile) {
    await navigator.share({
      title: options.title,
      text: options.text,
      files: [file],
    })
    return 'shared' as const
  }

  downloadBlob(blob, options.fileName)
  return 'downloaded' as const
}

export function safeFilePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50) || 'brakup'
}
