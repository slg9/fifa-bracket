import { useEffect, useState } from 'react'

export type Locale = 'fr' | 'en'

export const PROD_ORIGIN = 'https://brakup.app'

function stripLocalePrefix(pathname: string) {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, '')
  return stripped || '/'
}

export function getCurrentLocale(): Locale {
  if (typeof window === 'undefined') return 'fr'
  return window.location.pathname === '/en' || window.location.pathname.startsWith('/en/') ? 'en' : 'fr'
}

export function localizedRootPath(locale: Locale) {
  return locale === 'en' ? '/en' : '/'
}

export function localizedPath(locale: Locale, search = typeof window !== 'undefined' ? window.location.search : '', hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const pathname = typeof window !== 'undefined' ? stripLocalePrefix(window.location.pathname) : '/'
  const basePath = locale === 'en' ? `/en${pathname === '/' ? '' : pathname}` : pathname
  return `${basePath || '/'}${search}${hash}`
}

export function alternateLanguageHref(locale: Locale) {
  return localizedPath(locale === 'en' ? 'fr' : 'en')
}

export function localizedChallengeHref(locale: Locale) {
  return `${localizedRootPath(locale)}?challenge`
}

const SEO = {
  fr: {
    lang: 'fr',
    locale: 'fr_FR',
    canonical: `${PROD_ORIGIN}/`,
    title: 'Brakup — Coupe du Monde 2026 Challenge | Prédictions, bracket & mini-jeu foot',
    description: 'Brakup est le jeu de prédiction de la Coupe du Monde 2026 : crée ton bracket, joue les matchs en mini-jeu arcade, trouve les scores exacts, les buteurs et grimpe dans le classement.',
    imageAlt: 'Brakup — Coupe du Monde 2026 Challenge',
  },
  en: {
    lang: 'en',
    locale: 'en_US',
    canonical: `${PROD_ORIGIN}/en`,
    title: 'Brakup — World Cup 2026 Challenge | Predictions, bracket & football mini-game',
    description: 'Brakup is the World Cup 2026 prediction game: build your bracket, play arcade football matches, hit exact scores and scorers, then climb the live leaderboard.',
    imageAlt: 'Brakup — World Cup 2026 Challenge',
  },
} satisfies Record<Locale, {
  lang: string
  locale: string
  canonical: string
  title: string
  description: string
  imageAlt: string
}>

function setHeadAttr(selector: string, attr: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attr, value)
}

function applySeo(locale: Locale) {
  const seo = SEO[locale]
  document.documentElement.lang = seo.lang
  document.title = seo.title
  setHeadAttr('meta[name="description"]', 'content', seo.description)
  setHeadAttr('link[rel="canonical"]', 'href', seo.canonical)
  setHeadAttr('meta[property="og:locale"]', 'content', seo.locale)
  setHeadAttr('meta[property="og:url"]', 'content', seo.canonical)
  setHeadAttr('meta[property="og:title"]', 'content', seo.title)
  setHeadAttr('meta[property="og:description"]', 'content', seo.description)
  setHeadAttr('meta[property="og:image:alt"]', 'content', seo.imageAlt)
  setHeadAttr('meta[name="twitter:title"]', 'content', seo.title)
  setHeadAttr('meta[name="twitter:description"]', 'content', seo.description)
  setHeadAttr('meta[name="twitter:image:alt"]', 'content', seo.imageAlt)
}

