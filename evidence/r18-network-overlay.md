# R18 — Preuve : overlay réseau/capacités (rupture identifiable, diagnostic = même graphe/même règle)

Tâche : t_814e1b40 (R18). Prerequis : G1, G2, R04, R13, R15, R17 (tous clos,
G1 validé sur 2369c67). Décision : **l'overlay est une LECTURE du MÊME graphe
(`sim._graph`) et de la MÊME règle que la sim** — aucune 2e règle pathfinding,
aucun état dérivé sérialisé ; l'overlay est un écran de diagnostic, pas une
mécanique jouable (les capacités restent lues en sim).

## Résultat

1. **Même graphe, même règle (critère 1).** `overlayState(sim)`
   (src/ui/overlay.mjs, LECTURE SEULE — aucune mutation, importable sous Node)
   lit :
   - les SEGMENTS : les arêtes du graphe de la sim (`sim._graph.edges`, même
     nœuds/indices que path.mjs), occupation lue de `ac.seg` (le SEUL champ
     d'occupation taxi de la sim, aircraft.mjs) ;
   - les PISTES : `sim.infra.runways` + fermeture lue de `sim.incidents.runway`
     (pas d'état d'incident parallèle) ;
   - les PORTES : joignabilité = `gateReachable(sim, g)` — la PRIMITIVE MÊME de
     la sim (infra.mjs, réexportée par R18, 1 ligne de diff) : le diagnostic
     écran = le MÊME graphe ET la MÊME règle que `gateFor`/`hasAccessiblePath`
     (flights.mjs, qui réutilisent déjà gateReachable — pas de 2e règle).
     Rupture = `ok:false` + avion `blocked` dessus (phase de la sim).

2. **Rupture identifiable sur l'écran (critère 2), pas seulement dans les
   stats.** L'overlay est peint au canvas quand la préférence d'affichage
   `state.networkOverlay` est active (touche O, INACTIVE par défaut — une préférence
   d'affichage, sérialisée avec l'état : on rechargé, l'overlay reste tel qu'on
   l'avait laissé). Taxiway coupé → les segments du graphe manquent, les portes
   passent `ok:false` (rouge) + pastille sur les avions bloqués : la rupture se
   voit À L'ÉCRAN dès l'activation, sans consulter les statistiques.

3. **UI fine respectée.** Le module overlay ne branche QUE la lecture
   (overlayState) ; la décision (construction/démolition, règles de la sim)
   reste dans les modules de sim ; l'UI ne crée aucune nouvelle dépendance de
   règle. L'overlay s'accroche au renderer existant (ui/overlay.mjs, touche O
   câblée main.mjs) ; `sim._graph` est un cache dérivé reconstruit (R03),
   jamais sérialisé — l'overlay ne sérialise AUCUN état dérivé.

## Fichiers

- `src/infra/infra.mjs` — `gateReachable` EXPORTÉ (la règle existante, telle
  quelle : le MÊME critère que flights.hasAccessiblePath).
- `src/ui/overlay.mjs` — NOUVEAU : `overlayState(sim)` (lecture pure du graphe
  + occupation + incidents + gateReachable) + `drawNetworkOverlay(ctx, cam,
  viewSize, sim)` (rendu canvas : segments rouge=saturation, pistes grises,
  pistes fermées hachurées, portes vert/rouge, pastilles sur avions bloqués).
- `src/main.mjs` — touche O (toggle `state.networkOverlay`, toast) + overlay
  branché au renderer (actif quand la préférence est ON).
- `tests/r18-network-overlay.test.mjs` — 3 tests (preuve ci-dessous).
- `qa/mvp-gate.mjs` — 2 checks R18 (touche O réelle + pixels canvas de la
  rupture, ON > OFF) — la rupture lisible SUR L'ÉCRAN est prouvée en navigateur.

## Preuve (tests, zéro DOM, déterministe + PORTE CDP)

`tests/r18-network-overlay.test.mjs` — 3/3 :
1. **Lecture du MÊME graphe** : socle de départ → 2 segments (piste +
   taxiway) lus dans `sim._graph.edges`, occupation lue de `ac.seg`, fermeture
   piste lue de `sim.incidents.runway` ; les 2 portes M du socle sont
   `ok:true` ET l'overlay est D'ACCORD avec `gateReachable` (la règle de la
   sim) porte par porte.
2. **Coupure → rupture identifiable** : démolition du SEUL taxiway du socle
   (démolishBuilding, graphe reconstruit R03) → `segs` = 1 (la piste), les 2
   portes `ok:false` (COUPÉES, d'accord avec gateReachable) ; un avion
   `blocked` sur une porte coupée → flag `blocked` (rupture lisible).
3. **Préférence d'affichage** : `state.networkOverlay` ABSENTE d'un état neuf
   (overlay INACTIF par défaut) et SURVIT à serialize/deserialize (pas d'état
   dérivé sérialisé ; la sim est intacte au cycle).

PORTE CDP `node qa/mvp-gate.mjs` — **20/20 PASS** (18 anciens + 2 R18,
entrées RÉELLES clavier/souris, zéro exception page / console, réseau 100 %
local) :
- `R18 overlay réseau : touche O (entrée réelle, toggle de l'état)` — O
  dispatchée par CDP → `state.networkOverlay === true`.
- `R18 overlay réseau : la rupture est lisible SUR L'ÉCRAN (pixels canvas ON >
  OFF)` — le rouge de l'overlay (#ff5252) est compté en pixels du canvas
  (getImageData) : OFF=0 → ON=96 sur la scène du réseau COUPÉ (l'avion
  bloqué est visé par pan clavier réel). La capture est
  `evidence/mvp-gate/04c-overlay-reseau.png` (réseau coupé + overlay ON).

## Compatibilité

- Invariants durs respectés : l'overlay est LECTURE (aucune mutation de la
  sim) ; aucun état dérivé sérialisé (le seul champ nouveau est
  `state.networkOverlay`, préférence d'affichage, tolérée par la validation R10
  — les sauvegardes anciennes chargent sans bump de version, overlay OFF par
  défaut) ; `sim._graph` reste un cache dérivé reconstruit (R03) ; sim sans
  DOM/timers/réseau ; pas de nouvelle dépendance (stdlib node:test, canvas 2D).
- `gateReachable` n'est pas modifiée (export 1 ligne) : la règle de la sim est
  INTACTE (R05/R13 : compatibilité + occupation centralisées en infra.mjs).
- Les chiffres/indications de l'overlay = MÊMES données que les règles
  (graphe, occupation, incidents, gateReachable) — pas de 2e règle.
- Checkout partagé : commit path-limited aux fichiers R18 ; les 65 fichiers
  non suivis protégés (qa/_*, docs/, RECONCILIATION_*.md, evidence/) intacts ;
  les 7 evidence/mvp-gate/* modifiés sont la régénération de la PORTE CDP
  (mêmes files, contenu actualisé par le run 20/20). Aucune
  publication/push/déploiement.

## Limitation

- L'overlay est un ÉCRAN (pas une mécanique jouable) : il lit l'occupation
  courante (ac.seg / incidents), il ne prédit pas les capacités futures — les
  capacités « disponibles/occupées » restent lues en sim (critère R18).
- La pastille « avion bloqué » est peinte quand un avion `blocked` a une
  position connue (x/y définis) : un avion juste entré en blocked avant sa
  1re position n'a pas encore de pastille (1 tick, négligeable).
- Vérifié au niveau sim + tests (196/196) ET navigateur : PORTE CDP 20/20.
