type ShareCanvasRow = {
  label: string
  tone?: 'win' | 'loss' | 'neutral'
}

export type ResultShareCanvasInput = {
  backgroundSrc: string
  logoSrc?: string
  boomLabel: string
  headline: string
  subline: string
  pointsLabel: string
  rows: ShareCanvasRow[]
  cta: string
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, initialSize: number, minSize: number, font: (size: number) => string) {
  let size = initialSize
  while (size > minSize) {
    ctx.font = font(size)
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 2
  }
  return size
}

export async function renderResultShareCanvas(input: ResultShareCanvasInput): Promise<Blob> {
  const width = 1080
  const height = 1920
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible.')

  const [bg, logo] = await Promise.all([
    loadImage(input.backgroundSrc),
    input.logoSrc ? loadImage(input.logoSrc).catch(() => null) : Promise.resolve(null),
  ])
  await document.fonts?.ready?.catch(() => undefined)

  ctx.drawImage(bg, 0, 0, width, height)
  const overlay = ctx.createLinearGradient(0, 0, 0, height)
  overlay.addColorStop(0, 'rgba(2, 8, 18, 0.05)')
  overlay.addColorStop(0.52, 'rgba(2, 8, 18, 0.22)')
  overlay.addColorStop(1, 'rgba(2, 8, 18, 0.5)')
  ctx.fillStyle = overlay
  ctx.fillRect(0, 0, width, height)

  if (logo) {
    const logoW = 500
    const logoH = logo.height * (logoW / logo.width)
    ctx.drawImage(logo, (width - logoW) / 2, 40, logoW, logoH)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#2bff9a'
  ctx.shadowColor = 'rgba(43,255,154,.8)'
  ctx.shadowBlur = 30
  ctx.font = "900 82px 'Barlow Condensed', Arial, sans-serif"
  ctx.fillText(input.boomLabel, width / 2, 360)

  ctx.fillStyle = '#f4fff9'
  ctx.shadowBlur = 18
  fitText(ctx, input.headline, 900, 116, 66, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
  ctx.fillText(input.headline, width / 2, 470)

  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(238,245,255,.72)'
  fitText(ctx, input.subline, 900, 34, 24, (size) => `800 ${size}px 'Barlow Condensed', Arial, sans-serif`)
  ctx.fillText(input.subline, width / 2, 550)

  ctx.fillStyle = '#ffb800'
  ctx.shadowColor = 'rgba(255,184,0,.72)'
  ctx.shadowBlur = 32
  fitText(ctx, input.pointsLabel, 930, 124, 64, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
  ctx.fillText(input.pointsLabel, width / 2, 720)
  ctx.shadowBlur = 0

  const panelX = 90
  const panelW = width - 180
  const rowH = 78
  const rows = input.rows.slice(0, 4)
  const panelH = Math.max(150, rows.length * (rowH + 16) + 52)
  const panelY = 960
  roundRect(ctx, panelX, panelY, panelW, panelH, 26)
  ctx.fillStyle = 'rgba(6, 16, 31, .82)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(43,255,154,.28)'
  ctx.lineWidth = 2
  ctx.stroke()

  if (rows.length) {
    rows.forEach((row, index) => {
      const y = panelY + 34 + index * (rowH + 16)
      roundRect(ctx, panelX + 34, y, panelW - 68, rowH, 999)
      ctx.fillStyle = row.tone === 'loss' ? '#ff4455' : row.tone === 'neutral' ? 'rgba(255,255,255,.12)' : '#22c55e'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      fitText(ctx, row.label, panelW - 130, 32, 22, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
      ctx.fillText(row.label, width / 2, y + rowH / 2 + 1)
    })
  } else {
    ctx.fillStyle = 'rgba(238,245,255,.8)'
    ctx.font = "900 38px 'Barlow Condensed', Arial, sans-serif"
    ctx.fillText('Aucun bonus trouve', width / 2, panelY + panelH / 2)
  }

  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,.5)'
  ctx.shadowBlur = 16
  fitText(ctx, input.cta, 850, 38, 25, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
  ctx.fillText(input.cta, width / 2, height - 105)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Impossible de generer l'image.")), 'image/png', 0.94)
  })
}