const EXACT_TRANSLATIONS = new Map<string, string>([
  ['Tableau final', 'Final bracket'],
  ['Le Centre souligne naturellement la route vers la finale.', 'The center naturally highlights the road to the final.'],
  ['Le centre souligne naturellement la route vers la finale.', 'The center naturally highlights the road to the final.'],
  ['16E', 'R32'],
  ['16e', 'R32'],
  ['8E', 'R16'],
  ['8e', 'R16'],
  ['QUARTS', 'QUARTERS'],
  ['Quarts', 'Quarters'],
  ['DEMIES', 'SEMIS'],
  ['Demies', 'Semis'],
  ['FINALE', 'FINAL'],
  ['Finale', 'Final'],
  ['CONFIRMÉ', 'CONFIRMED'],
  ['CONFIRME', 'CONFIRMED'],
  ['BUTEURS', 'SCORERS'],
  ['Buteurs', 'Scorers'],
  ['GROUPES', 'GROUPS'],
  ['Groupes', 'Groups'],
  ['RÉSULTATS', 'RESULTS'],
  ['RESULTATS', 'RESULTS'],
  ['Résultats', 'Results'],
  ['Match en cours', 'Live match'],
  ['Matchs du jour', "Today's matches"],
  ['Partager', 'Share'],
  ["Generation de l'image...", 'Generating image...'],
  ['Challenge', 'Challenge'],
  ['JOUER', 'PLAY'],
  ['Construis ton bracket - Joue les matchs', 'Build your bracket - Play the matches'],
  ['Classement', 'Leaderboard'],
  ['Menu', 'Menu'],
  ['Menu jeu', 'Game menu'],
  ['Tableau', 'Bracket'],
  ['Carte des matchs', 'Match map'],
  ['Stats', 'Stats'],
  ["Aucun match aujourd'hui.", 'No matches today.'],
  ['Top buteurs indisponible.', 'Top scorers unavailable.'],
  ['Mute le jeu', 'Mute game'],
  ['Activer le son', 'Enable sound'],
  ['Ce match n’est pas encore disponible', 'This match is not available yet'],
  ['Ce match n est pas encore disponible.', 'This match is not available yet.'],
  ['Retour au bracket', 'Back to bracket'],
  ['Retour jeu', 'Back to game'],
  ['Retour', 'Back'],
  ['Fermer', 'Close'],
  ['Continuer', 'Continue'],
  ['Annuler', 'Cancel'],
  ['Valider mes choix', 'Submit my picks'],
  ['Sauvegarde…', 'Saving...'],
  ['Sauvegarde sécurisée', 'Secure save'],
  ['Garde ton bracket', 'Save your bracket'],
  ['Verification OTP', 'OTP verification'],
  ['Code de connexion', 'Login code'],
  ['Code OTP', 'OTP code'],
  ['Le terrain est encore vide', 'The pitch is still empty'],
  ['Le classement apparaîtra après les premières validations.', 'The leaderboard will appear after the first submitted brackets.'],
  ['Top 50 public', 'Public Top 50'],
  ['Les meilleurs sélectionneurs Brakup.', 'The best Brakup bracket builders.'],
  ['Voir carte', 'View map'],
  ['Choisis ton', 'Choose your'],
  ['TIREUR', 'SHOOTER'],
  ['Tirer', 'Shoot'],
  ['OK TIRER', 'OK SHOOT'],
  ['PHASE DE TIR', 'SHOT PHASE'],
  ['RELACHE DANS LE VERT !', 'RELEASE IN THE GREEN!'],
  ['MAINTIENS LA BALLE, TIRE VERS LE BAS', 'HOLD THE BALL, PULL DOWN'],
  ['TIRE LE ROND JAUNE VERS LE BAS, VISE, PUIS RELACHE DANS LE VERT', 'PULL THE YELLOW CIRCLE DOWN, AIM, THEN RELEASE IN THE GREEN'],
  ['BUT !', 'GOAL!'],
  ['ARRETE !', 'SAVED!'],
  ['RATE !', 'MISSED!'],
  ['PASSE !', 'THROUGH!'],
  ['PASSAGE', 'LANE'],
  ['BONUS', 'BONUS'],
  ['RISQUE = BONUS', 'RISK = BONUS'],
  ['SAUTE !', 'JUMP!'],
  ['INTERCEPTE !', 'INTERCEPTED!'],
  ['MAGNIFIQUE !', 'BEAUTIFUL!'],
  ['TROP LENT !', 'TOO SLOW!'],
  ['TIR BOOSTE', 'BOOSTED SHOT'],
  ['CONTRE-ATTAQUE', 'COUNTER ATTACK'],
  ['Choisis une equipe', 'Choose a team'],
  ["Choisis l'equipe", 'Choose the team'],
  ["Le match demarre avec l'equipe que tu touches.", 'The match starts with the team you tap.'],
  ['VAINQUEUR', 'WINNER'],
  ['VAINQUEUR OFFICIEL', 'OFFICIAL WINNER'],
  ['Match verrouille', 'Match locked'],
  ['Match verrouillé. Termine le match qui clignote pour débloquer la suite.', 'Match locked. Finish the blinking match to unlock the next one.'],
  ['Match déjà joué. Impossible de rejouer.', 'Match already played. You cannot replay it.'],
  ['Resultat officiel enregistre. Ce match ne peut plus etre joue.', 'Official result saved. This match can no longer be played.'],
  ['Score officiel en attente', 'Official score pending'],
  ['Prono reussi', 'Prediction hit'],
  ['Prono rate', 'Prediction missed'],
  ['Dommage', 'Too bad'],
  ['Bien joue', 'Well played'],
  ['points gagnes', 'points earned'],
  ['Vainqueur trouve', 'Winner found'],
  ['Score exact reussi', 'Exact score hit'],
  ['Buteur trouve', 'Scorer found'],
  ['Scoreurs Brakup', 'Brakup scorers'],
  ['Partage-la avec tes potes et challenge-les sur Brakup.', 'Share it with your friends and challenge them on Brakup.'],
  ["Partager l'image", 'Share image'],
  ['Image prete a partager.', 'Image ready to share.'],
  ['Partage indisponible pour le moment.', 'Sharing is unavailable right now.'],
  ['Partage avec tes potes · challenge-les sur Brakup', 'Share with your friends · challenge them on Brakup'],
  ['Retente le prochain', 'Try the next one'],
  ['Mon bracket', 'My bracket'],
  ['Mes brackets', 'My brackets'],
  ['Brouillon local', 'Local draft'],
  ['Données tournoi', 'Tournament data'],
  ['projection locale', 'local projection'],
  ['À déterminer', 'To be decided'],
  ['En attente', 'Pending'],
  ['VERROUILLE', 'LOCKED'],
  ['LOCK', 'LOCK'],
  ['World Cup Challenge', 'World Cup Challenge'],
  ['BRAKUP 2026', 'BRAKUP 2026'],
  ['Mexique', 'Mexico'],
  ['Afrique du Sud', 'South Africa'],
  ['Corée du Sud', 'South Korea'],
  ['Tchéquie', 'Czechia'],
  ['Bosnie-Herzégovine', 'Bosnia and Herzegovina'],
  ['Suisse', 'Switzerland'],
  ['Brésil', 'Brazil'],
  ['Maroc', 'Morocco'],
  ['Haïti', 'Haiti'],
  ['Écosse', 'Scotland'],
  ['États-Unis', 'United States'],
  ['Australie', 'Australia'],
  ['Turquie', 'Turkey'],
  ['Allemagne', 'Germany'],
  ["Côte d'Ivoire", 'Ivory Coast'],
  ['Équateur', 'Ecuador'],
  ['Pays-Bas', 'Netherlands'],
  ['Japon', 'Japan'],
  ['Suède', 'Sweden'],
  ['Tunisie', 'Tunisia'],
  ['Belgique', 'Belgium'],
  ['Égypte', 'Egypt'],
  ['Nouvelle-Zélande', 'New Zealand'],
  ['Espagne', 'Spain'],
  ['Cap-Vert', 'Cape Verde'],
  ['Arabie saoudite', 'Saudi Arabia'],
  ['Sénégal', 'Senegal'],
  ['Irak', 'Iraq'],
  ['Norvège', 'Norway'],
  ['Argentine', 'Argentina'],
  ['Algérie', 'Algeria'],
  ['Autriche', 'Austria'],
  ['Jordanie', 'Jordan'],
  ['RD Congo', 'DR Congo'],
  ['Ouzbékistan', 'Uzbekistan'],
  ['Colombie', 'Colombia'],
  ['Angleterre', 'England'],
  ['Croatie', 'Croatia'],
])

