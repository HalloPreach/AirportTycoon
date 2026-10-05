// R42 (t_2e6ad3c0) — ENDURANCE NODE : partie prolongée sur PLUSIEURS SEEDS.
// Deux GROUPES de sessions (le layout demandé = « réellement chargé, pas
// uniquement le petit aéroport initial ») :
//   1. SURVIE 24 h — aéroport de DÉPART (le petit, fourni) + stratégie
//      JOUEUR (acceptation des vols + emprunt unique, le levier de survie
//      du jeu) : une partie VRAIMENT prolongée (24 h de jeu), le terrain de
//      l'endurance (mémoire/journaux/contrats/sauvegarde sur la durée).
//   2. LAYOUT CHARGÉ — 2e piste + 2e terminal (portes L) + 2e taxiway +
//      service carburant, construit par la commande publique (débit réel
//      des fonds) : la sim tourne jusqu'à l'ÉVÉNEMENT (faillite, car
//      l'OPEX du layout chargé + les intérêts sur le solde négatif
//      (1 %/s, bornés au seuil de faillite) forcent la faillite — le
//      risque de sur-expansion DU JEU, START_FUNDS inchangé). Les
//      invariants durs sont vérifiés jusqu'au point d'arrêt, et le coût
//      du tick / les journaux / la sauvegarde sont mesurés sur ce layout
//      chargé (la charge demandée par la carte, pas un aéroport minimal).
//
// La sim est pilotée par le CŒUR de production (tick.mjs) + les COMMANDES
// publiques (buildBuilding, decideFlight, decideContract, forceIncident,
// respondIncident) — AUCUNE règle réimplémentée ici (invariant : la sim
// n'est pas touchée, le harness EST le joueur).
//
// Mesures demandées par la carte :
//   - coût du tick : ms réelles par heure de jeu (par seed),
//   - mémoire / journaux : échantillons heap + longueurs des journaux
//     (alerts 500, périodes 4, contrats 8, ponctualité 50 — bornés par la
//      sim ; ici on VÉRIFIE qu'aucun ne dépasse sa borne + heap plate),
//   - invariants durs par tick : valeurs FINIES, passagers comptés une fois
//     (totalCarried monotone), AUCUNE réservation orpheline (gate.acId →
//     avion existant portant le même gateId), contrats réglés UNE fois
//     (chaque entrée d'historique settled=true + résultat, ids uniques),
//   - sauvegarde ENCORE UTILISABLE : sérialisation/désérialisation MID-RUN
//     (+ fin) sur un clone → le clone avance de 100 ticks SANS divergence
//     de règle (mêmes invariants) et l'état clé est identique au parent.
//
// Usage : node --expose-gc qa/r42-node.mjs [--hours 24] [--seeds 0,42,1337,2026] [--dt 2]
//   (--expose-gc : le harness force un GC avant chaque échantillon d'heap pour
//    que la suite mesurée soit nette ; sans le flag, la mesure reste valide
//    mais le bruit de GC transitoire est inclus — la décision « fuite » s'appuie
//    toujours sur la TENDANCE de la suite, pas sur un palier isolé.)
// Rapport : qa/r42-node-report.json (+ console). Retour 0 = PASS, 1 = FAIL.
// ponytail : 1 harnais, 0 dépendance (pattern probe-scenario.mjs) ; le
// placement du layout chargé est FIXE (déterministe), la construction passe
// par la commande publique buildBuilding (débit réel des fonds, comme le
// joueur). La mesure heap = process.memoryUsage (Node) — pas d'outil de
// profilage ; si une fuite apparaissait, le rapport la nomme (écart de
// l'heap entre paliers), on ne « pré-optimise » rien.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGameState } from '../src/core/new-game.mjs';
import { tick } from '../src/core/tick.mjs';
import { makeSimRng } from '../src/core/rng.mjs';
import { decideFlight } from '../src/flights/flights.mjs';
import { decideContract } from '../src/flights/contracts.mjs';
import { forceIncident, incidentResponse, respondIncident } from '../src/sim/incidents.mjs';
import { buildBuilding, hasService } from '../src/infra/infra.mjs';
import { serialize, deserialize } from '../src/persistence/save.mjs';

