type ShareCanvasRow = {
  label: string
  tone?: 'win' | 'loss' | 'neutral'
}

export type ResultShareCanvasInput = {
  backgroundSrc: string
  logoSrc?: string
  ownerPseudo?: string
  matchup?: {
    homeFlag?: string
    awayFlag?: string
    homeLabel: string
    awayLabel: string
  }
  boomLabel: string
  headline: string
  subline: string
  messageLines?: string[]
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

function drawMatchupFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  flag: string | undefined,
  label: string,
) {
  ctx.fillStyle = '#ffffff'
  ctx.font = "900 72px 'Apple Color Emoji', 'Segoe UI Emoji', Arial, sans-serif"
  ctx.fillText(flag || label.slice(0, 3).toUpperCase(), x, y)
}


function gfMultiply(a: number, b: number) {
  let result = 0
  for (let i = 0; i < 8; i += 1) {
    if ((b & 1) !== 0) result ^= a
    const carry = (a & 0x80) !== 0
    a = (a << 1) & 0xff
    if (carry) a ^= 0x1d
    b >>= 1
  }
  return result
}

function gfPow(value: number, power: number) {
  let result = 1
  for (let i = 0; i < power; i += 1) result = gfMultiply(result, value)
  return result
}

function reedSolomonRemainder(data: number[], degree: number) {
  let generator = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(generator.length + 1).fill(0)
    generator.forEach((coefficient, index) => {
      next[index] ^= gfMultiply(coefficient, gfPow(2, i))
      next[index + 1] ^= coefficient
    })
    generator = next
  }

  const result = new Array(degree).fill(0)
  data.forEach((byte) => {
    const factor = byte ^ result.shift()
    result.push(0)
    generator.slice(1).forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor)
    })
  })
  return result
}

function appendBits(bits: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1)
}

function buildQrCodeModules(text: string) {
  const size = 25
  const dataCodewords = 34
  const errorCodewords = 10
  const modules: Array<Array<number | null>> = Array.from({ length: size }, () => Array(size).fill(null))
  const reserved = Array.from({ length: size }, () => Array(size).fill(false))

  const setModule = (x: number, y: number, value: number, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    modules[y][x] = value
    if (reserve) reserved[y][x] = true
  }

  const drawFinder = (x: number, y: number) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx
        const yy = y + dy
        const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
        const dark = inFinder && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4))
        setModule(xx, yy, dark ? 1 : 0)
      }
    }
  }

  drawFinder(0, 0)
  drawFinder(size - 7, 0)
  drawFinder(0, size - 7)

  for (let i = 8; i < size - 8; i += 1) {
    setModule(i, 6, i % 2 === 0 ? 1 : 0)
    setModule(6, i, i % 2 === 0 ? 1 : 0)
  }

  const drawAlignment = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        setModule(cx + dx, cy + dy, distance === 2 || distance === 0 ? 1 : 0)
      }
    }
  }
  drawAlignment(18, 18)

  setModule(8, size - 8, 1)
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true
      reserved[i][8] = true
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true
    reserved[size - 1 - i][8] = true
  }

  const bytes = [...new TextEncoder().encode(text)]
  const bits: number[] = []
  appendBits(bits, 0b0100, 4)
  appendBits(bits, bytes.length, 8)
  bytes.forEach((byte) => appendBits(bits, byte, 8))
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0))
  }
  for (let pad = 0xec; data.length < dataCodewords; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad)
  const codewordBits = [...data, ...reedSolomonRemainder(data, errorCodewords)].flatMap((byte) => {
    const next: number[] = []
    appendBits(next, byte, 8)
    return next
  })

  let bitIndex = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert
      for (let col = 0; col < 2; col += 1) {
        const x = right - col
        if (reserved[y][x]) continue
        const bit = codewordBits[bitIndex] ?? 0
        bitIndex += 1
        const masked = bit ^ (((x + y) % 2 === 0) ? 1 : 0)
        setModule(x, y, masked, false)
      }
    }
    upward = !upward
  }

  const format = 0b111011111000100
  const formatBit = (index: number) => (format >>> index) & 1
  for (let i = 0; i <= 5; i += 1) setModule(8, i, formatBit(i))
  setModule(8, 7, formatBit(6))
  setModule(8, 8, formatBit(7))
  setModule(7, 8, formatBit(8))
  for (let i = 9; i < 15; i += 1) setModule(14 - i, 8, formatBit(i))
  for (let i = 0; i < 8; i += 1) setModule(size - 1 - i, 8, formatBit(i))
  for (let i = 8; i < 15; i += 1) setModule(8, size - 15 + i, formatBit(i))

  return modules.map((row) => row.map((value) => value === 1))
}