const REGEX_TRANSLATIONS: Array<[RegExp, string]> = [
  [/^Groupe ([A-L])$/, 'Group $1'],
  [/^Vainqueur (M\d+)$/, 'Winner $1'],
  [/^Perdant (M\d+)$/, 'Loser $1'],
  [/^Match (\d+)$/, 'Match $1'],
  [/^(\d+) match(s?) au programme\.$/, '$1 match$2 scheduled.'],
  [/^(\d+) match(s?) en direct maintenant\.$/, '$1 match$2 live now.'],
  [/^(\d+) pronos OK · (\d+) scores exacts · (\d+) buteurs$/, '$1 correct picks · $2 exact scores · $3 scorers'],
  [/^(\d+) pronos$/, '$1 picks'],
  [/^(\d+) exacts$/, '$1 exacts'],
  [/^(\d+) buteurs$/, '$1 scorers'],
  [/^Sauvé (.+)$/, 'Saved $1'],
  [/^sync (.+)$/, 'sync $1'],
  [/^Reel (.+) · Ton jeu (.+)$/, 'Real $1 · Your game $2'],
  [/^reel (.+) · toi (.+)$/, 'real $1 · yours $2'],
  [/^Ton jeu (.+) est sauvegarde\.(.*)$/, 'Your game $1 is saved.$2'],
  [/^Score exact \+(\d+)$/, 'Exact score +$1'],
  [/^Buteur trouve \+(\d+)(.*)$/, 'Scorer found +$1$2'],
  [/^#(\d+) · (\d+)\/(\d+)$/, '#$1 · $2/$3'],
]

const INLINE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bTableau final\b/g, 'Final bracket'],
  [/\bJUIN\b/g, 'JUN'],
  [/\bJuin\b/g, 'Jun'],
  [/\bjuin\b/g, 'Jun'],
  [/\bJUIL\./g, 'JUL'],
  [/\bJuil\./g, 'Jul'],
  [/\bjuil\./g, 'Jul'],
  [/\bCONFIRMÉ\b/g, 'CONFIRMED'],
  [/\bCONFIRME\b/g, 'CONFIRMED'],
  [/\bMatchs du jour\b/g, "Today's matches"],
  [/\bMatch en cours\b/g, 'Live match'],
  [/\bClassement\b/g, 'Leaderboard'],
  [/\bCarte des matchs\b/g, 'Match map'],
  [/\bDonnées tournoi\b/g, 'Tournament data'],
  [/\bProno reussi\b/g, 'Prediction hit'],
  [/\bProno rate\b/g, 'Prediction missed'],
  [/\bScore exact\b/g, 'Exact score'],
  [/\bButeur trouve\b/g, 'Scorer found'],
  [/\bVainqueur trouve\b/g, 'Winner found'],
  [/\bGroupe ([A-L])\b/g, 'Group $1'],
  [/\bFermer\b/g, 'Close'],
  [/\bRetour\b/g, 'Back'],
]

