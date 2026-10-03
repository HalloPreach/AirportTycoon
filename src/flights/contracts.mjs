// R24 (t_f712f1a5) — contrats courts de compagnie : 3 modèles (faible volume,
// volume régulier, qualité exigeante). Un contrat définit période, quantité
// (vols + pax minimum), appareil, exigences (ponctualité), prime et pénalité
// plafonnée. Cycle : proposé → accepté → actif → réussi/échoué/annulé.
// L'état vit sur `sim.contracts` (sérialisé avec la sim → un règlement réglé
// reste réglé APRÈS sauvegarde + reprise ; idempotent, comme les objectifs R22).
// Compat (spec R24) : les recettes normales de vol restent leur mécanisme de
// base — le contrat ajoute SEULEMENT la prime (earn 'contract') ou la pénalité
// (charge 'contract-penalty', compte dédié : comptée MÊME EN DÉFICIT — D5).
// Aucun billet n'est payé deux fois (les pax payent PAX_REVENUE comme d'habitude).
// Les offres facultatives refusées ne coûtent rien (pas de pénalité, l'offre
// disparaît — le joueur peut rester sur une petite activité, tiers R21).
import { earn, charge } from '../economy/economy.mjs';
import { AIRCRAFT } from '../data/catalog.mjs'; // R25 : affichage des capacités (sièges), pas de règle
import { runwayFor } from '../infra/infra.mjs'; // R25 : critère compatibilité piste (le même que le planificateur)
import { nominalRotation } from '../sim/aircraft.mjs';
import { pushEvent } from '../core/sim-state.mjs';

// Les 3 modèles (les chiffres d'équilibrage vivent ICI, comme tiers.mjs) :
// période (s de sim), quantité (vols + pax minimum cumulés sur la période),
// appareil (une taille = une compagnie, catalog.mjs), exigence de ponctualité
// (taux minimum des fins de vol « à l'heure » du contrat ; null = aucune),
// prime payée UNE fois au succès, pénalité plafonnée payée UNE fois à l'échec.
export const CONTRACT_MODELS = Object.freeze([
  { id: 'light', name: 'Faible volume', airline: 'solaire', acType: 'small',
    period: 1800, flights: 3, minPax: 15, punctuality: 0.5,
    bonus: 800, penalty: 400,
    desc: '3 vols Cessna (petit) en 30 min — ≥ 15 pax et 50 % à l’heure. Prime 800 $ · pénalité 400 $.' },
  { id: 'regular', name: 'Volume régulier', airline: 'atlantique', acType: 'medium',
    period: 2400, flights: 4, minPax: 200, punctuality: 0.5,
    bonus: 1800, penalty: 800,
    desc: '4 vols A320 en 40 min — ≥ 200 pax et 50 % à l’heure. Prime 1 800 $ · pénalité 800 $.' },
  { id: 'quality', name: 'Qualité exigeante', airline: 'pacific', acType: 'large',
    period: 3000, flights: 3, minPax: 60, punctuality: 0.75,
    bonus: 3500, penalty: 1500,
    desc: '3 vols 747 (grand) en 50 min — ≥ 60 pax et 75 % à l’heure. Prime 3 500 $ · pénalité 1 500 $. Exige une piste ≥ 800 et des portes L.' },
]);
Object.freeze(CONTRACT_MODELS); // les modèles sont figés (le réglage passe par un nouveau module)

// Un premier contrat est PROPOSÉ quand l'aéroport tourne (≥ 300 pax
// transportés — condition MESURABLE, affichée à l'avance) ; ensuite chaque
// contrat réglé propose le suivant (cycle light → regular → quality → light…).
// Refus = gratuit (l'offre expire après OFFER_VALID_S sans décision, comme les
// offres de vol). L'aéroport ne force JAMAIS un engagement (tiers R21).
export const CONTRACT_FIRST_PAX = 300;   // condition du 1er contrat
export const CONTRACT_OFFER_VALID_S = 600; // délai de décision d'une offre (10 min sim)
export const CONTRACT_REJECT_COOLDOWN_S = 900; // trêve après un refus (15 min sim) — pas de ping
const HISTORY_MAX = 8; // borné (R14) : les contrats finis restent consultables, pas sans fin

