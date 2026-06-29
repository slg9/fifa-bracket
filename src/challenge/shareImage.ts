import { toBlob } from 'html-to-image'

type ShareImageOptions = {
  fileName: string
  title: string
  text: string
  url?: string
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

async function resolveImagesAsDataUrls(element: HTMLElement): Promise<() => void> {
  const imgs = Array.from(element.querySelectorAll('img')) as HTMLImageElement[]
  const originals = new Map<HTMLImageElement, string>()
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:')) return
    try {
      const res = await fetch(src, { cache: 'force-cache' })
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      originals.set(img, src)
      img.src = dataUrl
    } catch {
      // ignore – keep original src
    }
  }))
  // Return a cleanup function to restore originals
  return () => { originals.forEach((src, img) => { img.src = src }) }
}

export async function shareElementImage(element: HTMLElement, options: ShareImageOptions) {
  const restoreImages = await resolveImagesAsDataUrls(element)
  
  // Sauvegarder les styles originaux pour restauration
  const originalVisibility = element.style.visibility
  const originalTransform = element.style.transform
  const originalPosition = element.style.position
  const originalZIndex = element.style.zIndex
  const originalLeft = element.style.left
  const originalTop = element.style.top
  const originalOpacity = element.style.opacity
  const originalDisplay = element.style.display
  
  // Rendre l'element visible et positionne pour la capture
  element.style.visibility = 'visible'
  element.style.transform = 'none'
  element.style.position = 'fixed'
  element.style.zIndex = '999999'
  element.style.left = '0'
  element.style.top = '0'
  element.style.opacity = '1'
  element.style.display = 'block'
  
  // Forcer le navigateur a appliquer les styles avant capture
  await new Promise(resolve => requestAnimationFrame(resolve))
  
  let blob: Blob | null = null
  try {
    blob = await toBlob(element, {
      cacheBust: false,
      pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
      backgroundColor: options.backgroundColor ?? '#050b16',
    })
  } finally {
    restoreImages()
    // Restaurer les styles originaux
    element.style.visibility = originalVisibility
    element.style.transform = originalTransform
    element.style.position = originalPosition
    element.style.zIndex = originalZIndex
    element.style.left = originalLeft
    element.style.top = originalTop
    element.style.opacity = originalOpacity
    element.style.display = originalDisplay
  }

  if (!blob) {
    throw new Error("Impossible de generer l'image.")
  }

  const file = new File([blob], options.fileName, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function' && Boolean(navigator.canShare?.({ files: [file] }))

  if (canShareFile) {
    await navigator.share({
      title: options.title,
      text: options.text,
      ...(options.url ? { url: options.url } : {}),
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
