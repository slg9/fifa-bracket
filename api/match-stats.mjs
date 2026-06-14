function parseMatchStats(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Find a French label and return the next two numeric values found after it
  function extractPair(label) {
    const idx = lines.findIndex(l => l === label || l.startsWith(label))
    if (idx === -1) return null
    const values = []
    for (let i = idx + 1; i < Math.min(idx + 10, lines.length) && values.length < 2; i++) {
      const m = lines[i].match(/^(\d+)/)
      if (m) values.push(Number(m[1]))
    }
    return values.length === 2 ? { home: values[0], away: values[1] } : null
  }

  // Possession: looks for "Possession" then extracts percentage values
  function extractPossession() {
    const idx = lines.findIndex(l => l === 'Possession')
    if (idx === -1) return null
    const pcts = []
    for (let i = idx + 1; i < Math.min(idx + 8, lines.length) && pcts.length < 2; i++) {
      const m = lines[i].match(/^(\d+)%/)
      if (m) pcts.push(Number(m[1]))
      else {
        // also handle "52%Situations" concatenated form
        const m2 = lines[i].match(/^(\d+)%\w/)
        if (m2) pcts.push(Number(m2[1]))
      }
    }
    return pcts.length >= 2 ? { home: pcts[0], away: pcts[1] } : null
  }

  // Total shots: find "Frappes au but" then "Total" right after
  function extractTotalShots() {
    const frapIdx = lines.findIndex(l => l === 'Frappes au but' || l.includes('Frappes au but'))
    if (frapIdx === -1) return extractPair('Total')
    const totalIdx = lines.findIndex((l, i) => i > frapIdx && l === 'Total')
    if (totalIdx === -1) return null
    const values = []
    for (let i = totalIdx + 1; i < Math.min(totalIdx + 6, lines.length) && values.length < 2; i++) {
      const m = lines[i].match(/^(\d+)/)
      if (m) values.push(Number(m[1]))
    }
    return values.length === 2 ? { home: values[0], away: values[1] } : null
  }

  // Scorers: look for goal events. FIFA pages show player names near minute markers.
  // Pattern: uppercase player name line, followed by minute like "45'" or "45'+2'"
  function extractScorers() {
    const scorers = []
    const minuteRe = /^\d+[''\u2019\u02b9\u2032]/
    for (let i = 0; i < lines.length - 1; i++) {
      if (minuteRe.test(lines[i + 1]) && /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝ\s\-']+$/.test(lines[i]) && lines[i].length > 2) {
        scorers.push({ name: lines[i], minute: lines[i + 1] })
        i++
      }
    }
    return scorers
  }

  return {
    possession: extractPossession(),
    shots: extractTotalShots(),
    shotsOnTarget: extractPair('Cadrés'),
    corners: extractPair('Corners') ?? extractPair('Corner'),
    fouls: extractPair('Fautes concédées'),
    yellowCards: extractPair('Cartons jaunes'),
    redCards: extractPair('Cartons rouges'),
    passes: extractPair('Passes décisives'),
    scorers: extractScorers(),
  }
}

export default async function handler(req, res) {
  const { path } = req.query
  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path required' })
  }

  const url = `https://r.jina.ai/https://www.fifa.com/fr/match-centre/match/${path}`
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', 'x-no-cache': 'true' },
  })

  if (!response.ok) {
    return res.status(502).json({ error: 'FIFA page unavailable' })
  }

  const text = await response.text()
  const stats = parseMatchStats(text)

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.status(200).json(stats)
}
