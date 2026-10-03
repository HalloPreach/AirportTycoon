// R22 (t_00318fe0) — les 2 objectifs de progression (tiers.mjs R21) + la
// récompense payée UNE fois. L'état vit sur `sim.objectives` (sérialisé avec
// la sim → une récompense payée reste payée APRÈS sauvegarde + reprise ;
// l'identifiant est PERSISTANT). La récompense est payée ATOMIQUEMENT dans
// `tickObjectives` : le flag `paid` et le crédit cash (`earn`) sont posés dans
// la MÊME écriture — pas d'état intermédiaire, pas de double paiement.
//
// Règle R21 respectée : chaque objectif est une CONDITION MESURABLE dans
// l'état sim (jamais « atteindre X passagers ») :
//   O1 : un cycle de vol complet SANS départ sec (l'avion pose
//        `sim._cleanCycle = true` au décollage propre, aircraft.mjs) ET une
//        période close net ≥ 0 (flag `sim._nonNegPeriod`, posé ici tant que
//        la période est dans la fenêtre des 4 dernières — R14 borne à la
//        racine, pas de journal sans fin).
//   O2 : PENDANT un pic de demande (surge, BL-14), la ponctualité est
//        restaurée : le taux « à l'heure » de la fenêtre bornée R17 (30 min)
//        est ≥ 50 %. Sans vol fini dans la fenêtre, rate = null → pas atteint
//        (pas de faux chiffre, R16).
// Compteur temporaire documenté : le panneau n'affiche que l'état (atteint /
// payé) + la ponctualité live — aucun compteur « secondes attendues » n'est
// ajouté (les durées sont des cibles d'équilibrage R37, pas des critères).
import { earn, lastPeriod } from '../economy/economy.mjs';
import { punctualityStats } from '../sim/aircraft.mjs';
import { isSurge } from '../sim/incidents.mjs';
import { pushEvent } from '../core/sim-state.mjs';

// Récompenses (le jeu sait payer en cash ; montants de l'équilibre R22).
export const OBJECTIVES = Object.freeze([
  { id: 'o1-cycle', name: 'Premier cycle avec plein', reward: 1000,
    desc: 'Un vol complet sans départ sec (carburant plein au décollage) et une période close net ≥ 0.' },
  { id: 'o2-surge', name: 'Pic de demande absorbé', reward: 1500,
    desc: 'Pendant un pic de demande, la ponctualité est restaurée (≥ 50 % des fins de vol récentes à l’heure).' },
]);

// État de progression : initialisation paresseuse (pattern sim.punctuality) —
// une sauvegarde ancienne ou une nouvelle partie n'ont pas le champ, le 1er
// tick le crée. `paid` absent (sauvegarde très ancienne) → false.
export function ensureObjectives(sim) {
  if (!Array.isArray(sim.objectives)) {
    sim.objectives = OBJECTIVES.map((o) => ({ id: o.id, paid: false }));
  }
  for (const o of sim.objectives) if (o.paid === undefined) o.paid = false;
  return sim.objectives;
}

// Condition O1 : cycle propre (flag posé par aircraft.mjs au décollage SANS
// _dryDeparture) ET au moins une période close net ≥ 0. Le flag
// `_nonNegPeriod` est posé ICI tant que la période concernée est dans la
// fenêtre des 4 dernières (bornée, R14) — il persiste ensuite : l'état « une
// période net ≥ 0 existe » est booléen, pas un historique.
function condO1(sim) {
  // « AU MOINS UNE » période close net ≥ 0 : on scanne la fenêtre bornée des
  // périodes (4 dernières, R14) tant qu'elle est là, puis le flag `_nonNegPeriod`
  // (posé ICI, jamais effacé) garde l'état après rotation de la fenêtre — pas
  // d'historique sans fin.
  const periods = sim.economy.periods;
  if (Array.isArray(periods) && periods.some((p) => p.net >= 0)) sim._nonNegPeriod = true;
  return sim._cleanCycle === true && sim._nonNegPeriod === true;
}

// Condition O2 : pendant le pic, la ponctualité (fenêtre bornée R17) est
// restaurée — taux « à l'heure » (départs à retard ≤ rotation nominale,
// annulations comptées) ≥ 50 %. rate = null : aucun vol fini dans la fenêtre
// → condition non remplie (jamais un faux chiffre).
function condO2(sim) {
  const rate = punctualityStats(sim).rate;
  return isSurge(sim) && rate !== null && rate >= 0.5;
}

const CONDS = Object.freeze({ 'o1-cycle': condO1, 'o2-surge': condO2 });

// Évaluation + paiement (appelée par tick, après tickEconomy/tickIncidents).
// Un objectif non payé dont la condition est remplie est payé ATOMICEMENT :
// `paid = true` + crédit dans la même écriture → la récompense ne se paie
// jamais deux fois (l'id persiste dans la sauvegarde, EV-10).
export function tickObjectives(sim) {
  if (sim.economy?.bankrupt) return; // la sim est stoppée
  for (const st of ensureObjectives(sim)) {
    if (st.paid) continue;
    const def = OBJECTIVES.find((o) => o.id === st.id);
    const cond = CONDS[st.id];
    if (!def || !cond || !cond(sim)) continue;
    st.paid = true;
    earn(sim, def.reward, 'reward'); // crédite le montant (compte revenue.reward)
    pushEvent(sim, { kind: 'objective-paid', id: def.id, name: def.name, reward: def.reward });
  }
}

// Lecture pour le panneau (UI fine : le panneau n'appelle jamais tickObjectives).
// `state` : 'payée' | 'atteinte' (condition vraie, paiement au prochain tick)
// | 'à venir'. `detail` : la mesure live (le compteur temporaire documenté).
export function objectiveView(sim, id) {
  const o = OBJECTIVES.find((x) => x.id === id);
  if (!o) return null;
  const st = ensureObjectives(sim).find((x) => x.id === id);
  const paid = st ? st.paid : false;
  if (paid) return { ...o, state: 'payée', detail: `récompense ${o.reward} $ payée` };
  if (id === 'o1-cycle') {
    const p = lastPeriod(sim);
    const parts = [];
    parts.push(sim._cleanCycle ? 'cycle avec plein : oui' : 'cycle avec plein : non');
    const net = sim._nonNegPeriod || (p && p.net >= 0);
    parts.push(net ? 'période net ≥ 0 : oui' : 'période net ≥ 0 : non');
    return { ...o, state: 'à venir', detail: parts.join(' ; ') };
  }
  if (id === 'o2-surge') {
    const s = punctualityStats(sim);
    if (!isSurge(sim)) return { ...o, state: 'à venir', detail: 'en attente d’un pic de demande' };
    const d = s.total ? `ponctualité pendant le pic : ${Math.round(s.rate * 100)} % (${s.onTime}/${s.total})`
                     : 'pic en cours, aucun vol fini dans la fenêtre';
    return { ...o, state: s.rate !== null && s.rate >= 0.5 ? 'atteinte' : 'à venir', detail: d };
  }
  return { ...o, state: 'à venir', detail: '' };
}
