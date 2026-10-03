// Incidents opérationnels limités (BL-14, NONMVP-3, AC20/A-7) : 3 incidents,
// PAS une collection de pannes (A-7) :
//   runway  : fermeture d'UNE PISTE — les atterrissages sur CETTE piste
//             patientent (retard mesurable), les départs continuent ; l'AUTRE
//             piste reste utilisable (R32 : la fermeture est ATTACHÉE à la
//             piste, pas globale) ; réouverture = reprise (récupération).
//   fuel    : panne d'UNE STATION carburant — les lances de CETTE station
//             tombent en panne : départ SÉC si elle seule sert la porte
//             (billets moitiés, événement no-fuel, NON bloquant) ; une AUTRE
//             station continue de servir (R32 : la panne est ATTACHÉE à la
//             station, la voisine reste ACTIVE) ; service revenu → plein normal.
//   surge   : pic DEMANDE — le planificateur double sa cadence (plus de vols
//             planifiés) ET la satisfaction perd du confort (le pic se paie,
//             la qualité dégradée se lit) ; fin du pic → la cadence revient.
// R32 : un incident = UN OBJET { id, type, asset, remaining, severity, cause }
// ATTACHÉ à un ACTIF (une piste, une station) — l'actif est l'id de l'actif ;
// « la fréquence dépend de l'usure ou d'une table bornée » : la table bornée
// (fenêtres) reste le cœur, l'usure de la porte (R29) BIAISE le tirage (plus
// usé → plus de risque, borné) — l'exposition DÉBUT DE PARTIE reste bornée
// (aucun incident forcé, le 1er tirage n'arrive qu'après 240 s de sim).
// Chaque incident suit le cycle exigé : perturb → réaction (comportement de la
// sim) → conséquence mesurée → récupération (état renversé, mesurable).
// Déterminisme : tiré par le rng SEMÉ de la sim (makeSimRng) → la suite des
// incidents est reproductible à la reprise (EV-10), comme les vols.
// ponytail : les incidents par actif vivent dans sim.incidents.runways/fuels
// (id d'actif → enregistrement) + un compteur d'horloge global ; un incident
// d'actif SUPPRIMÉ est PURGÉ à chaque tick (ensureIncidents) + au chargement
// (pas de référence orpheline). Upgrade : table de gravité par type si le jeu
// veut des incidents plus variés.
import { pushEvent } from '../core/sim-state.mjs';
import { charge } from '../economy/economy.mjs'; // R33 : l'intervention PAYANTE débite le solde (catégorie spent.intervention)

const INCID = Object.freeze({
  RUNWAY_EVERY_S: 900,   // tirage « fermeture piste » toutes les ~15 min sim
  RUNWAY_CLOSE_S: 120,   // durée de la fermeture (les atterrissages patientent)
  FUEL_EVERY_S: 720,     // tirage « panne station » toutes les ~12 min sim
  FUEL_OUT_S: 90,        // durée de la panne (départ sec pendant la panne)
  SURGE_EVERY_S: 240,    // tirage « pic de demande » toutes les ~4 min sim
  SURGE_S: 90,           // durée du pic
  SURGE_SAT_LOSS: 0.5,   // %/s de satisfaction perdue PENDANT le pic (ça se paie)
  // R32 : l'usure BIAISE la fréquence — plus un terminal est usé (portes
  // cleaning+maintenance, R29), plus un incident d'actif s'y déclenche vite
  // (le 1er tirage reste borné : il n'arrive QU'APRÈS la 1re fenêtre).
  WEAR_BIAS: 0.5,        // p = P0 × (1 + usure/100 × WEAR_BIAS) (borne ≤ P0×3)
  // R33 : l'intervention PAYANTE termine l'incident IMMÉDIATEMENT (vs la
  // réponse passive « attendre », gratuite mais les effets continuent jusqu'à
  // la fin naturelle). Montants bornés : ~1 indemnité de vol annulé (500 $),
  // pas un goulot financier (START_FUNDS 12 000 inchangé).
  INTERVENE_RUNWAY_COST: 600, // réouverture immédiate d'une piste fermée
  INTERVENE_FUEL_COST: 450,   // remise en service immédiate d'une station
});