// État : initialisation paresseuse (pattern sim.punctuality / sim.objectives) —
// une sauvegarde ancienne ou une nouvelle partie n'ont pas le champ, le 1er
// tick le crée. `settled` absent (très ancienne) → false.
export function ensureContracts(sim) {
  if (!sim.contracts || typeof sim.contracts !== 'object') {
    sim.contracts = { nextId: 1, offered: null, active: null, history: [] };
  }
  const c = sim.contracts;
  if (!Array.isArray(c.history)) c.history = [];
  if (c.active) c.active.settled = c.active.settled === true; // flag idempotent
  if (c.active) c.active.result = c.active.result || null;
  return c;
}

// Le contrat ACTIF (null sinon) — les opérations qui enregistrent leur contrat
// lisent leur taille ici (makeAircraft, flights.mjs).
export function activeContract(sim) {
  const c = ensureContracts(sim).active;
  return c && !c.settled ? c : null;
}

// Modèle de contrat par clé (catalogue, pas de chiffres dupliqués).
export function contractModel(sim, id) {
  return CONTRACT_MODELS.find((m) => m.id === (id?.model ?? id));
}

// Mesure de la période : le contrat est-il RÉUSSI à l'heure courante ? LA
// même règle que le règlement (tickContracts) — jamais deux prédictions
// divergentes (R25 : le panneau lit le verdict ici, il ne ré-impose rien).
export function contractOnTrack(c, m) {
  return c.done >= m.flights && c.pax >= m.minPax
    && (m.punctuality == null || (c.ends > 0 && c.onTime / c.ends >= m.punctuality));
}

// LECTURE pour le panneau (UI fine, pattern objectiveView) : l'état + la mesure
// live (x/y vols, pax, ponctualité, temps restant) + le prochain contrat offert.
export function contractView(sim) {
  const c = ensureContracts(sim);
  const view = (o) => {
    const m = CONTRACT_MODELS.find((x) => x.id === o.model);
    if (!m) return null;
    const rate = o.ends ? o.onTime / o.ends : null; // null = aucun vol fini (pas de faux chiffre, R16)
    return {
      id: o.id, model: m.id, name: m.name, airline: m.airline, acType: m.acType,
      done: o.done, flights: m.flights, pax: o.pax, minPax: m.minPax,
      onTime: o.onTime, ends: o.ends, rate, punctuality: m.punctuality,
      bonus: m.bonus, penalty: m.penalty, result: o.result,
      due: o.due, left: o.due != null ? Math.max(0, o.due - (sim.time ?? 0)) : null,
      desc: m.desc,
    };
  };
  const active = c.active ? view(c.active) : null;
  if (active) active.onTrack = contractOnTrack(c.active, CONTRACT_MODELS.find((x) => x.id === c.active.model));
  return {
    active,
    offered: c.offered ? { id: c.offered.id, model: c.offered.model,
      name: CONTRACT_MODELS.find((x) => x.id === c.offered.model).name,
      acType: CONTRACT_MODELS.find((x) => x.id === c.offered.model).acType,
      desc: CONTRACT_MODELS.find((x) => x.id === c.offered.model).desc,
      left: Math.max(0, c.offered.until - (sim.time ?? 0)) } : null,
    nextOfferAt: (c.offered || c.active || (c.cooldownUntil ?? 0) > (sim.time ?? 0)) ? null
                : CONTRACT_FIRST_PAX, // condition (pax) du prochain contrat ; null sinon
    history: c.history.slice().reverse().map(view), // les plus récents d'abord (borné)
  };
}

