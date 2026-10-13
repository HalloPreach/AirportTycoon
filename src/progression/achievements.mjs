// T2-2 (t_6344db94) — SUCCÈS (achievements) DÉBLOCABLES : 8 succés à
// conditions MESURABLES dans l'état sim (règle R21 : chaque condition lit
// un fait de la sim — jamais un compteur abstrait ni un timer). Le champ
// vit sur la SIM (sim.achievements — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : un succès DÉBLOQUÉ reste débloqué après
// sauvegarde/rechargement). Un déblocage pousse UN événement
// « achievement-unlocked » (toast/juice/sfx) — et JAMAIS UN SECONDF (le
// flag `unlocked` verrouille, comme le `paid` des objectifs R22).
// LA RÈGLE est décidée par tickAchievements (la sim, tick par tick), pas
// par l'UI : le panneau est une LECTURE (achievementsView).
import { qualityTier } from './quality.mjs'; // paliers QUALITÉ (R21) — mesure live
import { punctualityStats } from '../sim/aircraft.mjs'; // la mesure R17 (le palier n'est VRAI que mesuré)
import { pushEvent } from '../core/sim-state.mjs'; // l'événement de déblocage

// Les 8 SUCCÈS : chaque condition est une LECTURE de la sim (pas de
// mutation) — la sim est la source, le succès est la conséquence affichée.
// Les identifiants sont STABLES (sérialisés sur sim.achievements.unlocked) :
// une sauvegarde d'une partie en cours reprend les succès déjà débloqués.
export const ACHIEVEMENTS = Object.freeze([
  {
    id: 'pax-100', name: 'Premiers pas',
    desc: 'Transporter 100 passagers',
    cond: (sim) => (sim.passengers?.totalCarried ?? 0) >= 100, // compteur EXISTANT
  },
  {
    id: 'pax-500', name: 'Affluence',
    desc: 'Transporter 500 passagers',
    cond: (sim) => (sim.passengers?.totalCarried ?? 0) >= 500,
  },
  {
    // UNE période close avec net > 0 (la mesure est le net de la période —
    // periodStatement, economy.mjs) : le BÉNÉFICE est un fait du bilan.
    id: 'profit-period', name: 'Premier bénéfice',
    desc: 'Clôturer une période avec un bénéfice',
    cond: (sim) => sim._nonNegPeriod || (sim.economy?.periods || []).some((p) => (p?.net ?? 0) > 0),
  },
  {
    id: 'balance-50k', name: 'Réserve',
    desc: 'Atteindre un solde de 50 000 $',
    cond: (sim) => (sim.economy?.money ?? 0) >= 50000,
  },
  {
    // 6 périodes CONSECUTIVES sans déficit (la série persiste dans
    // sim.stats — stats.mjs, alimentée par la seule close de période) :
    // la CONSTANCE, pas un compteur de temps.
    id: 'streak-6', name: 'Constance',
    desc: 'Enchaîner 6 périodes sans déficit',
    cond: (sim) => (sim.stats?.nonDeficit?.best ?? 0) >= 6,
  },
  {
    // 5 incidents TERMINÉS pendant que le jeu continuait (stats.mjs — la
    // transition d'actifs → survivus, incidents.mjs est la source) :
    // la RÉSILIENCE face aux aléas (R32 : la fréquence des incidents est
    // l'aléa du jeu).
    id: 'survivor-5', name: 'Résilience',
    desc: 'Survivre à 5 incidents',
    cond: (sim) => (sim.stats?.incidentsSurvived ?? 0) >= 5,
  },
  {
    // Le palier QUALITÉ est OFFERT (R21 : les 3 tailles sont offertes — la
    // mesure est le palier quality, jamais un compteur de pax) : l'EXCELLENCE.
    // Le palier ne compte que MESURÉ (une fin de vol dans la fenêtre R17 —
    // punctualityStats) : une sim neuve démarre q = 1 (« départ neuf ») —
    // sans mesure réelle, le palier est un état de départ, pas un fait.
    id: 'quality-2', name: 'Excellence',
    desc: 'Offrir les 3 tailles (palier qualité, mesuré)',
    cond: (sim) => qualityTier(sim) >= 2 && punctualityStats(sim).total > 0,
  },
  {
    // La VICTOIRE de la campagne (campaign.mjs) : le but global du jeu.
    id: 'season-won', name: 'Saison remportée',
    desc: 'Remporter la saison (3 contrats réussis)',
    cond: (sim) => sim.campaign?.status === 'won',
  },
]);

function fresh() {
  // id → horodatage du déblocage (sim.time). Le format est borné : un champ
  // présent mais au mauvais format est reconstruit (pattern R31/R32) —
  // jamais de crash, les succès se PERDENT proprement (compteurs perdus).
  return { unlocked: {} };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32).
// Sauvegarde PRÉ-T2-2 : le champ est ABSENT → aucun succès débloqué (une
// partie ancienne reprend exactement comme avant, pas de faux déblocage).
export function ensureAchievements(sim) {
  const a = sim.achievements;
  const ok = a && typeof a === 'object'
    && a.unlocked && typeof a.unlocked === 'object'
    && Object.values(a.unlocked).every((v) => v === true || Number.isFinite(v));
  if (!ok) sim.achievements = fresh();
  return sim.achievements;
}

// LE tick succès (la sim, après les autres ticks — il lit campagne, stats,
// palier qualité : les FAITS de ce tick sont déjà posés) : pour chaque
// succès NON débloqué dont la condition est VRAIE → déblocage ATOMIQUE
// (flag + événement dans la même écriture) ; l'événement « achievement-
// unlocked » porte le nom + la description (le toast) — et JAMAIS UN
// SECONDF (le flag verrouille, idempotent comme le `paid` des objectifs).
export function tickAchievements(sim) {
  const a = ensureAchievements(sim);
  for (const c of ACHIEVEMENTS) {
    if (a.unlocked[c.id] !== undefined) continue; // déjà débloqué (jamais re)
    if (!c.cond(sim)) continue; // condition non remplie : jamais de faux
    a.unlocked[c.id] = sim.time; // l'horodatage du déblocage (sérialisé)
    pushEvent(sim, { kind: 'achievement-unlocked', id: c.id, name: c.name, desc: c.desc });
  }
}

// LECTURE seule (panneau) : la liste des succès + leur état (débloqué à
// quel temps / à venir) — le panneau ne décide rien (la sim a déjà décidé).
export function achievementsView(sim) {
  const a = ensureAchievements(sim);
  return ACHIEVEMENTS.map((c) => ({
    id: c.id, name: c.name, desc: c.desc,
    unlocked: a.unlocked[c.id] !== undefined,
    at: a.unlocked[c.id],
  }));
}

// Nombre de succès DÉBLOQUÉS (lecture — le panneau affiche « n/8 »).
export function unlockedCount(sim) {
  return Object.keys(ensureAchievements(sim).unlocked).length;
}