// État des incidents sur la sim (sérialisable seul — sans état dérivé) :
// les compteurs de tirage vivent ici ; la sérialisation est donc directe.
// R32 : + les incidents ATTACHÉS à un actif :
//   i.runways = { [pisteId]: { id, type, asset, remaining, severity, cause } }
//   i.fuels   = { [stationId]: { id, type, asset, remaining, severity, cause } }
// La purge des actifs SUPPRIMÉS (démo, terminal détruit) se fait ICI
// (appelée à chaque tick + au chargement) → PAS de référence orpheline.
export function ensureIncidents(sim) {
  let i = sim.incidents;
  i = i || {};
  i.runway = i.runway || { closed: 0, acc: 0, last: 0 }; // horloge globale (survies)
  i.fuel = i.fuel || { out: 0, acc: 0, last: 0 };
  i.surge = i.surge || { active: false, remaining: 0, acc: 0, last: 0 };
  i.runways = i.runways || {}; // R32 : fermeture PISTE par id de piste
  i.fuels = i.fuels || {};     // R32 : panne STATION par id de station
  purgeOrphanIncidents(sim, i);
  return i;
}

// R32 : un incident attaché à un actif SUPPRIMÉ (démo, terminal détruit) est
// PURGÉ : son actif n'existe plus → la référence serait orpheline (la sim
// regarderait une piste/panne qui n'est plus là). La purge est idempotente
// (testée) et sans effet si l'actif existe.
function purgeOrphanIncidents(sim, i) {
  const infra = sim.infra;
  if (!infra) return;
  // ponytail : les clés d'objet JS sont des CHAÎNES (i.runways["12"]) alors que
  // les ids de bâtiments sont des NOMBRES — on normalise en chaînes des DEUX
  // côtés, sinon l'orpin check delete le record qu'on vient de créer.
  const runwayIds = new Set((infra.runways || []).map((r) => String(r.id)));
  const fuelIds = new Set((infra.services || []).filter((s) => s.type === 'fuel').map((s) => String(s.id)));
  if (i.runways) for (const k of Object.keys(i.runways)) if (!runwayIds.has(k)) delete i.runways[k];
  if (i.fuels) for (const k of Object.keys(i.fuels)) if (!fuelIds.has(k)) delete i.fuels[k];
  // L'actif disparu avec sa panne : le flag local `fuelOut` ne survit plus
  // (la station n'existe plus — le champ n'a plus de porteur).
  if (infra.services) for (const s of infra.services) if (s.type === 'fuel' && !fuelIds.has(String(s.id))) s.fuelOut = undefined;
}

// R32 : choisir l'ACTIF qui porte l'incident. La fréquence est une table
// bornée (fenêtres ci-dessus) ; le CIBLE est déterministe : la piste/la
// station du terminal le PLUS USÉ (portes cleaning+maintenance, R29) — plus
// usé → l'incident y frappe (l'exposition débUT de partie reste bornée : le
// 1er tirage n'arrive qu'APRÈS la 1re fenêtre, pas avant). Égalité → id le
// plus petit (déterminisme). Sans infra → le 1er actif.
function wearOfTerminal(sim, tid) {
  let w = 0;
  for (const g of sim.infra.gates || []) if (g.terminalId === tid) w += (g.cleaning || 0) + (g.maintenance || 0);
  return w;
}
function pickRunwayTarget(sim) {
  const rws = sim.infra.runways || [];
  if (!rws.length) return null;
  // ponytail : une piste n'a pas d'usure propre — on la relie au terminal le
  // plus usé (proximité d'exposition) ; borne simple, pas de modèle d'usure piste.
  let best = rws[0], bw = -1;
  for (const r of rws) {
    const tid = r.terminalId ?? sim.infra.terminals[0]?.id;
    const w = tid ? wearOfTerminal(sim, tid) : 0;
    if (w > bw || (w === bw && r.id < best.id)) { best = r; bw = w; }
  }
  return best.id;
}
function pickFuelTarget(sim) {
  const sts = (sim.infra.services || []).filter((s) => s.type === 'fuel' && !s.fuelOut);
  if (!sts.length) return null;
  let best = sts[0], bw = -1;
  for (const s of sts) {
    const w = s.target != null ? wearOfTerminal(sim, s.target) : 0;
    if (w > bw || (w === bw && s.id < best.id)) { best = s; bw = w; }
  }
  return best.id;
}
// R32 : l'incident = UN OBJET attaché à son ACTIF { id, type, asset, remaining,
// severity, cause } — lisible (la cause est le motif) + borné (remaining).
function startRunwayIncident(sim, i, rwId, cause, rng) {
  const rec = { id: `inc-rw-${i._seq = (i._seq || 0) + 1}`, type: 'runway', asset: rwId,
    remaining: INCID.RUNWAY_CLOSE_S, severity: 'major', cause };
  i.runways[rwId] = rec;
  i.runway.last = sim.time ?? 0; // calendrier (fréquence bornée, pas de pile)
  pushEvent(sim, { kind: 'runway-closed', runway: rwId, why: cause });
}
function startFuelIncident(sim, i, stId, cause) {
  const rec = { id: `inc-fuel-${i._seq = (i._seq || 0) + 1}`, type: 'fuel', asset: stId,
    remaining: INCID.FUEL_OUT_S, severity: 'major', cause };
  i.fuels[stId] = rec;
  i.fuel.last = sim.time ?? 0;
  const svc = (sim.infra.services || []).find((s) => s.id === stId);
  if (svc) svc.fuelOut = true; // R28 : le flag local marque la station HS (les lances tombent)
  pushEvent(sim, { kind: 'fuel-out', station: stId, why: cause });
}

