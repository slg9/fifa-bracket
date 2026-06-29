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
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

async function waitForImages(element: HTMLElement) {
  const imgs = Array.from(element.querySelectorAll('img')) as HTMLImageElement[]
  await Promise.all(imgs.map(async (img) => {
    if (img.complete && img.naturalWidth > 0) return
    try {
      if (typeof img.decode === 'function') {
        await img.decode()
        return
      }
    } catch {
      // Fall through to load/error listeners.
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        img.removeEventListener('load', done)
        img.removeEventListener('error', done)
        resolve()
      }
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
    })
  }))
}

async function resolveImagesAsDataUrls(element: HTMLElement) {
  const imgs = Array.from(element.querySelectorAll('img')) as HTMLImageElement[]
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
      img.src = dataUrl
    } catch {
      // ignore – keep original src
    }
  }))
}

export async function shareElementImage(element: HTMLElement, options: ShareImageOptions) {
  // Creer un clone de l'element pour eviter les problemes de CSS herite
  const clone = element.cloneNode(true) as HTMLElement
  
  // Resoudre les images dans le clone
  await resolveImagesAsDataUrls(clone)
  
  // Configurer le clone pour la capture
  clone.style.visibility = 'visible'
  clone.style.transform = 'none'
  clone.style.position = 'fixed'
  clone.style.zIndex = '999999'
  clone.style.left = '-10000px'
  clone.style.top = '0'
  clone.style.opacity = '1'
  clone.style.display = 'block'
  clone.style.pointerEvents = 'none'
  
  // S'assurer que le clone a une taille
  if (!clone.style.width) clone.style.width = `${element.offsetWidth || 720}px`
  if (!clone.style.height) clone.style.height = `${element.offsetHeight || 1280}px`
  
  // Ajouter au body temporairement
  document.body.appendChild(clone)
  
  // Forcer le reflow et attendre que les images soient pretes
  clone.getBoundingClientRect()
  await waitForImages(clone)
  await new Promise(resolve => requestAnimationFrame(resolve))
  await new Promise(resolve => setTimeout(resolve, 100))
  
  let blob: Blob | null = null
  try {
    blob = await toBlob(clone, {
      cacheBust: false,
      pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
      backgroundColor: options.backgroundColor ?? '#050b16',
    })
  } finally {
    // Retirer le clone du DOM
    clone.remove()
  }

  if (!blob) {
    throw new Error("Impossible de generer l'image.")
  }

  const file = new File([blob], options.fileName, { type: 'image/png' })
  const canShareFile = typeof navigator.share === 'function' && Boolean(navigator.canShare?.({ files: [file] }))

  if (canShareFile) {
    try {
      await navigator.share({
        title: options.title,
        text: options.text,
        files: [file],
      })
      return 'shared' as const
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({
            title: options.title,
            text: options.text,
            ...(options.url ? { url: options.url } : {}),
          })
          return 'shared' as const
        }
      } catch {
        // If the browser lost user activation while generating the image,
        // still leave the user with the generated result instead of an error.
      }
      downloadBlob(blob, options.fileName)
      return 'downloaded' as const
    }
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