function translateCore(text: string) {
  const exact = EXACT_TRANSLATIONS.get(text)
  if (exact) return exact

  for (const [regex, replacement] of REGEX_TRANSLATIONS) {
    if (regex.test(text)) return text.replace(regex, replacement)
  }

  let translated = text
  for (const [regex, replacement] of INLINE_REPLACEMENTS) {
    translated = translated.replace(regex, replacement)
  }
  return translated
}

function translateText(value: string) {
  if (!value.trim()) return value
  const leading = value.match(/^\s*/)?.[0] ?? ''
  const trailing = value.match(/\s*$/)?.[0] ?? ''
  const compact = value.trim().replace(/\s+/g, ' ')
  const translated = translateCore(compact)
  return translated === compact ? value : `${leading}${translated}${trailing}`
}

function shouldSkipNode(node: Node) {
  const parent = node.parentElement
  if (!parent) return false
  return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(parent.tagName)
}

function translateElementAttributes(element: Element) {
  for (const attr of ['aria-label', 'title', 'alt', 'placeholder']) {
    const value = element.getAttribute(attr)
    if (!value) continue
    const translated = translateText(value)
    if (translated !== value) element.setAttribute(attr, translated)
  }
}

function translateNode(node: Node) {
  if (shouldSkipNode(node)) return
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? ''
    const translated = translateText(value)
    if (translated !== value) node.textContent = translated
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const element = node as Element
  translateElementAttributes(element)
  element.childNodes.forEach(translateNode)
}

function startEnglishDomTranslation() {
  translateNode(document.body)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        translateNode(mutation.target)
        continue
      }
      mutation.addedNodes.forEach(translateNode)
      if (mutation.type === 'attributes') translateElementAttributes(mutation.target as Element)
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'alt', 'placeholder'],
  })

  return () => observer.disconnect()
}

export function useAppI18n() {
  const [locale, setLocale] = useState<Locale>(() => getCurrentLocale())

  useEffect(() => {
    const update = () => setLocale(getCurrentLocale())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  useEffect(() => {
    applySeo(locale)
    if (locale !== 'en') return
    return startEnglishDomTranslation()
  }, [locale])

  return locale
}