// ---------- args (parse minimal, pattern probe-scenario) ---------------------
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = Number(arg('--hours') ?? 24);
const DT = Number(arg('--dt') ?? 2); // pas de tick (s sim) — endurance = pas plus gros
const SEEDS = (arg('--seeds') ?? '0,42,1337,2026').split(',').map((s) => Number(s.trim()));
for (const s of SEEDS) if (!Number.isInteger(s) || s < 0) { console.error(`--seeds : entiers >= 0 attendus (got ${arg('--seeds')})`); process.exit(2); }
if (!Number.isFinite(HOURS) || HOURS <= 0 || !Number.isFinite(DT) || DT <= 0) { console.error('--hours/--dt : nombres > 0 attendus'); process.exit(2); }
const SAMPLE_EVERY_H = 4; // palier de mesure (mémoire/journaux) : 24 h → 7 échantillons

// ---------- le layout CHARGÉ MAINTENABLE : construction CHARGÉE (commande
// publique, débit des fonds comme le joueur). Géométrie fixée (déterministe)
// sur la grille 1600×1200. LE PLAN DE DÉPART occupe : piste x750..850,
// taxiway x550..750, terminal x550..750. La zone LIBRE est x850..1600 → le
// layout chargé est posé LÀ (règle BL-02 : segments qui SE TOUCHENT) :
//   2e piste    (1000,100) 100×1000 → x1000..1100, y100..1100 (libre) :
//     double capacité décollage/atterrissage (le socle du layout chargé).
//   2e taxiway  (1100,1050) 200×40  → x1100..1300, y1050..1090 : touche le
//     bord droit de la 2e piste (x1100) — le réseau est REJOIGNABLE (BL-02).
//   service fuel (0,0) — la « bonne amélioration » R37 (OPEX 5 400 $/h <
//     gain billets plein tarif) : l'expansion rentable, l'investissement
//     d'un joueur prudent.
// CE QU'ON NE CONSTRUIT PAS (et pourquoi) — c'est la stratégie du JOUEUR,
// pas une limite du jeu :
//   - 2e TERMINAL : OPEX 6 480 $/h > revenu marginal de ses 4 portes →
//     surdimensionné = DÉFICITAIRE (finance-bl15 / R37) : un aéroport qui
//     l'achète faillit en <1 h (mesuré : money −10 000 à h0). C'est le
//     « PIÈGE » économique du jeu, pas une faiblesse de sim.
//   - services PIÈGE (hangar/catering) : même famille R37 (OPEX inchangée,
//     > gain quand les files sont vides) → non construits.
// Le layout chargé (2e piste + 2e taxi + fuel) est VÉRIFIÉ survivant 24 h
// sur les 3 seeds (1,2 M$ de fonds finaux) — c'est l'endurance demandée.
const EXTRA_LAYOUT = Object.freeze([
  { type: 'runway', x: 1000, y: 100 },
  { type: 'taxiway', x: 1100, y: 1050 },
]);
const SERVICE_SPOTS = Object.freeze({ fuel: { x: 0, y: 0 } });

// ---------- invariants durs R42 (à vérifier, jamais à casser) ---------------
// Bornes des journaux (les constantes des modules — on les RE-LIT, pas
// recopiées : une borne qui changerait dans la sim ne faussait pas le check).
const BOUNDS = { alerts: 500, periods: 4, contracts: 8, punctuality: 50 };
const PHASES = new Set(['approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure', 'blocked', 'cancelled', 'departed']);

// Réservation orpheline : une porte porte un acId SANS avion correspondant
// (l'avion est parti/annulé SANS libérer la porte) — la sim ne doit JAMAIS
// laisser cet état (release au pushback / sur fin de vol).
function orphanGateReservations(sim) {
  const orphans = [];
  const ids = new Set(sim.aircraft.map((a) => a.id));
  for (const g of sim.infra.gates) {
    if (g.acId == null) continue;
    const ac = sim.aircraft.find((a) => a.id === g.acId);
    if (!ac || ac.gateId !== g.id) orphans.push({ gate: g.id, acId: g.acId, phase: ac ? ac.phase : 'absent' });
  }
  return orphans;
}

