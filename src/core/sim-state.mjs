// État de la simulation : factory de l'objet `sim` (sérialisable tout seul).
// L'état global du jeu (game-state.mjs) ajoute un champ `.sim` ; l'UI ne branche
// que cet objet, elle n'importe jamais les règles (règle « UI fine »).
// Règle d'or : tout ce qui décide d'une règle passe dans les modules de sim ;
// tick() les orchestre. Déterministe si un PRNG semé est passé.
// BL-18 : budget de départ SOLVALE. L'aéroport de départ (piste+taxiway+terminal
// fournis, A-2) est DÉFICITAIRE sur 48 h en politique passive : l'exploitation
// socle (OPEX_PER_SEC, ~550 k$/48 h) + les indemnités vols annulés (321 k$) +
// le carburant dépassent les recettes (~535 k$). Avec 12 k$, le solde franchit
// −10 000 en ~3 h → faillite + gel de la sim (et le bug d'intérêts non capés
// verrouillait le solde au seuil). 345 k$ = le capital de départ qui rend le
// cycle 48 h SOLVALE (money > −10 000 en h=48, politique passive ET bl17 —
// fenêtre de refus + incident forcé, le scénario le plus dur) sans toucher
// l'équilibrage (OPEX_PER_SEC intact, critère A12 « socle coûte même sans vol »
// préservé). Mesures (seed 42, intérêts capés) : passive min +57 809, bl17
// min +18 351 — les deux au-dessus du seuil.
// t_00ecae73 : LE CAPITAL RESTE LE VRAI (12 000), pas gonflé. Le déficit 48 h
// venait d'une cause racine LOGIQUE : le planificateur planifiait des vols que
// l'aéroport ne pouvait pas servir (portes S/L inexistantes à la base) → 638
// annulations → 319 k$ d'indemnités (6× l'opex). Corrigée (planOneFlight ne
// planifie que les types SERVABLES — une piste assez longue + une porte de la
// taille), l'aéroport de base est de nouveau solvable avec 12 000 : l'opex
// (~550 k$/48 h) est couvert par les recettes (vol médium servable). On ne
// gonfle PAS le capital pour faire passer le scénario — on corrige l'équilibrage
// à la racine.
export const START_FUNDS = 12000; // capital légitime (pas gonflé, t_00ecae73)

export function newSimState() {
  return {
    infra: {
      nextId: 1,
      runways: [],   // {id, x, y, w, h, len}
      taxiways: [],  // {id, x, y, w, h}
      terminals: [], // {id, x, y, w, h, gates:[ids]}
      gates: [],     // {id, size, terminalId, x, y, w, h, acId, cleaning, maintenance}
      services: [],  // {id, type, x, y, w, h, target: terminalId|null, auto: bool} — R27 : `target` = terminal desservi (null = inactif), `auto` = affectation de la sim (réaffectable), pas du joueur
      // R28 : type fuel — `fuelOut` (bool, ABSENT/false = saine, true = panne
      // locale de CETTE station : ses lances sont hors service, la voisine
      // continue). Champ sérialisé naturellement (absent au JSON si jamais pas
      // mis — la validation de schéma ne le requiert pas : pas de propriété
      // fantôme à la reprise).
      grid: { w: 160, h: 120, cells: new Uint8Array(160 * 120) },
    },
    aircraft: [],    // un vol en cours de cycle (voir sim/aircraft.mjs)
    planning: [],    // vols planifiés (pas encore arrivés) : {id, airline, acType, pax, planned, status}
    nextAcId: 1,
    // Passagers agrégés (BL-13, AC22/AC40) : total transporté (compté UNE fois
    // à l'embarquement), satisfaction évolutive, groupes en cours + files PAR
    // TERMINAL (R30 : queues[terminalId] = {checkin,security,board}) + compteurs
    // de flux par terminal (injectedTotal/securityDone) — voir
    // src/sim/passengers.mjs. R30 : l'ancienne file GLOBALE `queue` (qui
    // permettait à un terminal de traiter les pax d'un autre sans règle) est
    // SUPPRIMÉE — les files, capacités et flux sont PAR TERMINAL ; les pax d'un
    // vol annulé sont retirés EXPLICITEMENT (removePassengers).
    passengers: { totalCarried: 0, satisfaction: 100,
                  queues: {}, groups: [], injectedTotal: {}, securityDone: {} },
    economy: { money: START_FUNDS, revenue: {}, spent: {}, debt: 0, bankrupt: false,
      // R16 : périodes financières (5 min de jeu) — les 4 dernières closes
      // (borné, comme R14) + l'accumulateur de clôture (_periodAcc, pattern
      // _spawnAcc) + la base des comptes cumulés au dernier close (la 1re
      // période mesure donc bien depuis t=0). Absent d'une sauvegarde
      // ancienne → le 1er close mesure depuis la reprise (dégradation lisible).
      periods: [], _periodAcc: 0, _periodBase: { revenue: 0, opex: 0, fuel: 0,
        compensation: 0, construction: 0, debt: 0 } },
    alerts: [],      // événements lisibles pour l'UI (toasts/alertes)
    // Incidents opérationnels (BL-14, A-7) : 3 incidents limités (piste fermée,
    // panne carburant, pic de demande) — état propre, sérialisable seul, tirés
    // par le rng semé (reproductible à la reprise). Voir src/sim/incidents.mjs.
    incidents: { runway: { closed: 0, acc: 0, last: 0 },
                fuel: { out: 0, acc: 0, last: 0 },
                surge: { active: false, remaining: 0, acc: 0, last: 0 } },
    time: 0,         // horloge de la sim (pilotée par le planificateur : sim.time += dt)
    _spawnAcc: 0,
    _graph: null,     // graphe pathfinding (reconstruit, pas sérialisé)
    _graphDirty: true,
    rngSeed: 0,       // état du PRNG (EV-10) : seed + compteur CONSERVÉS dans la
    rngCounter: 0,    // sauvegarde → la reprise après fermeture est reproductible
  };
}

// R14 : le journal est BORNE (MAX_ALERTS) — la partie de 48 h génère des
// milliers d'alertes, qui gonfleraient sim.alerts ET la sauvegarde (serialize
// écrit l'état entier à chaque auto-save) sans limite. On garde les 500 plus
// récentes : l'historique du panneau affiche déjà « les 50 plus récentes +
// compteur des plus anciennes » (ui/panels.mjs), et les toasts n'affichent que
// les 4 dernières — au-delà de MAX_ALERTS, le détail ancien n'a plus de
// destinataire. (Le consommateur main.mjs pointe par INDICE et consomme à
// chaque frame : les événements jamais lus restent dans la fenêtre des 500.)
const MAX_ALERTS = 500;

// Événement lisible pour l'UI (toast/alerte). L'UI lit sim.alerts, elle ne pollue pas l'état.
export function pushEvent(sim, e) {
  sim.alerts.push(e);
  if (sim.alerts.length > MAX_ALERTS) sim.alerts.splice(0, sim.alerts.length - MAX_ALERTS);
}
