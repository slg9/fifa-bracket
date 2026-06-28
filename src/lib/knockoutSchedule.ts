export const knockoutKickoffById: Record<string, { kickoffIso: string; venue: string }> = {
  M73: { kickoffIso: '2026-06-28T19:00:00Z', venue: 'SoFi Stadium' },
  M74: { kickoffIso: '2026-06-29T20:30:00Z', venue: 'Gillette Stadium' },
  M75: { kickoffIso: '2026-06-30T01:00:00Z', venue: 'Estadio BBVA' },
  M76: { kickoffIso: '2026-06-29T17:00:00Z', venue: 'NRG Stadium' },
  M77: { kickoffIso: '2026-06-30T21:00:00Z', venue: 'MetLife Stadium' },
  M78: { kickoffIso: '2026-06-30T17:00:00Z', venue: 'AT&T Stadium' },
  M79: { kickoffIso: '2026-07-01T01:00:00Z', venue: 'Estadio Azteca' },
  M80: { kickoffIso: '2026-07-01T16:00:00Z', venue: 'Mercedes-Benz Stadium' },
  M81: { kickoffIso: '2026-07-02T00:00:00Z', venue: "Levi's Stadium" },
  M82: { kickoffIso: '2026-07-01T20:00:00Z', venue: 'Lumen Field' },
  M83: { kickoffIso: '2026-07-02T23:00:00Z', venue: 'BMO Field' },
  M84: { kickoffIso: '2026-07-02T19:00:00Z', venue: 'SoFi Stadium' },
  M85: { kickoffIso: '2026-07-03T03:00:00Z', venue: 'BC Place' },
  M86: { kickoffIso: '2026-07-03T22:00:00Z', venue: 'Hard Rock Stadium' },
  M87: { kickoffIso: '2026-07-04T01:30:00Z', venue: 'Arrowhead Stadium' },
  M88: { kickoffIso: '2026-07-03T18:00:00Z', venue: 'AT&T Stadium' },
  M89: { kickoffIso: '2026-07-04T21:00:00Z', venue: 'Lincoln Financial Field' },
  M90: { kickoffIso: '2026-07-04T17:00:00Z', venue: 'NRG Stadium' },
  M91: { kickoffIso: '2026-07-05T20:00:00Z', venue: 'MetLife Stadium' },
  M92: { kickoffIso: '2026-07-06T00:00:00Z', venue: 'Estadio Azteca' },
  M93: { kickoffIso: '2026-07-06T19:00:00Z', venue: 'AT&T Stadium' },
  M94: { kickoffIso: '2026-07-07T00:00:00Z', venue: 'Lumen Field' },
  M95: { kickoffIso: '2026-07-07T16:00:00Z', venue: 'Mercedes-Benz Stadium' },
  M96: { kickoffIso: '2026-07-07T20:00:00Z', venue: 'BC Place' },
  M97: { kickoffIso: '2026-07-09T20:00:00Z', venue: 'Gillette Stadium' },
  M98: { kickoffIso: '2026-07-10T19:00:00Z', venue: 'SoFi Stadium' },
  M99: { kickoffIso: '2026-07-11T21:00:00Z', venue: 'Hard Rock Stadium' },
  M100: { kickoffIso: '2026-07-12T01:00:00Z', venue: 'Arrowhead Stadium' },
  M101: { kickoffIso: '2026-07-14T19:00:00Z', venue: 'AT&T Stadium' },
  M102: { kickoffIso: '2026-07-15T19:00:00Z', venue: 'Mercedes-Benz Stadium' },
  M103: { kickoffIso: '2026-07-18T21:00:00Z', venue: 'Hard Rock Stadium' },
  M104: { kickoffIso: '2026-07-19T19:00:00Z', venue: 'MetLife Stadium' },
}

export function formatKnockoutDateTime(matchId: string, fallbackDateLabel?: string): string {
  const schedule = knockoutKickoffById[matchId]

  if (!schedule) {
    return fallbackDateLabel ? `${fallbackDateLabel} · heure a confirmer` : 'Date · heure a confirmer'
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(schedule.kickoffIso))
    .replace(',', ' ·')
}