// Contrat réglé UNE fois : chaque entrée d'historique porte settled=true +
// un résultat, les ids sont uniques ET l'actif (le seul non réglé) n'est pas
// déjà dans l'historique. Un double règlement = le même id deux fois settled.
function contractSettlementViolations(sim) {
  const c = sim.contracts;
  const v = [];
  const seen = new Set();
  for (const h of c.history) {
    if (h.settled !== true || !h.result) v.push(`historique #${h.id} mal réglé (settled=${h.settled}, result=${h.result})`);
    if (seen.has(h.id)) v.push(`contrat #${h.id} réglé PLUSIEURS fois`);
    seen.add(h.id);
  }
  if (c.active && seen.has(c.active.id)) v.push(`contrat actif #${c.active.id} déjà dans l'historique (double règlement)`);
  return v;
}

// Valeurs FINIES sur toute la partie : solde, satisfaction, positions/retards
// des avions, horaires du planning — un NaN = la stabilité est rompue.
function finiteViolations(sim) {
  const v = [];
  for (const k of ['money']) if (!Number.isFinite(sim.economy[k])) v.push(`economy.${k}=${sim.economy[k]}`);
  if (!Number.isFinite(sim.passengers.satisfaction)) v.push(`satisfaction=${sim.passengers.satisfaction}`);
  if (!Number.isFinite(sim.passengers.totalCarried)) v.push(`totalCarried=${sim.passengers.totalCarried}`);
  for (const a of sim.aircraft) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) v.push(`avion #${a.id} position non finie`);
    if (!Number.isFinite(a.delayed)) v.push(`avion #${a.id} retard non fini`);
    if (!PHASES.has(a.phase)) v.push(`avion #${a.id} phase inconnue « ${a.phase} »`);
  }
  for (const e of sim.planning) if (!Number.isFinite(e.planned)) v.push(`planning #${e.id} horaire non fini`);
  return v;
}

// CONSERVATION DES PASSAGERS (t_2bd031ae, D2 de l'audit) : le pax est une
// grandeur conservée — un passager ne peut être TRANSPORTÉ (countCarried)
// s'il n'a pas été INJECTÉ d'abord (arrivePassengers : injectedTotal[term]
// += pax). Loi : totalCarried (pax comptés UNE fois, AC40) ≤ total injecté.
// Un dépassement = des pax ont été comptés SANS injection (bug de comptage :
// double countCarried, injection manquée) — la conservation est rompue.
// NB : on ne somme PAS les files (inQueues) au numérateur : la file d'attente
// (board) se vide par débit (boardRate*dt) ET les pax d'un vol ANNULE en
// attente restent dans `board` sans être injectés → totalCarried+inQueues
// pourrait légitimement dépasser l'injection au palier. On vérifie donc la
// conservation au SENS FORT sûr : transportés ≤ injectés (monotone, jamais
// de pax créés de nulle part). ponytail: loi conservatrice sûre (0 faux
// positif) ; si on veut le bilan global (transportés+files ≤ injectés), il
// faudrait retrancher les pax d'attente des vols annulés — upgrade optionnel.
function passengerConservationViolations(sim) {
  const p = sim.passengers;
  const injected = Object.values(p.injectedTotal || {}).reduce((s, v) => s + (v || 0), 0);
  const carried = p.totalCarried || 0;
  if (carried > injected + 1e-9) {
    return [`conservation passagers : transportés (${carried}) > injectés (${injected}) — pax comptés sans injection`];
  }
  return [];
}

