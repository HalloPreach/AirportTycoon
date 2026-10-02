# BL-10 — Intégrité de la suite de tests (MVP-9 : AC25/AC26/AC33, R7 : A14)

Preuve : `node --test tests/*.test.mjs` → **77/77 pass, 0 fail** (voir
`node-test-output.txt`, HEAD `b3d3b28`).

## Ce que cette carte a nettoyé (tests/*.test.mjs uniquement)

### A14 — comptage par IDENTIFIANT distinct, assertion exacte
`tests/sim.test.mjs` « plusieurs vols simultanés (critère 5) : 3 arrivées → 3 départs ».
- AVANT : `if (a.phase === 'departed') departures++` comptait à **chaque tick** où un
  avion restait « departed » (la purge est absente de cette boucle) → le compteur
  valait 3 alors qu'**un seul** avion était réellement parti ; l'assertion `>=2`
  laissait passer le faux positif (audit A14).
- APRÈS : `Set` par `id` (comptage par identifiant distinct) + `assert.equal(departed.size, 3)`
  (assertion **exacte**, pas `>=`). Réproduction : `probe-a14.mjs` (compte 3 départs
  distincts sur 3 ids, sans tickPlanner dans la boucle).

### EV-9 — invariants vérifiés APRÈS CHAQUE TICK
`tests/invariants.test.mjs` « AC15 : invariants de réservation tenus sur un cycle
multi-vols » : ajoute, à chaque tick (réservation déjà vérifiée via `g.acId`) :
- **comptes passagers** : `totalCarried` ne décroît jamais (monotone) ;
- **trésorerie** : `money = START_FUNDS + Σrevenue − Σspent − debt` (identité, tol. 1e-6 —
  dérive flottante de l'horloge) ; vérifiée empiriquement sur 20000 ticks via
  `probe-tresorerie.mjs` (écart max ~3e-8) ;
- **position** : coordonnées finies (jamais NaN/Infinity) pour tout avion non « departed ».

### R7 — plus de retour silencieux (test « muet » si la sim manque)
`tests/build-save.test.mjs` : les 3 tests de construction `if (!sim) return` (SKIP
silencieux = faux positif si le pont `src/core/sim.mjs` était cassé) → remplacés par
`assert.ok(sim, ...)` : le test **échoue proprement** si la sim n'est pas chargée.

## Hors périmètre (déjà couvert, non modifié)
- AC26 (a) coupes réseau, (b) conflits simultané/arrivée-départ : `invariants.test.mjs`.
- AC26 (d) capacité/compatibilité : `compatibility.test.mjs` + `sim.test.mjs` (retards).
- AC26 (f) coût exploitation / faillite / rentable : `economy.test.mjs`.
- AC26 (g) reprise multi-phases + fichiers corrompus : `persistence-valid.test.mjs`.
- Scénarios seed documentés (EV-10) : seed 42 (`compatibility`), seed 7 (`economy`),
  seed 1/2 (`sim`) — PRNG mulberry32 déterministe, état sérialisé (BL-08).

## Probes (reproduction, méthode AC33)
- `probe-a14.mjs` : reproduit le faux positif A14 puis montre 3 départs distincts.
- `probe-tresorerie.mjs` : valide l'identité trésorerie sur le cycle multi-vols.
