// T3 (t_4c9baadc) : COUCHE D'ÉVÉNEMENTS DYNAMIQUES — des événements injectent
// du travail dans la sim PAR LES MODULES EXISTANTS, avec une cadence bornée
// et reproductible (PRNG semé + compteurs sérialisés sur sim.events, EV-10).
//
// Design : EVENTS est une TABLE de 3 événements (des ENTRÉES, pas un système
// de paramétrage — même discipline que la table INCID des incidents) :
//   - conference : une délégation arrive — un vol PLEIN (100 % des sièges) est
//     injecté dans le planning (planOneFlight, flights.mjs) : le mécanisme de
//     décision EXISTANT (accepter/refuser, déploiement à l'heure prévue).
//   - charter    : un affrètement — UNE SÉRIE de 2 vols (70 % des sièges)
//     injectés dans le planning (même mécanisme).
//   - tourism    : un pic touristique — l'incident de DEMANDE (surge) est
//     injecté via incidents.mjs (l'état i.surge que tickIncidents fait
//     avancer, la cadence du planificateur DOUBLÉE pendant le pic), avec la
//     durée explicite de scenarios.mjs (source unique — jamais de nombre
//     dupliqué). INTERACTION AVEC UN INCIDENT : si un pic est déjà en cours
//     (incident naturel OU pic antérieur), l'événement le RENFORÇE
//     (remaining += durée, pas un reset) — le pic se prolonge, mesurable.
//
// Tirage : une fenêtre toutes les EVENT_EVERY_S (compteur acc PRESERVÉ aux
// grands pas dt — même pattern que les horloges incidents/planner) avec une
// probabilité EVENT_PROB par fenêtre : déterministe à la relecture (rng semé
// + acc/last/seq/fired sur sim.events) → reproductible après rechargement.
//
// Feedback : l'événement émet UNE alerte `event-start` (pushEvent, kind
// lisible + seq) → le câblage EXISTANT la consomme : toast (ALERT_MSG,
// main.mjs) + SFX (sfxForAlert, audio.mjs) + juice (juiceForAlert,
// ui/juice.mjs). La fin du pic touristique est l'événement EXISTANT
// `surge-end` des incidents (pas de double compte à rebours).
//
// Sauvegarde : l'état vit sur sim.events (sérialisé seul, comme
// sim.incidents) — les sauvegardes PRÉ-T3 n'ont pas le champ (toléré :
// ensureEvents le re-attache, save.mjs).
import { pushEvent } from '../core/sim-state.mjs';
import { ensureIncidents } from './incidents.mjs';
import { SATURATION_SURGE_S } from '../scenarios.mjs';
import { planOneFlight } from '../flights/flights.mjs';

// Cadence bornée du tirage (table exportée — lisible, jamais de nombre
// réinventé ailleurs) : une fenêtre de 8 min sim, 1 tirage par fenêtre.
export const EVENT_EVERY_S = 480;
export const EVENT_PROB = 0.5; // probabilité de tirage par fenêtre (comme INCID)

// La TABLE des événements (entrées lues par le tirage + l'UI : name/why).
// Les effets sont injectés via les modules existants — cette table ne porte
// QUE les caractéristiques de l'offrande (jamais de règle de sim).
export const EVENTS = Object.freeze({
  conference: Object.freeze({
    name: 'Conférence internationale',
    why: 'une délégation arrive en avion : un vol PLEIN à décider',
    flights: 1, paxRatio: 1.0, leadS: 60,
  }),
  charter: Object.freeze({
    name: 'Affrètement charter',
    why: 'une compagnie affrète la flotte : deux offres à décider',
    flights: 2, paxRatio: 0.7, leadS: 60, gapS: 90,
  }),
  tourism: Object.freeze({
    name: 'Pic touristique',
    why: 'la demande explose : le planificateur double la cadence',
    surgeS: SATURATION_SURGE_S, // durée explicite (scenarios.mjs, source unique)
  }),
});