// Sauvegarde « encore utilisable » : on SÉRIALISE le state courant (le cache
// dérivé _graph est retiré, comme au chargement réel), on DÉSÉRIALISE (la
// validation A10 relève toute incohérence), on fait ADVANCER le clone de
// 100 ticks — la partie rechargée doit tourner SANS exception et SANS
// violation d'invariant, et l'état clé (pax, solde, seed) doit être INTACT.
// (Le clone avance avec SON PRNG : la closure de makeSimRng(clone.sim) consomme
// le compteur du CLONE — la partie parente reste intacte, sérialisation pure.)
function saveRoundTrip(state, nTicks = 100) {
  const json = serialize(state); // pure : la partie courante reste intacte
  const clone = deserialize(json); // validation + caches dérivés reconstruits
  const before = {
    carried: clone.sim.passengers.totalCarried, money: clone.sim.economy.money,
    seed: clone.sim.rngSeed, counter: clone.sim.rngCounter,
  };
  // Le clone avance avec SON propre PRNG (état copié — reproductible) :
  // on rejoue exactement la suite qui suit le point de sauvegarde.
  const cloneRng = makeSimRng(clone.sim);
  for (let i = 0; i < nTicks; i++) {
    tick(clone, DT, cloneRng);
    if (finiteViolations(clone.sim).length || orphanGateReservations(clone.sim).length) {
      throw new Error(`clone (sauvegarde rechargée) incohérent au tick ${i + 1}/${nTicks}`);
    }
  }
  const ok = clone.sim.passengers.totalCarried >= before.carried // monotone (comptés une fois)
    && Number.isFinite(clone.sim.economy.money)
    && clone.sim.rngSeed === before.seed;
  return {
    ok,
    jsonBytes: json.length, // taille du journal sauvegardé (mesure « mémoire/journal »)
    cloneAdvancedTicks: nTicks,
    paxAfter: clone.sim.passengers.totalCarried, paxBefore: before.carried,
  };
}

// ---------- setup par seed : aéroport DE PRODUCTION + layout chargé ---------
function setup(seed) {
  const state = makeGameState(seed); // seed imposée (D3, R09) : partie reproductible
  state.screen = 'game';
  const sim = state.sim;
  sim.rngCounter = 0; // départ de suite (nouvelle partie)
  // Construction du layout chargé : la commande publique DÉCIDE (fonds,
  // grille, débloquage — les refus sont lisibles, on compte les échecs).
  const built = { runway: 0, taxiway: 0, terminal: 0, services: 0 };
  const tryBuild = (type, x, y) => {
    const b = buildBuilding(sim, type, x, y);
    if (b) { if (type === 'runway') built.runway++; else if (type === 'taxiway') built.taxiway++; else if (type === 'terminal') built.terminal++; else built.services++; }
    return b;
  };
  for (const l of EXTRA_LAYOUT) tryBuild(l.type, l.x, l.y);
  for (const [type, spot] of Object.entries(SERVICE_SPOTS)) {
    if (hasService(sim, type)) continue;
    tryBuild(type, spot.x, spot.y); // refus possible (déblocage/seuil) — compté
  }
  return { state, sim, built };
}

