import type { Locale } from './i18n'

export const KNOCKOUT_ROUND_ORDER = ['Round of 32', 'Round of 16', 'Quarter-final', 'Semi-final', 'Finale'] as const

const SHORT_LABELS: Record<Locale, Record<string, string>> = {
  fr: {
    'Round of 32': '16e',
    'Round of 16': '8e',
    'Quarter-final': 'Quarts',
    'Semi-final': 'Demies',
    Finale: 'Finale',
  },
  en: {
    'Round of 32': 'R32',
    'Round of 16': 'R16',
    'Quarter-final': 'QF',
    'Semi-final': 'SF',
    Finale: 'F',
  },
}

const LONG_LABELS: Record<Locale, Record<string, string>> = {
  fr: {
    'Round of 32': '16emes',
    'Round of 16': '8emes',
    'Quarter-final': 'Quarts',
    'Semi-final': 'Demies',
    Finale: 'Finale',
  },
  en: SHORT_LABELS.en,
}

export function formatStageShortLabel(stage: string, locale: Locale) {
  return SHORT_LABELS[locale][stage] ?? stage
}

export function formatStageLongLabel(stage: string, locale: Locale) {
  return LONG_LABELS[locale][stage] ?? stage
}

export function formatBracketPathLabel(locale: Locale) {
  return locale === 'en' ? 'R32 -> Final' : '16e -> Finale'
}
