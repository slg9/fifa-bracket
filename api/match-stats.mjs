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

  // Scorers: FIFA player-stats section doubles every token ("LARIN LARIN", "Buts Buts").
  // Pattern: lines[i]="Buts Buts", lines[i-1]=goal count, lines[i-2]="LASTNAME LASTNAME", lines[i-3]="Firstname Firstname"
  function dedup(s) {
    const parts = s.trim().split(/\s+/)
    const half = Math.floor(parts.length / 2)
    if (half > 0) {
      const first = parts.slice(0, half).join(' ')
      const second = parts.slice(half).join(' ')
      if (first === second) return first
    }
    return s.trim()
  }

  function extractScorers() {
    // Strategy 1: FIFA player-stats "Buts Buts" doubled-label (works for GER/CUW style pages)
    const butsRe = /^Buts?\s+Buts?$/i
    const scorers1 = []
    for (let i = 3; i < lines.length; i++) {
      if (!butsRe.test(lines[i])) continue
      const lastRaw = lines[i - 2]
      const firstRaw = lines[i - 3]
      if (!lastRaw || !firstRaw) continue
      const lastName = dedup(lastRaw)
      const firstName = dedup(firstRaw)
      const name = `${firstName} ${lastName}`.trim()
      if (name.length > 2) scorers1.push({ name, minute: null })
    }
    if (scorers1.length > 0) return scorers1

    // Strategy 2: events section — Name line followed by minute line (works for NED/JPN style pages)
    const minuteRe = /^\d{1,3}['\u2019\u02b9\u2032+]/
    // Skip lines that are clearly not player names
    const skipRe = /^(https?:|www\.|Image|Coupe|FIFA|Groupe|Phase|APERÇU|STATS|COMPO|CLASSEM|INFOS|LIVE|Où|Télé|Pas|data |Fin |Mi-|En |Match|Politique|Télécharger)/i
    const scorers2 = []
    for (let i = 0; i < lines.length - 1; i++) {
      if (!minuteRe.test(lines[i + 1])) continue
      const name = lines[i].trim()
      if (name.length < 3 || name.length > 60) continue
      if (skipRe.test(name)) continue
      if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) continue
      // Must look like a name: not a URL, not a pure number, not a label
      if (/^\d+$/.test(name)) continue
      scorers2.push({ name, minute: lines[i + 1].replace(/['\u2019\u02b9\u2032]/g, "'") })
      i++ // skip the minute line
    }
    return scorers2
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