// R25 (t_974e6b1e) : présentation RICHE des capacités — le PANNEAU affiche
// « quel appareil / combien de sièges / et l'infra le sert-elle ? » SANS
// décider : les chiffres viennent du catalogue (AIRCRAFT) et le verdict de
// capacité réutilise le critère de COMPATIBILITÉ du planificateur (runwayFor,
// infra.mjs : piste ≥ minRunway + porte de la taille — la même règle que
// flights.servableTypes, jamais une 2e règle de sim). Le panneau ne ré-impose
// rien : il lit, la sim décide (tickContracts) ; aucun état nouveau n'est
// créé (la sauvegarde reste EXACTE : R24 persistait déjà tout l'état contrats,
// R25 n'ajoute aucun champ).
export function contractCapable(sim, m) {
  const spec = AIRCRAFT[m.acType] || {};
  const runway = runwayFor(sim, spec.minRunway || 0);
  const gate = (sim.infra.gates || []).some((g) => g.size === spec.gate);
  const capable = !!runway && gate; // servable par l'infra (critère planificateur)
  // Motif lisible quand pas servable (l'offre reste possible : le joueur peut
  // investir pour servir le contrat — la décision, pas un blocage).
  const why = capable ? '' : (runway ? 'pas de porte de la taille'
    : `piste trop courte (≥ ${spec.minRunway} px)` + (gate ? '' : ' et pas de porte de la taille'));
  return { type: m.acType, name: spec.name || m.acType, seats: spec.seats || 0, capable, why };
}

// Décision du joueur (commande sim ; l'UI n'envoie que l'intention) :
// accepter → le contrat devient ACTIF (période lancée) ; refuser → GRATUIT
// (pas de pénalité, l'offre disparaît — tiers R21 « rien est toujours un choix »).
// Retourne true si la décision a eu un effet (l'offre existait), false sinon.
export function decideContract(sim, id, accept) {
  const c = ensureContracts(sim);
  const o = c.offered && c.offered.id === id ? c.offered : null;
  if (!o || c.active) return false; // une offre seulement, jamais au-dessus d'un contrat actif
  if (!accept) {
    c.offered = null;
    // Le refus donne une TRÊVE (pas de ping toutes les 600 s) : le prochain
    // contrat n'est proposé qu'après le cooldown — « rester sur la petite
    // activité » est un choix réel (tiers R21), pas une impasse de refus.
    c.cooldownUntil = (sim.time ?? 0) + CONTRACT_REJECT_COOLDOWN_S;
    pushEvent(sim, { kind: 'contract-refused', model: o.model });
    return true;
  }
  const m = CONTRACT_MODELS.find((x) => x.id === o.model);
  c.offered = null;
  c.active = { id: o.id, model: o.model, started: sim.time ?? 0, due: (sim.time ?? 0) + m.period,
               done: 0, pax: 0, onTime: 0, ends: 0, settled: false, result: null };
  pushEvent(sim, { kind: 'contract-started', id: o.id, model: o.model, period: m.period });
  return true;
}

// Annulation ACTIVE du contrat (avant l'échéance, à la main du joueur) : la
// pénalité plafonnée est due UNE SEULE FOIS (le règlement est idempotent — le
// flag `settled` est posé dans la MÊME écriture que la charge, pattern R22).
// Aucune spirale : rien n'est verrouillé, le prochain contrat est proposé.
export function cancelContract(sim, id) {
  const c = ensureContracts(sim);
  const a = c.active && c.active.id === id ? c.active : null;
  if (!a || a.settled) return false;
  const m = CONTRACT_MODELS.find((x) => x.id === a.model);
  settle(sim, a, 'cancelled', m.penalty); // pénalité : charge (compte dédié, même en déficit — D5)
  pushEvent(sim, { kind: 'contract-cancelled', id: a.id, model: m.id, penalty: m.penalty });
  return true;
}