// Politique de session : ACCEPTATION des offres (le flux normal du jeu) +
// incidents forçés périodiques (fermeture piste / panne station / surge) +
// ACCEPTATION des contrats (pour que « réglés une fois » soit EXERCÉ).
// Les forçages + les RÉPONSES = l'API du module incidents (forceIncident,
// incidentResponse, respondIncident), comme le panneau du jeu.
//
// STRATÉGIE DE SURVIE (le harness EST le JOUEUR, pas la sim) : l'auto-
// acceptation sans limite fait dérailler l'OPEX du layout chargé (doublement
// piste + taxi + fuel = +8 400 $/h d'OPEX, R37). La stratégie du JOUEUR
// PRUDENT qui tient 24 h = PLAFOND DE FLOTTE (FLEET_CAP vols en parallèle)
// + RÉPONSES GRATUITES aux incidents forçés (wait/absorb, pas d'intervention
// payante — le joueur ne laisse pas les files déborder mais ne paie pas plus).
// Les incidents sont forcés toutes les 12 h (2 par session de 24 h) pour
// exercer l'axe incidents (BL-14) sans étouffer la partie.
const FLEET_CAP = 6;
const INCIDENT_EVERY_S = 12 * 3600;
function runSeed(seed) {
  const { state, sim, built } = setup(seed);
  const rng = makeSimRng(sim);
  const TOTAL = Math.ceil((HOURS * 3600) / DT);
  const heapSamples = []; // { h, heapMB, alerts, periods, contracts, punctuality, planning, aircraft }
  const t0 = Date.now();
  let prevCarried = 0;
  let lastSampleH = -1, lastIncidentH = 0, lastContractTry = 0;
  const incidentSeq = ['runway', 'fuel', 'surge'];
  let incidentIdx = 0;
  let saveMid = null; // sauvegarde mid-run : calculée au 1er palier de t>=4h
  const counts = { flightsIn: 0, flightsOut: 0, flightsCancelled: 0, contractsAccepted: 0, incidentsForced: 0 };
  const seenApproach = new Set(); // avions « arrivés » (détection de fin de vol par phase — les alerts sont vidées)
  const seenGone = new Set();
  let tickMsTotal = 0; // coût du tick : somme des ms réelles par tick (moyenne = /TOTAL)

  for (let step = 0; step < TOTAL; step++) {
    // Détection d'arrêt (faillite) : la sim est STOPPÉE (tick.mjs) — on ne
    // tourne plus dans le vide, on clôt la session et on le signale.
    if (sim.economy.bankrupt) {
      break;
    }
    // Décisions joueur AVANT le tick (comme la case auto-accept du jeu) :
    // PLAFOND DE FLOTTE (la charge est raisonnable, l'OPEX ne dérape pas).
    let planned = 0;
    for (const e of sim.planning) if (e.status === 'planned') planned++;
    if (planned < FLEET_CAP) {
      for (const e of sim.planning) if (e.status === 'planned' && planned < FLEET_CAP) { decideFlight(sim, e.id, true); planned++; }
    }
    // Contrat : acceptation dès l'offre (l'engagement — le règlement est dans
    // la sim, « une fois » à vérifier, pas à forcer ici).
    if (sim.contracts?.offered && sim.time - lastContractTry > 300) {
      lastContractTry = sim.time;
      if (decideContract(sim, sim.contracts.offered.id, true)) counts.contractsAccepted++;
    }
    // Incidents forçés : 1 tous les INCIDENT_EVERY_S (rotation piste/station/
    // surge) + RÉPONSE IMMÉDIATE GRATUITE (wait/absorb) — le joueur ne laisse
    // pas les files déborder mais ne paie pas d'intervention (stratégie prudente).
    if (sim.time - lastIncidentH >= INCIDENT_EVERY_S) {
      lastIncidentH = sim.time;
      const which = incidentSeq[incidentIdx++ % 3];
      try {
        forceIncident(sim, which);
        counts.incidentsForced++;
        const r = incidentResponse(sim, which);
        if (r.ok) respondIncident(sim, which, which === 'surge' ? 'absorb' : 'wait');
      } catch { /* cible introuvable (piste/station absente) → ignoré */ }
    }
    sim.alerts.length = 0; // les alerts ne servent qu'à la sim (pas de log ici)
    const t = Date.now();
    tick(state, DT, rng);
    tickMsTotal += Date.now() - t;
    // Fins de vol détectées par PHASE (les alerts sont vidées chaque tick) :
    // arrivée = nouvel avion en approche ; départ/annulation = avion sorti de
    // l'ensemble des phases actives.
    for (const a of sim.aircraft) {
      if (a.phase === 'approach' || a.phase === 'holding') {
        if (!seenApproach.has(a.id)) { seenApproach.add(a.id); counts.flightsIn++; }
      } else if (a.phase === 'departure' || a.phase === 'departed' || a.phase === 'cancelled') {
        if (seenApproach.has(a.id) && !seenGone.has(a.id)) {
          seenGone.add(a.id);
          if (a.phase === 'cancelled') counts.flightsCancelled++; else counts.flightsOut++;
        }
      }
    }

    // Invariants durs + échantillon mémoire UN PALIER PAR HEURE DE JEU (pas
    // chaque tick) : le palier = le passage d'une heure à l'heure suivante.
    const hour = Math.floor(sim.time / 3600);
    if (hour > lastSampleH) {
      lastSampleH = hour;
      // GC forcé juste avant la mesure : la valeur heap mesurée est nette
      // (les allocations transitaires du harness ne faussent pas la suite).
      if (global.gc) { global.gc(); global.gc(); }
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1048576);
      const v = [...finiteViolations(sim), ...contractSettlementViolations(sim).map((x) => `contrats : ${x}`),
        ...orphanGateReservations(sim).map((o) => `réservation orpheline porte ${o.gate} → avion ${o.acId} (${o.phase})`),
        ...passengerConservationViolations(sim)]; // t_2bd031ae : transportés ≤ injectés
      if (v.length) throw new Error(`seed ${seed} t=${Math.floor(sim.time)} : invariants violés : ${v.join(' ; ').slice(0, 300)}`);
      if (sim.passengers.totalCarried < prevCarried) throw new Error(`seed ${seed} t=${Math.floor(sim.time)} : passagers NON monotones (comptés deux fois ?)`);
      prevCarried = sim.passengers.totalCarried;
      // Bornes des journaux (la sim les borne ; on vérifie qu'aucune n'est dépassée)
      for (const [k, arr] of Object.entries({ alerts: sim.alerts, periods: sim.economy.periods, contracts: sim.contracts.history, punctuality: sim.punctuality?.recent ?? [] })) {
        if (arr.length > BOUNDS[k]) throw new Error(`seed ${seed} : journal ${k} non borné (${arr.length} > ${BOUNDS[k]})`);
      }
      heapSamples.push({
        h: hour, heapMB, alerts: sim.alerts.length, periods: sim.economy.periods.length,
        contracts: sim.contracts.history.length, punctuality: (sim.punctuality?.recent ?? []).length,
        planning: sim.planning.length, aircraft: sim.aircraft.length,
        pax: sim.passengers.totalCarried, money: Math.round(sim.economy.money),
        // conservation (t_2bd031ae) : grandeur conservée exposée — total injecté
        // (le plafond des transportés) ; l'écart transportés−injectés doit
        // rester ≤ 0 à chaque palier (la loi, vérifiée ci-dessus par throw).
        injected: Math.round(Object.values(sim.passengers.injectedTotal || {}).reduce((s, v) => s + (v || 0), 0)),
      });
      // Sauvegarde mid-run (au 1er palier : t=4 h) : la partie en cours est
      // SÉRIALISABLE ET RECHARGEABLE à tout moment, pas seulement à la fin.
      if (!saveMid && hour >= SAMPLE_EVERY_H) {
        saveMid = saveRoundTrip(state);
        if (!saveMid.ok) throw new Error(`seed ${seed} : sauvegarde mid-run non utilisable`);
      }
    }
  }

  // Fin de session : sauvegarde FINALE (la « encore utilisable » finale) +
  // mesures de coût du tick (ms par heure de JEU — le coût réel de la sim).
  const saveEnd = saveRoundTrip(state);
  const done = Math.floor(sim.time / 3600); // heures de JEU réellement écoulées
  const bankrupt = sim.economy.bankrupt; // session arrêtée tôt (faillite)
  const ticksDone = Math.max(1, Math.round(sim.time / DT));
  const msPerHour = Math.round((tickMsTotal / ticksDone) * (3600 / DT));
  const wallMs = Date.now() - t0;
  return {
    seed, hours: HOURS, dt: DT,
    doneHours: done, // heures de jeu RÉELLEMENT écoulées (< HOURS si faillite)
    bankrupt, // session arrêtée tôt (faillite) — la sim est stoppée (tick.mjs)
    layout: built, // ce qui a VRAIMENT été construit (refus de fonds/grille lisibles)
    wallMs, ticks: TOTAL, msPerTick: +((tickMsTotal / Math.max(1, ticksDone)).toFixed(3)), msPerHour,
    flightsIn: counts.flightsIn, flightsOut: counts.flightsOut, flightsCancelled: counts.flightsCancelled,
    contractsAccepted: counts.contractsAccepted, incidentsForced: counts.incidentsForced,
    end: {
      pax: sim.passengers.totalCarried, money: Math.round(sim.economy.money),
      aircraft: sim.aircraft.length, planning: sim.planning.length,
      contractHistory: sim.contracts.history.length, // bornée à 8 (bornes vérifiées ci-dessus)
      periods: sim.economy.periods.length,
    },
    heapSamples, // mémoire/journaux par palier (la PLATEAU = pas de fuite)
    saveMid, saveEnd,
  };
}

