// R23 (t_c992b7d6) : les déblocages se DECIDENT ici — UN seul module de règle.
// Les anciens seuils 100–300 pax (catalog.mjs UNLOCKS) sont remplacés par des
// CONDITIONS MESURABLES dans l'état sim : le service se découvre quand le
// BESOIN existe (tiers.mjs) — jamais « pour maintenir un service verrouillé »
// (pas de dépendance circulaire : aucune condition ne fait référence à un
// service non encore débloqué).
//
//   fuel      : le carburant se débloque AVANT que le besoin se fasse sentir —
//              une offre de vol est en vue ET une période close net ≥ 0
//              (l'activité est en train de justifier le carburant, pas après).
//   cleaning  : l'usure « sale » a commencé à compter : une porte a dépassé
//              le seuil 10 (GATE_WEAR_PER_SEC, 20 s amarré : le besoin existe).
//   hangar    : l'usure mécanique a commencé à compter (g.maintenance ≥ 10).
//   baggage   : les VOLUMES justifient le débit : file check-in ≥ 90 pax
//              (75 % de la capacité 120 : le goulou de base se voit), ou
//              400 pax transportés (les volumes cumulés).
//   catering  : le confort de salle : 300 pax transportés (les volumes
//              justifient la dépense de confort ; tiers 2).
//
// Déclenchement : tickUnlocks (core/tick.mjs, UNE fois par tick) — le service
// se débloque au premier tick où la condition est vraie ; le build-tool et la
// sim consultent unlockState (MÊME code des deux côtés : jamais deux règles).
// L'événement « unlocked » est émis UNE fois (flag sim._unlocked, sérialisable
// → la reprise ne re-notifie pas). « locked » = condition NON remplie ;
// l'UI affiche condition + bénéfice À L'AVANCE (unlockView, tiers.mjs).
//
// Les CHIFFRES vivent dans UNLOCK_RULES (catalog.mjs) — équilibrage, pas de
// logique. L'usure porte se lit via les champs g.cleaning / g.maintenance
// (sim-state.mjs, sérialisés) ; la capacité check-in est 120 par terminal
// (passengers.mjs PAX.checkinCapPerTerminal).
import { UNLOCK_RULES } from '../data/catalog.mjs';
import { lastPeriod } from '../economy/economy.mjs';
import { punctualityStats } from '../sim/aircraft.mjs';
import { pushEvent } from '../core/sim-state.mjs';

// Capacité check-in de base (par terminal, sans service bagages).
const CHECKIN_CAP = 120;

// La condition MESURABLE de chaque service. Renvoie true ⇔ le besoin existe.
const CONDS = Object.freeze({
  fuel(sim) {
    const e = sim.economy;
    const period = (lastPeriod(sim) || { net: 0 }).net >= 0;
    const offering = sim.planning.some((p) => p.status === 'planned')
      || sim.aircraft.length > 0;
    return period && offering;
  },
  cleaning(sim) {
    return sim.infra.gates.some((g) => (g.cleaning ?? 0) >= UNLOCK_RULES.cleaning.wear);
  },
  hangar(sim) {
    return sim.infra.gates.some((g) => (g.maintenance ?? 0) >= UNLOCK_RULES.hangar.wear);
  },
  // ponytail: seuil check-in FIXE (120, 1 terminal) — le test du 2e terminal
  // ajusterait checkinCap(sim) ; upgrade si on multiplie les terminaux dans la
  // validation du tiers 2. La branche totalCarried est le filet : un aéroport
  // sans file ne se bloque jamais.
  baggage(sim) {
    const p = sim.passengers;
    const over = Math.max(0, (p.queue?.checkin ?? 0) - CHECKIN_CAP * sim.infra.terminals.length);
    return over >= UNLOCK_RULES.baggage.queue
      || p.totalCarried >= UNLOCK_RULES.baggage.carried;
  },
  catering(sim) {
    return sim.passengers.totalCarried >= UNLOCK_RULES.catering.carried;
  },
});

// État lisible d'un service : { unlocked, why? } — le « why » est le BÉNÉFICE
// + la condition restante (l'UI l'affiche à l'avance ; UNLOCK_RULES porte les
// textes — équilibrage, pas de logique).
export function unlockState(sim, service) {
  const rule = UNLOCK_RULES[service];
  if (!rule) return { unlocked: true }; // pas de règle (base, piste, terminal) : toujours
  if (sim._unlocked?.[service]) return { unlocked: true }; // déjà déclenché (flag persistant)
  if (CONDS[service](sim)) return { unlocked: true };
  return { unlocked: false, why: `${rule.benefit} — ${rule.why}` };
}

// Bascule le service au premier tick où la condition est vraie (UNIQUE appelant :
// tickUnlocks, core/tick.mjs). Événement « unlocked » UNE fois (flag persistant)
// : le BÉNÉFICE (pourquoi acheter) + la note de ponctualité (la MESURE, pas un
// compteur de temps).
export function tickUnlocks(sim) {
  for (const service of Object.keys(UNLOCK_RULES)) {
    if (sim._unlocked?.[service]) continue;
    if (!CONDS[service](sim)) continue;
    sim._unlocked = sim._unlocked || {};
    sim._unlocked[service] = true;
    const rule = UNLOCK_RULES[service];
    const stat = punctualityStats(sim); // null = aucun vol terminé (pas de faux chiffre)
    pushEvent(sim, {
      kind: 'unlocked', service, name: rule.name,
      why: rule.benefit,
      detail: stat?.rate != null ? `ponctualité : ${Math.round(stat.rate * 100)} %` : undefined,
    });
  }
}

// Vue lisible pour l'UI (bénéfice + condition restante) — lecture SEULE, pas
// de règle. Les verrouillés : « Nom : BÉNÉFICE — condition » ; les débloqués
// : un point résumé.
export function unlockView(sim) {
  const lines = [];
  const done = [];
  for (const [service, rule] of Object.entries(UNLOCK_RULES)) {
    const st = unlockState(sim, service);
    if (st.unlocked) { done.push(rule.name); continue; }
    lines.push(`${rule.name} : ${st.why}`);
  }
  if (done.length) lines.unshift(`débloqué(s) : ${done.join(', ')}`);
  if (!lines.length) lines.push('tous les services sont débloqués');
  return lines;
}
