// Odds API — fetches h2h odds for FIFA World Cup 2026 from The Odds API.
// Returns a keyed map { "HOME_CODE-AWAY_CODE": { home, draw, away } }
// where probabilities are normalized implied probabilities (bookmaker margin removed).
// Cache-Control: public, s-maxage=7200 → Vercel CDN caches for 2h (~360 requests/month)

const ODDS_API_NAME_TO_FIFA = {
  Algeria: 'ALG', Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT',
  Belgium: 'BEL', 'Bosnia & Herzegovina': 'BIH', Brazil: 'BRA', Canada: 'CAN',
  'Cape Verde': 'CPV', Colombia: 'COL', Croatia: 'CRO', 'Curaçao': 'CUW',
  'Czech Republic': 'CZE', 'DR Congo': 'COD', Ecuador: 'ECU', Egypt: 'EGY',
  England: 'ENG', France: 'FRA', Germany: 'GER', Ghana: 'GHA',
  Haiti: 'HAI', Iran: 'IRN', Iraq: 'IRQ', 'Ivory Coast': 'CIV',
  Japan: 'JPN', Jordan: 'JOR', Mexico: 'MEX', Morocco: 'MAR',
  Netherlands: 'NED', 'New Zealand': 'NZL', Norway: 'NOR', Panama: 'PAN',
  Paraguay: 'PAR', Portugal: 'POR', Qatar: 'QAT', 'Saudi Arabia': 'KSA',
  Scotland: 'SCO', Senegal: 'SEN', 'South Africa': 'RSA', 'South Korea': 'KOR',
  Spain: 'ESP', Sweden: 'SWE', Switzerland: 'SUI', Tunisia: 'TUN',
  Turkey: 'TUR', USA: 'USA', Uruguay: 'URU', Uzbekistan: 'UZB',
}

export default async function handler(req, res) {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ODDS_API_KEY not configured' })

  const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${apiKey}&regions=eu&markets=h2h&oddsFormat=decimal`

  let events
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'fifabracket/1.0' } })
    if (!response.ok) return res.status(502).json({ error: 'Odds API unavailable', status: response.status })
    events = await response.json()
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  const result = {}

  for (const event of events) {
    const homeCode = ODDS_API_NAME_TO_FIFA[event.home_team]
    const awayCode = ODDS_API_NAME_TO_FIFA[event.away_team]
    if (!homeCode || !awayCode) continue

    const prices = { home: [], draw: [], away: [] }

    for (const bk of event.bookmakers) {
      const h2h = bk.markets.find(m => m.key === 'h2h')
      if (!h2h) continue
      for (const outcome of h2h.outcomes) {
        const code = ODDS_API_NAME_TO_FIFA[outcome.name]
        if (code === homeCode) prices.home.push(outcome.price)
        else if (code === awayCode) prices.away.push(outcome.price)
        else if (outcome.name === 'Draw') prices.draw.push(outcome.price)
      }
    }

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    const homeAvg = avg(prices.home)
    const drawAvg = avg(prices.draw)
    const awayAvg = avg(prices.away)
    if (!homeAvg || !drawAvg || !awayAvg) continue

    // Remove bookmaker margin, normalize to 100%
    const rH = 1 / homeAvg
    const rD = 1 / drawAvg
    const rA = 1 / awayAvg
    const total = rH + rD + rA

    const round1 = x => Math.round(x * 10) / 10
    const key = `${homeCode}-${awayCode}`
    result[key] = {
      commenceTime: event.commence_time,
      home: { code: homeCode, avgOdds: round1(homeAvg), prob: Math.round((rH / total) * 100) },
      draw: { avgOdds: round1(drawAvg), prob: Math.round((rD / total) * 100) },
      away: { code: awayCode, avgOdds: round1(awayAvg), prob: Math.round((rA / total) * 100) },
    }
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  // 2h CDN cache — ~360 req/month, within the 500/month free tier
  res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=14400')
  res.status(200).json(result)
}