// Le battement incidents (appelé par tick.mjs, APRÈS le planificateur).
// Chaque incident : compteurs cumulés → tirage (rng semé) → cible ACTIF → fin.
// L'EFFET vit chez les modules concernés (aircraft.mjs regarde la fermeture
// PISTE par id, doRefuel la panne STATION par id, tickPlanner surge.active).
export function tickIncidents(sim, dt, rng) {
  if (!rng) rng = () => 0; // déterministe : sans rng semé, aucun tirage (pas d'incident)
  const i = ensureIncidents(sim);

  // 1) FERMETURE PISTE (R32 : ATTACHÉE à UNE piste) : le compte à rebours de
  //    CHAQUE piste ferme finit → réouverture (récupération, mesurée).
  for (const rwId of Object.keys(i.runways)) {
    const rec = i.runways[rwId];
    rec.remaining = Math.max(0, rec.remaining - dt);
    if (rec.remaining === 0) {
      delete i.runways[rwId];
      pushEvent(sim, { kind: 'runway-reopen', runway: rwId, why: 'piste de nouveau ouverte' });
    }
  }
  if (Object.keys(i.runways).length === 0) {
    i.runway.acc += dt; // cadence : UN tirage par fenêtre (pas une loterie par tick)
    if (i.runway.acc >= INCID.RUNWAY_EVERY_S) {
      i.runway.acc = 0;
      if (rng() < 0.5) {
        const rwId = pickRunwayTarget(sim);
        if (rwId != null) startRunwayIncident(sim, i, rwId, 'fermeture piste (contrôle) — atterrissages en attente', rng);
      }
    }
  }

  // 2) PANNE STATION CARBURANT (R32 : ATTACHÉE à UNE station ; la voisine reste
  //    ACTIVE) : le compte à rebours de CHAQUE station HS finit → service reviu.
  for (const stId of Object.keys(i.fuels)) {
    const rec = i.fuels[stId];
    rec.remaining = Math.max(0, rec.remaining - dt);
    if (rec.remaining === 0) {
      // stId est une CHAÎNE (clé d'objet) ; l'id de service est un NOMBRE —
      // comparaison normalisée (sinon la station « revenue » garde fuelOut=true).
      const svc = (sim.infra.services || []).find((s) => String(s.id) === stId);
      if (svc) svc.fuelOut = false; // la station repart (les lances sont de nouveau servies)
      delete i.fuels[stId];
      pushEvent(sim, { kind: 'fuel-back', station: stId, why: 'station carburant de nouveau en service' });
    }
  }
  if (Object.keys(i.fuels).length === 0) {
    i.fuel.acc += dt;
    if (i.fuel.acc >= INCID.FUEL_EVERY_S) {
      i.fuel.acc = 0;
      if (rng() < 0.5) {
        const stId = pickFuelTarget(sim);
        if (stId != null) startFuelIncident(sim, i, stId, 'panne station carburant — départs secs');
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

// R28/R32 : les pannes de CARBURANT sont PAR STATION — l'incident est ATTACHÉ
// à la station (`i.fuels[stationId]` + le flag local `svc.fuelOut`). Une panne
// d'UNE station la met HS (ses lances tombent) ; les AUTRES stations restent
// actives. La fermeture de PISTE est de même ATTACHÉE à la piste
// (`i.runways[runwayId]`) : l'AUTRE piste reste utilisable.
//  - fuelOut(sim) : au moins UNE station carburant est-elle en panne ? (lecture
//    globale, utilisée par le planificateur/le HUD) — le comportement local
//    (doRefuel) regarde `fuelOutStation(sim, lanceId)` via svc.fuelOut.
//  - fuelOutStation(sim, stationId) : UNE station précise est-elle en panne ?
//  - runwayClosed(sim, runwayId?) : CETTE piste est-elle fermée ? (sans id :
//    au moins UNE piste fermée — lecture globale).
// L'incident par station se force via forceIncident(sim, 'fuel:<stationId>');
// la fermeture de piste via forceIncident(sim, 'runway:<runwayId>') ou 'runway'
// (la 1re piste). L'état et le calendrier (compteurs acc/last) survivent à la
// reprise (sérialisable), la purge des orphelins se fait au chargement.
// ponytail : la panne locale est un FLAG + enregistrement (pas de modèle
// d'usure de la station elle-même) ; la fréquence est biaisée par l'usure du
// terminal le plus usé (pickRunwayTarget/pickFuelTarget), bornée.
export function fuelOutStation(sim, stationId) {
  const svc = sim.infra.services.find((s) => s.id === stationId);
  return !!(svc && svc.fuelOut);
}

// Lecture GLOBALE : au moins UNE station carburant est-elle en panne ?
// (planificateur = risque « départ sec » ; HUD = affichage). Le plein local
// regarde la STATION précise via svc.fuelOut (R28) — une panne d'UNE station
// ne rend pas les AUTRES stations inactives.
export function fuelOut(sim) {
  const i = ensureIncidents(sim);
  return Object.values(i.fuels).some((f) => f && f.remaining > 0);
}

// La piste regarde la fermeture (doApproach/doHolding, aircraft.mjs) : aucun
// atterrissage sur CETTE piste tant qu'elle est fermée (l'AUTRE reste utilisable,
// R32). Sans id : au moins UNE piste fermée (lecture globale planificateur/HUD).
export function runwayClosed(sim, runwayId) {
  const i = ensureIncidents(sim);
  if (runwayId == null) return Object.values(i.runways).some((r) => r && r.remaining > 0);
  const rec = i.runways[runwayId];
  return !!(rec && rec.remaining > 0);
}

// Forçage DETERMINISTE d'un incident (tests + débogage UI) : met l'état à la
// position voulue + événement (le compteur de fin démarre, la fin est normale).
// R32 : l'incident est ATTACHÉ à un ACTIF — 'runway'/'runway:<id>' ferme UNE
// piste (l'autre reste utilisable), 'fuel'/'fuel:<id>' met UNE station en
// panne (la voisine reste active). Sans id : la cible est DÉRIVÉE de l'usure
// (pickRunwayTarget/pickFuelTarget — le 1er actif le plus exposé), déterministe.
export function forceIncident(sim, which) {
  const i = ensureIncidents(sim);
  if (which === 'runway' || (typeof which === 'string' && which.startsWith('runway:'))) {
    const rwId = which === 'runway' ? pickRunwayTarget(sim) : Number(which.slice(7));
    if (rwId == null || !(sim.infra.runways || []).some((r) => r.id === rwId)) {
      throw new Error(`piste inconnue : ${which}`);
    }
    startRunwayIncident(sim, i, rwId, 'fermeture piste (forçage) — atterrissages en attente');
  } else if (which === 'fuel' || (typeof which === 'string' && which.startsWith('fuel:'))) {
    const stId = which === 'fuel' ? pickFuelTarget(sim) : Number(which.slice(5));
    if (stId == null || !(sim.infra.services || []).some((s) => s.id === stId && s.type === 'fuel')) {
      throw new Error(`station inconnue : ${which}`);
    }
    startFuelIncident(sim, i, stId, `panne STATION ${stId} (forçage) — ses lances sont hors service`);
  } else if (which === 'surge') {
    i.surge.active = true;
    i.surge.remaining = INCID.SURGE_S;
    i.surge.last = sim.time ?? 0;
    pushEvent(sim, { kind: 'surge-start', why: 'pic de demande (forçage) — plus de vols planifiés' });
  } else {
    throw new Error(`incident inconnu : ${which}`);
  }
}

// R33 (t_11a4e241) : DEUX réponses opérationnelles par incident —
//   passive   : gratuite, aucun effet jusqu'à la fin NATURELLE de l'incident
//               (le joueur attend, les effets continuent — c'est le choix).
//   coûteuse  : débite un coût (intervention) OU consomme une ressource
//               (allègement du planning : les vols planifiés sont refusés,
//               leur revenu est perdu) — l'effet est IMMÉDIAT.
// Les CONSÉQUENCES sont lues AVANT décision (incidentResponse, lecture pure
// — l'UI les affiche dans le panneau diagnostic, pas de mutation). L'action
// NE PEUT PAS ÊTRE RÉPÉTÉE pour cumuler artificiellement les effets : une
// intervention FINIT le record (2e appel → motif, aucune mutation) ; un
// allègement refuse TOUS les vols planifiés (2e appel → plus rien à
// refuser). Aucune 3e option : les deux réponses offrent déjà un vrai
// arbitrage (argent vs temps, revenu vs files) — une 3e serait un faux choix.
// which : 'runway:<pisteId>' | 'fuel:<stationId>' | 'surge' (sans id : l'actif
// unique en incident est dérivé ; plusieurs actifs touchés → id explicite).

function resolveIncident(sim, which) {
  const i = ensureIncidents(sim);
  const m = typeof which === 'string' && which.includes(':');
  const type = m ? which.slice(0, which.indexOf(':')) : which;
  const assetKey = m ? which.slice(which.indexOf(':') + 1) : null;
  if (type === 'runway') {
    const actives = Object.keys(i.runways).filter((k) => i.runways[k] && i.runways[k].remaining > 0);
    const key = assetKey ?? (actives.length === 1 ? actives[0] : null);
    if (!key || !i.runways[key] || i.runways[key].remaining <= 0)
      return { ok: false, reason: actives.length > 1 ? 'plusieurs pistes fermées — préciser la cible (runway:<id>)' : 'aucune piste en fermeture' };
    return { ok: true, type, key };
  }
  if (type === 'fuel') {
    const actives = Object.keys(i.fuels).filter((k) => i.fuels[k] && i.fuels[k].remaining > 0);
    const key = assetKey ?? (actives.length === 1 ? actives[0] : null);
    if (!key || !i.fuels[key] || i.fuels[key].remaining <= 0)
      return { ok: false, reason: actives.length > 1 ? 'plusieurs stations en panne — préciser la cible (fuel:<id>)' : 'aucune station en panne' };
    return { ok: true, type, key };
  }
  if (type === 'surge') {
    if (!i.surge.active || i.surge.remaining <= 0) return { ok: false, reason: 'aucun pic de demande' };
    return { ok: true, type: 'surge' };
  }
  return { ok: false, reason: `incident inconnu : ${which}` };
}

// LECTURE (UI) : les deux réponses + leurs CONSÉQUENCES, avant décision.
// Aucune mutation — le panneau peut l'appeler à chaque rendu.
export function incidentResponse(sim, which) {
  const t = resolveIncident(sim, which);
  if (!t.ok) return { ok: false, reason: t.reason };
  const i = ensureIncidents(sim);
  if (t.type === 'runway') {
    const rec = i.runways[t.key];
    return {
      ok: true, type: 'runway', asset: Number(t.key), remaining: Math.ceil(rec.remaining),
      responses: [
        { id: 'wait', name: 'Attendre (gratuit)', cost: 0,
          effect: `les atterrissages patientent ${Math.ceil(rec.remaining)} s jusqu'à la réouverture naturelle` },
        { id: 'intervene', name: "Intervention d'urgence", cost: INCID.INTERVENE_RUNWAY_COST,
          effect: `réouverture IMMÉDIATE de la piste — plus d'attente (coût ${INCID.INTERVENE_RUNWAY_COST} $)` },
      ],
    };
  }
  if (t.type === 'fuel') {
    const rec = i.fuels[t.key];
    return {
      ok: true, type: 'fuel', asset: Number(t.key), remaining: Math.ceil(rec.remaining),
      responses: [
        { id: 'wait', name: 'Attendre (gratuit)', cost: 0,
          effect: `départs secs (billets moitiés) pendant ${Math.ceil(rec.remaining)} s jusqu'au retour du service` },
        { id: 'intervene', name: "Intervention d'urgence", cost: INCID.INTERVENE_FUEL_COST,
          effect: `station de nouveau ACTIVE immédiatement — pleins normaux (coût ${INCID.INTERVENE_FUEL_COST} $)` },
      ],
    };
  }
  const n = (sim.planning || []).filter((e) => e.status === 'planned').length;
  return {
    ok: true, type: 'surge', remaining: Math.ceil(i.surge.remaining),
    responses: [
      { id: 'absorb', name: 'Absorber le pic (gratuit)', cost: 0,
        effect: `le pic continue ${Math.ceil(i.surge.remaining)} s — la cadence reste doublée, le confort baisse (${INCID.SURGE_SAT_LOSS} %/s)` },
      { id: 'relief', name: 'Allègement du planning', cost: 0,
        effect: `refuser les ${n} vol(s) planifié(s) (leur revenu est perdu) — les files d'arrivée se vident` },
    ],
  };
}

// COMMANDE (la sim règle, l'UI émet l'intention) : appliquer la réponse.
// Motif lisible si l'action est impossible — PAS de mutation partielle
// (la résolution ET la vérification précèdent TOUTE écriture).
export function respondIncident(sim, which, response) {
  const t = resolveIncident(sim, which);
  if (!t.ok) return { ok: false, reason: t.reason };
  const i = ensureIncidents(sim);
  if (t.type === 'runway') {
    if (response === 'wait') return { ok: true, effect: 'attente — réouverture naturelle (aucun coût)' };
    if (response !== 'intervene') return { ok: false, reason: `réponse inconnue : ${response}` };
    charge(sim, INCID.INTERVENE_RUNWAY_COST, 'intervention');
    delete i.runways[t.key]; // la fin NORMALE (tickIncidents) ne se rejoue pas — l'incident EST terminé
    pushEvent(sim, { kind: 'runway-reopen', runway: Number(t.key), why: `intervention — réouverture immédiate (payante, ${INCID.INTERVENE_RUNWAY_COST} $)` });
    return { ok: true, effect: `piste ${t.key} réouverte immédiatement (coût ${INCID.INTERVENE_RUNWAY_COST} $)` };
  }
  if (t.type === 'fuel') {
    if (response === 'wait') return { ok: true, effect: 'attente — retour du service (aucun coût)' };
    if (response !== 'intervene') return { ok: false, reason: `réponse inconnue : ${response}` };
    charge(sim, INCID.INTERVENE_FUEL_COST, 'intervention');
    const svc = (sim.infra.services || []).find((s) => String(s.id) === t.key && s.type === 'fuel');
    if (svc) svc.fuelOut = false; // la station repart (la fin normale le ferait au compte à rebours)
    delete i.fuels[t.key];
    pushEvent(sim, { kind: 'fuel-back', station: t.key, why: `intervention — station de nouveau en service (payante, ${INCID.INTERVENE_FUEL_COST} $)` });
    return { ok: true, effect: `station ${t.key} de nouveau active (coût ${INCID.INTERVENE_FUEL_COST} $)` };
  }
  // surge : allègement du planning = refuser TOUS les vols planifiés (la
  // ressource consommée est leur revenu — l'action ne se répète PAS : après,
  // il ne reste plus de vol « planned » à refuser).
  if (response === 'absorb') return { ok: true, effect: 'pic absorbé (aucune action)' };
  if (response !== 'relief') return { ok: false, reason: `réponse inconnue : ${response}` };
  const refused = (sim.planning || []).filter((e) => e.status === 'planned');
  if (!refused.length) return { ok: false, reason: 'plus de vol à refuser — le planning est déjà allégé (action non répétable)' };
  sim.planning = sim.planning.filter((e) => e.status !== 'planned');
  pushEvent(sim, { kind: 'planning-relief', count: refused.length, why: `allègement du planning — ${refused.length} vol(s) planifié(s) refusé(s) (revenu perdu)` });
  return { ok: true, effect: `${refused.length} vol(s) planifié(s) refusé(s) — files d'arrivée allégées` };
}