// État de la couche sur la sim (sérialisable SEUL — sans état dérivé) :
//   acc   : accumulateur de la fenêtre de tirage (survit aux grands pas dt)
//   last  : sim.time du dernier événement déclenché
//   seq   : nombre d'événements déclenchés (lecture, persiste)
//   fired : compteurs PAR événement { conference: n, charter: n, tourism: n }
// Migration idempotente (pattern ensureIncidents) : une sauvegarde pré-T3
// (champ absent) est re-attachée ; les valeurs corrompues sont normalisées —
// le champ EXISTANT mais de mauvais type est REFUSÉ en amont (validateSim,
// save.mjs), jamais écrasé silencieusement ici.
export function ensureEvents(sim) {
  let ev = sim.events;
  if (!ev || typeof ev !== 'object') ev = sim.events = {};
  ev.acc = Number.isFinite(ev.acc) ? ev.acc : 0;
  ev.last = Number.isFinite(ev.last) ? ev.last : 0;
  ev.seq = Number.isInteger(ev.seq) && ev.seq >= 0 ? ev.seq : 0;
  ev.fired = ev.fired && typeof ev.fired === 'object' ? ev.fired : (ev.fired = {});
  for (const k of Object.keys(ev.fired)) {
    if (!Number.isInteger(ev.fired[k]) || ev.fired[k] < 0) ev.fired[k] = 0;
  }
  return ev;
}

// Le battement de la couche : un tirage par fenêtre COMPLÉTÉE (le compteur acc
// est PRESERVÉ aux grands pas dt — comme les horloges incidents/planner, la
// fenêtre n'est ni sautée ni dupliquée). Déterministe : rng semé + compteurs
// sur sim.events (reproductible à la relecture).
export function tickEvents(sim, dt, rng) {
  const ev = ensureEvents(sim);
  ev.acc += dt;
  const windows = Math.floor(ev.acc / EVENT_EVERY_S);
  if (!windows) return;
  ev.acc -= windows * EVENT_EVERY_S;
  for (let w = 0; w < windows; w++) {
    if (rng() >= EVENT_PROB) continue; // le tirage rate la fenêtre (la fenêtre est consommée)
    const id = Object.keys(EVENTS)[Math.floor(rng() * Object.keys(EVENTS).length)];
    if (!id) continue;
    if (fireEvent(sim, id, rng)) {
      ev.seq += 1;
      ev.last = sim.time ?? 0;
      ev.fired[id] = (ev.fired[id] || 0) + 1;
    }
  }
}

// Déclenche UN événement : l'effet est injecté PAR LES MODULES EXISTANTS
// (planOneFlight pour les vols, l'état incidents pour le pic) — ce module ne
// réinvente aucune règle de sim. Retourne true si l'événement a eu un effet
// (sinon il n'est pas compté : rien ne s'est passé).
function fireEvent(sim, id, rng) {
  const cfg = EVENTS[id];
  if (!cfg) return false;
  if (cfg.surgeS != null) {
    // Pic touristique : l'incident de DEMANDE via l'état des incidents
    // (tickIncidents le fait avancer et le termine — événement « surge-end »
    // EXISTANT à la fin, pas de double compte à rebours ici).
    const i = ensureIncidents(sim);
    if (i.surge.active && i.surge.remaining > 0) {
      // Interaction avec un incident EN COURS : renforcement (le pic se
      // prolonge d'autant), jamais un reset de l'horloge en cours.
      i.surge.remaining += cfg.surgeS;
      pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: `renforce le pic en cours (+${cfg.surgeS} s)` });
    } else {
      i.surge.active = true;
      i.surge.remaining = cfg.surgeS;
      i.surge.acc = 0;
      i.surge.last = sim.time ?? 0;
      pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: cfg.why });
    }
    return true;
  }
  // Conférence / charter : les vols sont injectés dans le planning via
  // planOneFlight (le mécanisme EXISTANT : offre « planned » à décider,
  // déploiement à l'heure prévue, purge au départ) — la charge est explicite
  // (fraction des sièges) et l'entrée porte le marqueur `event` (lecture
  // lisible dans le panneau planning).
  let injected = 0;
  for (let f = 0; f < cfg.flights; f++) {
    const planned = (sim.time ?? 0) + cfg.leadS + (cfg.gapS ? f * cfg.gapS : 0);
    const e = planOneFlight(sim, rng, { paxRatio: cfg.paxRatio, planned, event: id });
    if (e) injected++;
  }
  if (!injected) return false; // aucune infra servable : l'événement n'a pas d'effet
  pushEvent(sim, { kind: 'event-start', event: id, name: cfg.name, why: cfg.why });
  return true;
}