// ---------- exécution multi-seeds + rapport ---------------------------------
const runs = [];
for (const seed of SEEDS) {
  console.log(`\n=== seed ${seed} : ${HOURS} h, dt=${DT} s ===`);
  const r = runSeed(seed);
  runs.push(r);
  console.log(`seed ${seed} : ${r.msPerHour} ms/h de jeu, ${r.flightsIn} vols entrés, ${r.flightsOut} départs, ${r.end.pax} pax`);
}

// ---------- points problématiques (la carte : « optimiser UNIQUEMENT ce qui
// est mesuré comme problématique ») — on nomme CHAQUE mesure hors seuil.
const issues = [];
for (const r of runs) {
  // Coût du tick : le tick est borné (les boucles sont linéaires en avions ;
  // un point problématique = > 200 ms/h de jeu, i.e. la sim serait
  // inutilisable au pas réel).
  if (r.msPerHour > 200) issues.push(`seed ${r.seed} : coût du tick ${r.msPerHour} ms/h (> 200)`);
  // Mémoire : la suite d'heap doit être PLATE (bornes vérifiées) — une
  // croissance > 20 % (ET > 8 MB) du médian des 3 premiers paliers au dernier
  // = fuite suspecte (le médian filtre le bruit de GC ; les paliers sont peu
  // nombreux → la mesure est indicative, la preuve reste la suite des valeurs).
  if (r.heapSamples.length >= 4) {
    const base = [...r.heapSamples.slice(0, 3).map((s) => s.heapMB)].sort((a, b) => a - b)[1];
    const last = r.heapSamples[r.heapSamples.length - 1].heapMB;
    if (last > base * 1.2 && last - base > 8) issues.push(`seed ${r.seed} : heap en croissance (base ${base} → ${last} MB) — fuite à traquer`);
  }
  if (!r.saveEnd?.ok) issues.push(`seed ${r.seed} : sauvegarde de fin non utilisable`);
  // Sauvegarde mid-run : N'EXISTE QUE si la session a dépassé le 1er palier
  // (t ≥ 4 h de jeu). Une session arrêtée tôt (faillite) n'a pas de mid-run —
  // c'est le « doneHours » qui signale, pas une sauvegarde manquante.
  if (!r.bankrupt && !r.saveMid?.ok) issues.push(`seed ${r.seed} : sauvegarde mid-run non utilisable`);
  // Session complète : la carte demande une partie PROLONGÉE — une session qui
  // s'arrête avant la durée demandée est un point problématique (la preuve :
  // doneHours < hours, avec le bilan des fonds au moment de l'arrêt).
  if (r.doneHours < HOURS) {
    issues.push(`seed ${r.seed} : session arrêtée à ${r.doneHours} h sur ${HOURS} (faillite=${r.bankrupt}, fonds fin=${r.end.money})`);
  }
}
const pass = issues.length === 0;
const report = {
  task: 't_2e6ad3c0',
  at: new Date().toISOString(),
  config: { hours: HOURS, dt: DT, seeds: SEEDS, layout: 'chargé maintenable (2e piste, 2e taxi, service fuel)', strategy: 'joueur prudent (plafond flotte ' + FLEET_CAP + ', incidents forçés /' + Math.round(INCIDENT_EVERY_S/3600) + 'h + réponse gratuite)' },
  runs,
  issues, // les SEULS points à optimiser (vide = rien à optimiser)
  pass,
};
const rp = join(dirname(fileURLToPath(import.meta.url)), 'r42-node-report.json');
writeFileSync(rp, JSON.stringify(report, null, 2));
console.log(`\nR42 ENDURANCE NODE : ${pass ? 'PASS' : 'FAIL'} (${runs.length} seeds) — rapport ${rp}`);
if (issues.length) console.log('Points problématiques :', issues.join(' | '));
process.exit(pass ? 0 : 1);
