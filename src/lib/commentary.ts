import type { CommentaryPhase, Team } from '../types'

export type CommentaryTemplate = { text: string; funny?: boolean }
export type { CommentaryPhase }

export const COMMENTARY_TEMPLATES: Record<CommentaryPhase, CommentaryTemplate[]> = {
  pre_attack: [
    { text: '{attacker} deborde cote droit, entre dans la surface... IL ARME !' },
    { text: 'Une-deux parfait, {attacker} se retrouve seul face au gardien...' },
    { text: 'Coup franc a 20 m, {attacker} prend son elan, le mur saute...' },
    { text: "{attacker} feinte, elimine son adversaire d'un crochet, il vise..." },
    { text: 'Le {team} presse haut, {attacker} recupere le ballon et fonce !' },
    { text: 'Passe en profondeur lumineuse, {attacker} surgit dans le dos de la defense...' },
    { text: '{attacker} regarde le gardien dans les yeux. Le gardien transpire.', funny: true },
  ],
  attack_success: [
    { text: 'BUT ! {attacker} fait exploser le stade !' },
    { text: '{attacker} trouve la lucarne, le gardien ne pouvait rien faire.' },
    { text: 'Finition parfaite du {team}, quelle maitrise !' },
    { text: "{attacker} transforme l'occasion avec un sang-froid absolu." },
    { text: "Le filet tremble, {team} prend l'avantage !" },
    { text: "{opponent} est puni : {attacker} n'a laisse aucune chance." },
  ],
  attack_fail: [
    { text: 'Le gardien de {opponent} detourne la tentative !' },
    { text: '{attacker} manque le cadre de quelques centimetres.' },
    { text: 'La defense de {opponent} tient bon sous la pression.' },
    { text: 'Tir trop mou de {attacker}, capte sans difficulte.' },
    { text: 'Le poteau sauve {opponent} !' },
    { text: '{attacker} avait fait le plus dur... mais pas le dernier geste.' },
  ],
  pre_defense: [
    { text: '{attacker} de {opponent} surgit de nulle part, frappe croisee !' },
    { text: 'Corner pour {opponent}, {attacker} monte, attention au duel aerien !' },
    { text: 'Contre-eclair de {opponent}, {attacker} fonce seul vers le but...' },
    { text: '{attacker} arme une frappe lourde, {team} doit defendre !' },
    { text: '{opponent} multiplie les appels, le danger arrive de partout.' },
    { text: 'Le ballon traine dans la surface de {team}, il faut degager !' },
    { text: '{attacker} a mange des epinards ce matin. Ca se voit.', funny: true },
  ],
  defense_success: [
    { text: 'Arret decisif ! {team} repousse le danger.' },
    { text: '{attacker} est stoppe net par la defense de {team}.' },
    { text: 'Quel reflexe ! Le but semblait pourtant certain.' },
    { text: '{team} reste compact et ne laisse rien passer.' },
    { text: 'Intervention parfaite, {opponent} doit tout recommencer.' },
    { text: 'La defense gagne son duel au meilleur moment !' },
  ],
  defense_fail: [
    { text: '{opponent} marque malgre le retour de la defense !' },
    { text: '{attacker} trouve la faille, le score bascule.' },
    { text: 'Trop tard : le ballon termine au fond des filets.' },
    { text: '{team} a ete pris de vitesse sur cette action.' },
    { text: 'Le tir de {attacker} etait beaucoup trop puissant.' },
    { text: "{opponent} profite de l'espace et ne pardonne pas." },
  ],
}

export type CommentaryTokens = {
  attacker: string
  defender: string
  team: string
  opponent: string
}

export function getCommentary(
  phase: CommentaryPhase,
  team: Team,
  opponent: Team,
): { text: string; tokens: string[] } {
  const pool = COMMENTARY_TEMPLATES[phase]
  const template = pool[Math.floor(Math.random() * pool.length)]
  const attacker = team.players?.[Math.floor(Math.random() * team.players.length)] ?? `un joueur de ${team.shortName}`
  const defender = opponent.players?.[0] ?? `le gardien de ${opponent.shortName}`
  const values: CommentaryTokens = {
    attacker,
    defender,
    team: team.name,
    opponent: opponent.name,
  }
  const text = template.text.replace(/\{(attacker|defender|team|opponent)\}/g, (_, key: keyof CommentaryTokens) => values[key])
  return { text, tokens: Object.values(values) }
}
