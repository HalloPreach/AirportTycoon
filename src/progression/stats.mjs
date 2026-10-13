// T2-2 (t_6344db94) — STATS PERSISTANTES de la partie : pax totaux,
// bénéfice, plus longue série de périodes sans déficit, incidents survivus.
// Le champ vit sur la SIM (sim.stats — sérialisé avec l'état entier par
// save.mjs, pattern intro.mjs : il REPREND après sauvegarde/rechargement ;
// une sauvegarde PRÉ-T2-2 n'a pas le champ → il est créé paresseusement,
// sans crash, sans fausse reprise de compteurs).
// RÈGLE DE L'ÉQUIPE : JAMAIS DE SECOND COMPTEUR PARALLÈLE — les mesures
// « live » LISENT les compteurs existants (pax = sim.passengers.totalCarried,
// bénéfice = les comptes cumulés de l'économie), seuls les faits NOUVEAUX
// (une période close, un incident terminé) sont enregistrés ici, UNE fois,
// sur leur SEUL déclencheur (le tick — jamais par l'UI).
//   - Série sans déficit : une période CLOSE nette ≥ 0 prolonge la série,
//     une période nette < 0 la remet à 0 (lastPeriod / periodStatement sont
//     LA mesure, economy.mjs).
//   - Incidents survivus : une transition N → M < N d'incidents ACTIFS
//     (piste fermée / station en panne / pic — incidents.mjs) = N−M
//     incidents TERMINÉS = N−M incidents SURVIVUS (le jeu a continué).
import { lastPeriod } from '../economy/economy.mjs';

// Nombre d'incidents ACTIFS (lecture seule, incidents.mjs est la source) :
// chaque piste FERMÉE (remaining > 0) + chaque station EN PANNE (remaining >
// 0) + le pic (surge) actif. Un incident « survécu » = un actif qui a
// REPRIS (remaining → 0) ou le pic qui est passé — le JEU a continué.
export function activeIncidentCount(sim) {
  const i = sim.incidents || {};
  let n = 0;
  for (const r of Object.values(i.runways || {})) if (r && r.remaining > 0) n += 1;
  for (const f of Object.values(i.fuels || {})) if (f && f.remaining > 0) n += 1;
  if (i.surge?.active) n += 1;
  return n;
}

function fresh() {
  return {
    nonDeficit: { current: 0, best: 0 }, // périodes CONSECUTIVES net ≥ 0
    incidentsSurvived: 0,   // incidents qui se sont TERMINÉS (le jeu a tenu)
    periodsClosed: 0,       // périodes closes depuis le début de la partie
    lastPeriodAt: null,     // horodatage de la dernière période close (détect.)
    prevIncidents: null,    // précédent nombre d'actifs (détect. des transitions)
  };
}

// Initialisation paresseuse + RÉPARATION défensive (pattern R31/R32 : un
// champ présent mais au mauvais format est reconstruit — jamais de crash ;
// les compteurs de stats se PERDENT proprement, comme les incidents purgeés).
// À la CRÉATION, ADOPTION de la baseline : une période DÉJÀ close (sauvegarde
// PRÉ-T2-2 rechargée) est NOTÉE comme « déjà vue » — la série se compte à
// partir de la PROCHAINE période close, pas un fait réinventé ; sur une sim
// FRAÎCHE (aucune période close), rien n'est à adopter (le 1er close compte).
export function ensureStats(sim) {
  const s = sim.stats;
  const ok = s && typeof s === 'object'
    && s.nonDeficit && typeof s.nonDeficit === 'object'
    && Number.isInteger(s.nonDeficit.current) && s.nonDeficit.current >= 0
    && Number.isInteger(s.nonDeficit.best) && s.nonDeficit.best >= 0
    && (Number.isInteger(s.incidentsSurvived) && s.incidentsSurvived >= 0)
    && (s.lastPeriodAt === null || Number.isFinite(s.lastPeriodAt))
    && (s.prevIncidents === null || Number.isInteger(s.prevIncidents));
  if (!ok) {
    const f = fresh();
    const lp = lastPeriod(sim);
    if (lp && Number.isFinite(lp.at)) f.lastPeriodAt = lp.at; // adoption
    f.prevIncidents = activeIncidentCount(sim); // baseline des transitions
    sim.stats = f;
    return sim.stats;
  }
  if (!Number.isInteger(s.periodsClosed) || s.periodsClosed < 0) s.periodsClosed = 0;
  return s;
}

