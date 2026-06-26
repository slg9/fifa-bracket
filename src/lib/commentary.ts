import type { CommentaryPhase, Team } from '../types'

export type CommentaryTemplate = { text: string; funny?: boolean }
export type { CommentaryPhase }

export const COMMENTARY_TEMPLATES: Record<CommentaryPhase, CommentaryTemplate[]> = {
  pre_attack: [
    { text: '{attacker} prend le ballon : slalom obligatoire entre les defenseurs !' },
    { text: '{attacker} attaque la ligne, il faut passer dans les portes vertes.' },
    { text: 'La defense de {opponent} descend vite : {attacker} doit enchainer les dribbles.' },
    { text: "{attacker} provoque balle au pied, crochet gauche ou crochet droit ?" },
    { text: '{team} lance le raid : {attacker} doit eliminer les defenseurs avant la frappe.' },
    { text: 'Couloir ferme, espace au centre : {attacker} doit trouver la porte verte.' },
    { text: '{attacker} a mis les crampons turbo. Maintenant il faut dribbler propre.', funny: true },
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
  forcedAttacker?: string,
): { text: string; tokens: string[] } {
  const pool = COMMENTARY_TEMPLATES[phase]
  const template = pool[Math.floor(Math.random() * pool.length)]
  const isDefensePhase = phase === 'pre_defense' || phase === 'defense_success' || phase === 'defense_fail'
  const attackingTeam = isDefensePhase ? opponent : team
  const defendingTeam = isDefensePhase ? team : opponent
  const attacker = forcedAttacker ?? attackingTeam.players?.[Math.floor(Math.random() * attackingTeam.players.length)] ?? `un joueur de ${attackingTeam.shortName}`
  const defender = defendingTeam.players?.[0] ?? `le gardien de ${defendingTeam.shortName}`
  const values: CommentaryTokens = {
    attacker,
    defender,
    team: team.name,
    opponent: opponent.name,
  }
  const text = template.text.replace(/\{(attacker|defender|team|opponent)\}/g, (_, key: keyof CommentaryTokens) => values[key])
  return { text, tokens: Object.values(values) }
}
