// Incidents opérationnels limités (BL-14, NONMVP-3, AC20/A-7) : 3 incidents,
// PAS une collection de pannes (A-7) :
//   runway  : fermeture PISTE temporaire — les atterrissages patientent (retard
//             mesurable), les départs continuent ; réouverture = reprise (récupération).
//   fuel    : panne STATION carburant — la (les) lance(s) tombent en panne :
//             départ SÉC pendant la panne (billets moitiés, événement no-fuel,
//             NON bloquant) ; service revenu → plein normal.
//   surge   : pic DEMANDE — le planificateur double sa cadence (plus de vols
//             planifiés) ET la satisfaction perd du confort (le pic se paie,
//             la qualité dégradée se lit) ; fin du pic → la cadence revient.
// Chaque incident suit le cycle exigé : perturb → réaction (comportement de la
// sim) → conséquence mesurée → récupération (état renversé, mesurable).
// Déterminisme : tiré par le rng SEMÉ de la sim (makeSimRng) → la suite des
// incidents est reproductible à la reprise (EV-10), comme les vols.
// ponytail : 3 incidents, horloge cumulée, aucun objet « incident » dédié ;
// upgrade si le jeu en veut plus : table de config + objet incident par type.
import { pushEvent } from '../core/sim-state.mjs';

const INCID = Object.freeze({
  RUNWAY_EVERY_S: 900,   // tirage « fermeture piste » toutes les ~15 min sim
  RUNWAY_CLOSE_S: 120,   // durée de la fermeture (les atterrissages patientent)
  FUEL_EVERY_S: 720,     // tirage « panne station » toutes les ~12 min sim
  FUEL_OUT_S: 90,        // durée de la panne (départ sec pendant la panne)
  SURGE_EVERY_S: 240,    // tirage « pic de demande » toutes les ~4 min sim
  SURGE_S: 90,           // durée du pic
  SURGE_SAT_LOSS: 0.5,   // %/s de satisfaction perdue PENDANT le pic (ça se paie)
});

// État des incidents sur la sim (sérialisable seul — sans état dérivé) :
// les compteurs de tirage vivent ici ; la sérialisation est donc directe.
export function ensureIncidents(sim) {
  let i = sim.incidents;
  if (i && i.runway && i.fuel && i.surge) return i;
  i = i || {};
  i.runway = i.runway || { closed: 0, acc: 0, last: 0 }; // closed : s restants
  i.fuel = i.fuel || { out: 0, acc: 0, last: 0 };
  i.surge = i.surge || { active: false, remaining: 0, acc: 0, last: 0 };
  return i;
}

// Le battement incidents (appelé par tick.mjs, APRÈS le planificateur).
// Chaque incident : compteurs cumulés → tirage (rng semé) → fin → événement.
// L'EFFET vit chez les modules concernés (aircraft.mjs regarde runway.closed,
// doRefuel regarde fuel.out, tickPlanner regarde surge.active) — ici l'horloge.
export function tickIncidents(sim, dt, rng) {
  if (!rng) rng = () => 0; // déterministe : sans rng semé, aucun tirage (pas d'incident)
  const i = ensureIncidents(sim);

  // 1) PISTE fermée : le compte à rebours finit → réouverture (récupération).
  if (i.runway.closed > 0) {
    i.runway.closed = Math.max(0, i.runway.closed - dt);
    if (i.runway.closed === 0) pushEvent(sim, { kind: 'runway-reopen', why: 'piste de nouveau ouverte' });
  } else {
    i.runway.acc += dt; // cadence : UN tirage par fenêtre (pas une loterie par tick)
    if (i.runway.acc >= INCID.RUNWAY_EVERY_S) {
      i.runway.acc = 0;
      if (rng() < 0.5) {
        i.runway.closed = INCID.RUNWAY_CLOSE_S;
        i.runway.last = sim.time ?? 0; // dernier incident (fréquence bornée, pas de pile)
        pushEvent(sim, { kind: 'runway-closed', why: 'fermeture piste (contrôle) — atterrissages en attente' });
      }
    }
  }

  // 2) STATION CARBURANT en panne : idem (la panne ne bloque personne :
  //    les pleins se font SÉC pendant la panne, c'est la conséquence lisible).
  if (i.fuel.out > 0) {
    i.fuel.out = Math.max(0, i.fuel.out - dt);
    if (i.fuel.out === 0) pushEvent(sim, { kind: 'fuel-back', why: 'stations carburant de nouveau en service' });
  } else {
    i.fuel.acc += dt;
    if (i.fuel.acc >= INCID.FUEL_EVERY_S) {
      i.fuel.acc = 0;
      if (rng() < 0.5) {
        i.fuel.out = INCID.FUEL_OUT_S;
        i.fuel.last = sim.time ?? 0;
        pushEvent(sim, { kind: 'fuel-out', why: 'panne stations carburant — départs secs' });
      }
    }
  }

  // 3) PIC DE DEMANDE : l'effet est lu par le planificateur (cadence doublée)
  //    + la satisfaction perd du confort PENDANT le pic (le pic a un coût).
  if (i.surge.active) {
    i.surge.remaining -= dt;
    sim.passengers.satisfaction = Math.max(0, sim.passengers.satisfaction - INCID.SURGE_SAT_LOSS * dt);
    if (i.surge.remaining <= 0) {
      i.surge.active = false;
      pushEvent(sim, { kind: 'surge-end', why: 'pic de demande terminé — cadence normale' });
    }
  } else {
    i.surge.acc += dt;
    if (i.surge.acc >= INCID.SURGE_EVERY_S) {
      i.surge.acc = 0;
      if (rng() < 0.5) {
        i.surge.active = true;
        i.surge.remaining = INCID.SURGE_S;
        i.surge.last = sim.time ?? 0;
        pushEvent(sim, { kind: 'surge-start', why: 'pic de demande — plus de vols planifiés' });
      }
    }
  }
}

// Le planificateur regarde le pic : cadence doublée (une fenêtre = 2 vols).
export function isSurge(sim) {
  return ensureIncidents(sim).surge.active;
}

// La lance carburant regarde la panne (doRefuel, aircraft.mjs) : 0 lance
// pendant la panne → départ sec (comportement EXISTANT, conséquence mesurée).
export function fuelOut(sim) {
  return ensureIncidents(sim).fuel.out > 0;
}

// La piste regarde la fermeture (doApproach/doHolding, aircraft.mjs) : aucun
// atterrissage tant que la piste est fermée (le départ, lui, continue).
export function runwayClosed(sim) {
  return ensureIncidents(sim).runway.closed > 0;
}

// Forçage DETERMINISTE d'un incident (tests + débogage UI) : met l'état à la
// position voulue + événement (le compteur de fin démarre, la fin est normale).
export function forceIncident(sim, which) {
  const i = ensureIncidents(sim);
  if (which === 'runway') {
    i.runway.closed = INCID.RUNWAY_CLOSE_S;
    i.runway.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'runway-closed', why: 'fermeture piste (forçage) — atterrissages en attente' });
  } else if (which === 'fuel') {
    i.fuel.out = INCID.FUEL_OUT_S;
    i.fuel.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'fuel-out', why: 'panne stations carburant (forçage) — départs secs' });
  } else if (which === 'surge') {
    i.surge.active = true;
    i.surge.remaining = INCID.SURGE_S;
    i.surge.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'surge-start', why: 'pic de demande (forçage) — plus de vols planifiés' });
  } else {
    throw new Error(`incident inconnu : ${which}`);
  }
}