// Tick (appelé par tick.mjs) : expiration d'offre non décidée (gratuit) +
// règlement à l'échéance du contrat actif (réussite → prime, insuffisance
// (volume ou ponctualité) → pénalité ; UNE SEULE FOIS, identifiant persistant).
export function tickContracts(sim, dt) {
  if (sim.economy?.bankrupt) return; // la sim est stoppée (comme tickObjectives)
  const c = ensureContracts(sim);
  // Offre expirée (jamais décidée) : retirée, GRATICIEMENT — pas de pénalité,
  // le prochain contrat sera proposé selon la condition (pax ou contrat précédent réglé).
  if (c.offered && c.offered.until <= (sim.time ?? 0)) {
    pushEvent(sim, { kind: 'contract-expired', model: c.offered.model });
    c.offered = null;
  }
  // Échéance : le contrat est réglé d'après la mesure sur la période.
  if (c.active && !c.active.settled && c.active.due <= (sim.time ?? 0)) {
    const m = CONTRACT_MODELS.find((x) => x.id === c.active.model);
    const ok = contractOnTrack(c.active, m); // LA règle unique (lu aussi par le panneau)
    settle(sim, c.active, ok ? 'success' : 'failed', ok ? null : m.penalty);
  }
  // Prochain contrat : un contrat réglé (ou refusé/expiré, plus de place) ouvre
  // le suivant dès que la condition du 1er est remplie (l'activité est réelle)
  // et la trêve post-refus (cooldownUntil) est dépassée.
  if (!c.offered && !c.active && (sim.passengers?.totalCarried ?? 0) >= CONTRACT_FIRST_PAX
      && (c.cooldownUntil ?? 0) <= (sim.time ?? 0)) {
    const model = CONTRACT_MODELS[c.history.length % CONTRACT_MODELS.length];
    c.offered = { id: 'c' + (c.nextId++), model: model.id,
                  at: sim.time ?? 0, until: (sim.time ?? 0) + CONTRACT_OFFER_VALID_S };
    pushEvent(sim, { kind: 'contract-offered', id: c.offered.id, model: model.id });
  }
}

// Le règlement : prime (earn) ou pénalité (charge) posés DANS LA MÊME ÉCRITURE
// que les flags `settled`/`result` — jamais deux fois (l'état est sérialisé,
// l'id persiste après la reprise). La pénalité passe par `charge` : un compte
// dédié (spent.contract-penalty), compté MÊME EN DÉFICIT (D5) — le solde peut
// devenir négatif, la faillite reste atteignable (checkBankruptcy).
function settle(sim, c, result, penalty) {
  if (c.settled) return; // idempotent : déjà réglé (reprise, double tick)
  c.settled = true;
  c.result = result;
  const m = CONTRACT_MODELS.find((x) => x.id === c.model);
  if (result === 'success') earn(sim, m.bonus, 'contract'); // prime (compte revenue.contract)
  else if (penalty != null) charge(sim, penalty, 'contract-penalty');
  const s = ensureContracts(sim);
  s.active = null;
  s.history.push({ ...c });
  if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX); // borné
  pushEvent(sim, { kind: result === 'success' ? 'contract-success' : 'contract-failed',
                  id: c.id, model: m.id, done: c.done, pax: c.pax,
                  reward: result === 'success' ? m.bonus : penalty });
}

// Fin de vol (départ OU annulation) : si l'avion ENREGISTRE le contrat actif
// (ac.contractId, posé au déploiement — flights.mjs), sa fin compte pour la
// période du contrat (vols, pax, ponctualité — la même règle « à l'heure » que
// R17 : retard cumulé ≤ rotation nominale ; une annulation compte NON ponctuel,
// comme la statistique R17). Appelé par logFlightEnd (aircraft.mjs) — le point
// de passage UNIQUE des fins de vol : jamais deux compteurs parallèles.
export function countContractFlight(sim, ac, cancelled) {
  const c = ensureContracts(sim);
  const a = c.active;
  if (!a || a.settled || ac.contractId !== a.id) return;
  // Le contrat ne compte QUE sa taille d'avion (modèle = une compagnie + un
  // appareil) : un contrat « qualité / 747 » n'est pas rempli par des Cessna.
  // Le joueur doit SÉRIEUSER le bon appareil (la décision est le jeu).
  const m = CONTRACT_MODELS.find((x) => x.id === a.model);
  if (m && ac.acType !== m.acType) return;
  a.ends++;
  a.pax += ac.pax ?? 0;
  if (ac.phase === 'cancelled' || cancelled) return; // annulé : vol non ponctuel (pas d'heure)
  a.done++;
  if ((ac.delayed ?? 0) <= nominalRotation(ac.acType)) a.onTime++;
}
