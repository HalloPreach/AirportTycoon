// R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION DE CAPACITÉ CIBLÉE par terminal —
// le module de RÈGLE UNIQUE : les MULTIPLICATEURS (capacités, temps de plein,
// débit équipes) vivent ICI, jamais ailleurs (un seul endroit, comme
// countTypeServing pour les services). Les CHIFFRES (coûts, % par niveau,
// max) sont dans catalog.mjs UPGRADES (équilibrage, pas de logique).
//
// L'ÉTAT : sim.upgrades[terminalId] = { terminal: n, fueling: n, teams: n }
// (clés CHAÎNES — comme sim.passengers.queues, R30). Le niveau est la source
// (sérialisé : la reprise RESTITUE niveau ET coût déjà payé — on ne
// re-débite JAMAIS au chargement). Absent = niveau 0 (sauvegarde ancienne).
//
// Le « MAUVAIS ACHAT » reste compréhensible : bottleneckView (lecture seule,
// l'UI l'affiche AVANT achat) montre le goulot courant du terminal —
// les files (check-in/sécurité/attente par pax), l'usure porte, le plein.
// Acheter la capacité du BON goulot améliore sa mesure ; la mauvaise ne
// sert rien, et l'écran le dit.
import { UPGRADES } from '../data/catalog.mjs';
import { pushEvent } from '../core/sim-state.mjs';
import { countTypeServing } from './assignments.mjs';

// État des améliorations (tolère les sauvegardes anciennes — absent = 0).
// Crée l'entrée DU TERMINAL si absente (l'achat écrit sim.upgrades[tid][kind]).
export function ensureUpgrades(sim) {
  sim.upgrades = sim.upgrades || {};
  return sim.upgrades;
}

// Le NIVEAU courant d'un type d'amélioration d'un terminal (absent = 0).
export function upgradeLevel(sim, terminalId, kind) {
  const t = ensureUpgrades(sim)[String(terminalId)];
  return (t && t[kind]) || 0;
}

// --- MULTIPLICATEURS — les UNIQES lecteurs du niveau. La sim ne lit JAMAIS
// sim.upgrades directement : elle passe par ces 3 fonctions (un seul point
// d'effet, testable ; la même règle côté sim et… c'est tout).

// (1) Terminal : le multiplicateur de CAPACITÉ check-in/sécurité du terminal
// (1 + capMultPerLevel × niveau). Le cap courant = base × ce facteur
// (passengers.mjs checkinCap/securityCap).
export function capMult(sim, terminalId) {
  const spec = UPGRADES.terminal;
  return 1 + spec.capMultPerLevel * upgradeLevel(sim, terminalId, 'terminal');
}

// (2) Avitaillement : le facteur TEMPS de PLEIN du terminal (0.75^niveau).
// Le PLEIN s'accélère ; la SATURATION (nombre de lances) ne change PAS —
// c'est le débit du goulot, pas la file.
export function refuelTimeMult(sim, terminalId) {
  const spec = UPGRADES.fueling;
  return Math.pow(1 - spec.timeMultPerLevel, upgradeLevel(sim, terminalId, 'fueling'));
}

// (3) Équipes : le facteur DÉBIT de nettoyage/remise à zéro par équipe du
// terminal (2^niveau). L'usure s'accumule à un rythme constant ; le débit
// double par niveau → moins de délai (R29 : le débit est limité, la
// priorité est explicite — le facteur agit sur le DÉBIT, pas sur la règle).
export function teamRateMult(sim, terminalId) {
  const spec = UPGRADES.teams;
  return Math.pow(1 + spec.rateMultPerLevel, upgradeLevel(sim, terminalId, 'teams'));
}