function drawQrCode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const modules = buildQrCodeModules(text)
  const count = modules.length
  const quiet = 4
  const cell = size / (count + quiet * 2)
  ctx.save()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, 18)
  ctx.fill()
  ctx.fillStyle = '#050b16'
  modules.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (!dark) return
      ctx.fillRect(x + (columnIndex + quiet) * cell, y + (rowIndex + quiet) * cell, Math.ceil(cell), Math.ceil(cell))
    })
  })
  ctx.restore()
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

  const ownerPseudo = input.ownerPseudo?.trim()
  if (ownerPseudo) {
    const handle = ownerPseudo.startsWith('@') ? ownerPseudo : `@${ownerPseudo}`
    const badgeY = logo ? 178 : 54
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const handleSize = fitText(ctx, handle, 430, 42, 26, (size) => `900 ${size}px 'JetBrains Mono', 'Barlow Condensed', Arial, sans-serif`)
    const handleWidth = ctx.measureText(handle).width
    const badgeW = Math.min(540, Math.max(300, handleWidth + 116))
    const badgeX = (width - badgeW) / 2
    roundRect(ctx, badgeX, badgeY, badgeW, 76, 999)
    const badgeGradient = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + 76)
    badgeGradient.addColorStop(0, 'rgba(43,255,154,.92)')
    badgeGradient.addColorStop(0.52, 'rgba(255,184,0,.92)')
    badgeGradient.addColorStop(1, 'rgba(255,68,85,.88)')
    ctx.fillStyle = badgeGradient
    ctx.shadowColor = 'rgba(43,255,154,.45)'
    ctx.shadowBlur = 28
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,.58)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#07111f'
    ctx.font = `900 ${handleSize}px 'JetBrains Mono', 'Barlow Condensed', Arial, sans-serif`
    ctx.fillText(handle.toUpperCase(), width / 2, badgeY + 40)
  }

  if (input.matchup) {
    const groupX = width - 248
    const groupY = 100
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,.62)'
    ctx.shadowBlur = 18
    drawMatchupFlag(ctx, groupX - 106, groupY, input.matchup.homeFlag, input.matchup.homeLabel)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffb800'
    ctx.font = "900 34px 'Barlow Condensed', Arial, sans-serif"
    ctx.fillText('VS', groupX, groupY + 1)
    ctx.shadowColor = 'rgba(0,0,0,.62)'
    ctx.shadowBlur = 18
    drawMatchupFlag(ctx, groupX + 106, groupY, input.matchup.awayFlag, input.matchup.awayLabel)
    ctx.restore()
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
  ctx.fillText(input.pointsLabel, width / 2, 690)
  ctx.shadowBlur = 0

  const messageLines = (input.messageLines ?? []).filter(Boolean).slice(0, 3)
  if (messageLines.length) {
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    messageLines.forEach((line, index) => {
      fitText(ctx, line, 880, 34, 23, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
      ctx.fillText(line, width / 2, 790 + index * 48)
    })
  }

  const panelX = 90
  const panelW = width - 180
  const rowH = 78
  const rows = input.rows.slice(0, 4)
  const panelH = Math.max(150, rows.length * (rowH + 16) + 52)
  const panelY = 980
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

  const qrSize = 132
  const qrX = (width - qrSize) / 2
  const qrY = height - 248
  drawQrCode(ctx, 'https://brakup.app/challenge', qrX, qrY, qrSize)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,.86)'
  ctx.shadowColor = 'rgba(0,0,0,.5)'
  ctx.shadowBlur = 12
  ctx.font = "900 23px 'Barlow Condensed', Arial, sans-serif"
  ctx.fillText('brakup.app', width / 2, qrY + qrSize + 32)

  ctx.fillStyle = '#ffffff'
  ctx.shadowBlur = 16
  fitText(ctx, input.cta, 850, 32, 22, (size) => `900 ${size}px 'Barlow Condensed', Arial, sans-serif`)
  ctx.fillText(input.cta, width / 2, height - 54)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Impossible de generer l'image.")), 'image/png', 0.94)
  })
}