// UNE période close (appelée par le tick sur sa SEULE détection) : la série
// sans déficit se prolonge (net ≥ 0) ou se rompt (net < 0) — LA mesure est
// le net de la période (periodStatement), jamais un compteur de temps.
function notePeriodClose(sim, p) {
  const st = ensureStats(sim);
  st.nonDeficit.current = (p.net ?? 0) >= 0 ? st.nonDeficit.current + 1 : 0;
  st.nonDeficit.best = Math.max(st.nonDeficit.best, st.nonDeficit.current);
}

// LE tick stats (après tickEconomy — la période close vient d'avoir lieu) :
//   1. DÉTECTION d'une période close : l'horodatage `at` de la DERNIÈRE
//      période a changé (l'array est borné MAX_PERIODS : la détection par
//      longueur serait Fausse au-delà — l'horodatage est la mesure unique).
//      L'adoption de la baseline (sauvegarde PRÉ-T2-2) est faite à la
//      CRÉATION (ensureStats), jamais ici : une fois le champ posé, toute
//      nouvelle période close EST comptée.
//   2. TRANSITIONS d'incidents : N actifs → M < N = N−M incidents survivus
//      (comptés UNE fois sur la transition — jamais par l'UI).
export function tickStats(sim) {
  const st = ensureStats(sim);
  const lp = lastPeriod(sim);
  if (lp && Number.isFinite(lp.at) && lp.at !== st.lastPeriodAt) {
    notePeriodClose(sim, lp);
    st.periodsClosed += 1;
    st.lastPeriodAt = lp.at;
  }
  const n = activeIncidentCount(sim);
  if (st.prevIncidents === null) {
    st.prevIncidents = n; // baseline (1er tick d'un champ créé « vide »)
  } else if (n < st.prevIncidents) {
    st.incidentsSurvived += st.prevIncidents - n;
    st.prevIncidents = n;
  } else {
    st.prevIncidents = n;
  }
}

// BÉNÉFICE CUMULÉ de la partie (mesure live des comptes — pas un 2e
// compteur) : la SOMME des mêmes comptes que periodStatement.net, sur
// TOUS les compteurs cumulés depuis le début (recettes + principal
// emprunté − dépenses − intérêts du compte dédié `debt`, R12/R35) :
// l'identité trésorerie EV-9 tient (money = START + recettes − dépenses
// − dette), la faillite N'ÉTEINT PAS les compteurs (R35) → le bénéfice
// est CUMULÉ sur toute la partie.
export function profitOf(sim) {
  const e = sim.economy || {};
  const rev = Object.values(e.revenue || {}).reduce((a, b) => a + (b || 0), 0);
  const spent = Object.values(e.spent || {}).reduce((a, b) => a + (b || 0), 0);
  const loan = e.loan && Number.isFinite(e.loan.principal) ? e.loan.principal : 0; // R35
  return rev + loan - spent - (e.debt || 0); // intérêts = le compte dédié (R12)
}

// LECTURE seule (panneau) : les stats persistantes + les mesures live
// (pax = le compteur EXISTANT totalCarried, bénéfice = profitOf) — le
// panneau ne recalcule rien, il affiche (la sim est la source).
export function statsView(sim) {
  const st = ensureStats(sim);
  return {
    paxTotal: sim.passengers?.totalCarried ?? 0, // compteur EXISTANT (lecture)
    profit: Math.round(profitOf(sim)),
    nonDeficit: { current: st.nonDeficit.current, best: st.nonDeficit.best },
    incidentsSurvived: st.incidentsSurvived,
    periodsClosed: st.periodsClosed,
  };
}