// --- ACHAT — commande métier (l'UI envoie l'intention, la règle décide).
// Coût FIXE (UPGRADES[kind].cost par niveau) ; refus lisible (niveau max,
// pas d'argent, terminal inconnu). L'effet est IMMÉDIAT (les multiplicateurs
// sont lus à chaque tick — pas d'état parallèle).
export function buyUpgrade(sim, terminalId, kind) {
  const spec = UPGRADES[kind];
  if (!spec) return { ok: false, why: 'amélioration inconnue' };
  const term = sim.infra.terminals.find((t) => String(t.id) === String(terminalId));
  if (!term) return { ok: false, why: 'terminal inconnu' };
  const lvl = upgradeLevel(sim, term.id, kind);
  if (lvl >= spec.maxLevel) return { ok: false, why: `niveau maximal atteint (${spec.maxLevel})` };
  if (sim.economy.money < spec.cost) {
    pushEvent(sim, { kind: 'no-funds', cost: spec.cost, type: kind });
    return { ok: false, why: `pas assez d'argent (${spec.cost} $)` };
  }
  sim.economy.money -= spec.cost;
  sim.economy.spent.construction = (sim.economy.spent.construction ?? 0) + spec.cost; // BL-15 : compte dédié
  const up = ensureUpgrades(sim);
  (up[String(term.id)] = up[String(term.id)] || {})[kind] = lvl + 1;
  pushEvent(sim, { kind: 'upgraded', type: kind, terminalId: term.id, level: lvl + 1, cost: spec.cost, name: spec.name });
  return { ok: true, level: lvl + 1, cost: spec.cost };
}

// --- VUE LISIBLE (lecture seule) — l'UI affiche les 3 choix + le GOUTLE
// COURANT du terminal AVANT achat. « Mauvais achat compréhensible » :
// le goulot nommé est le motif (acheter l'autre capacité ne sert rien).
export function upgradeView(sim, terminalId) {
  const term = sim.infra.terminals.find((t) => String(t.id) === String(terminalId));
  if (!term) return null;
  const q = sim.passengers?.queues?.[String(term.id)] || { checkin: 0, security: 0, board: 0 };
  // Goulot du terminal (mesures COURANTES — pas de projection) :
  //   files : les pax EN FILE (le terminal dévide au débit courant) ;
  //   usure  : la somme d'usure des portes (l'équipe la remet à zéro) ;
  //   plein  : le temps de plein courant (lances du terminal + facteur).
  const gates = sim.infra.gates.filter((g) => String(g.terminalId) === String(term.id));
  const wear = gates.reduce((s, g) => s + (g.cleaning ?? 0) + (g.maintenance ?? 0), 0);
  const fuelTeams = countTypeServing(sim, 'fuel', term.id);
  const cleanTeams = countTypeServing(sim, 'cleaning', term.id);
  const hangarTeams = countTypeServing(sim, 'hangar', term.id);
  // Le GOUTLE = la mesure la plus chargée : files (pax), usure (points),
  // plein (s). Les pax en file = le goulot « terminal » ; l'usure = « équipes » ;
  // le plein (aucune lance libre) = « avitaillement ».
  const inQueue = q.checkin + q.security + q.board;
  const bottleneck =
    inQueue >= wear && inQueue >= 0 ? (inQueue > 0 ? 'files' : (wear > 0 ? 'usure' : 'plein'))
    : (wear > 0 ? 'usure' : 'plein');
  // ponytail: heuristique simple (la plus chargée des 3 mesures) — le GOUTLE
  // est une indication lisible, pas une prédiction ; upgrade si la validation
  // du J4 montre que le joueur se trompe souvent de choix.
  const choices = Object.entries(UPGRADES).map(([kind, spec]) => {
    const lvl = upgradeLevel(sim, term.id, kind);
    return {
      kind, name: spec.name, cost: spec.cost, level: lvl, maxLevel: spec.maxLevel,
      effect: spec.effect, affordable: sim.economy.money >= spec.cost,
      useful: kind === 'terminal' && bottleneck === 'files'
        || kind === 'teams' && bottleneck === 'usure'
        || kind === 'fueling' && (bottleneck === 'plein' || inQueue === 0),
    };
  });
  return {
    terminalId: term.id,
    inQueue, wear,
    fuelTeams, cleanTeams, hangarTeams,
    // Le GOUTLE COURANT + le motif (l'UI l'affiche à côté du choix) :
    // « files » → le terminal est en attente de pax ; « usure » → les portes
    // s'usent ; « plein » → l'avitaillement est le goulot (ou rien ne presse).
    bottleneck,
    bottleneckWhy: {
      files: 'les passagers sont EN FILE (check-in/sécurité/attente) — la capacité du terminal est le goulot',
      usure: 'l\'usure des portes s\'accumule — les équipes de nettoyage/remise à zéro sont le goulot',
      plein: 'l\'avitaillement est le goulot (ou les files sont vides) — le temps de plein est le goulot',
    }[bottleneck],
    choices,
  };
}
