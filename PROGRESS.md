# PROGRESS — Airport Tycoon (point de reprise, AC30 / EV-7)

Base : `80a90ab` (80a90abf4d8000650135442018a263035b2cc1b8). Dernière mise à jour : 2026-10-01 (fin BL-00).

## État du backlog (BACKLOG.md, 20 cartes BL-00..BL-19)

| Carte | Statut |
|---|---|
| BL-00 Reproduction 8 risques + PROGRESS.md | **fait (2026-10-01)** |
| BL-01 Nouvelle partie aéroport fourni | **fait (commits c815180 + 382defd)** |
| BL-02 Connectivité physique (R1) | **fait (2026-10-02, worker t_fe23a99e)** |
| BL-05 R3 démolition (A6/A7) | **fait (2026-10-02, worker t_e207fa79)** |
| BL-04 R3 démolition après rechargement (A8) | **fait (2026-10-02, worker t_2f0ec04f, commit d43b290)** |
| BL-04 R5 déplacement continu (A9) | **fait (2026-10-02, worker t_7a67c46d)** |
| BL-14 Finances socle (A12, R8) | **fait (2026-10-02, worker t_f7d733b7, commits 6cb4064 + 4771ff3)** |
| BL-13 Parcours passager agrégé (NONMVP-2, AC7, AC22, AC40) | **fait (2026-10-02, worker t_ad0ed66b, commit a3f405e)** |
| BL-03..BL-19 | en attente de leurs dépendances (BL-03 attend BL-02, BL-04/BL-05/BL-09 attendent BL-03, …) |

## Preuves obtenues

- `evidence/audit-80a90ab/A1..A14.json` : chaque preuve horodatée (`runAt`) + `commitGit`,
  exécutée via `run-probes.js` (harnais racine, réutilisable). **8/8 risques R1-R8 confirmés**
  (`SUMMARY.json`). Détail : R1=A1/A2, R2=A3/A4/A5, R3=A6/A7, R4=A8/A13, R5=A9, R6=A10/A11,
  R7=A12, R8=A14.
- A7 : l'erreur `Cannot read properties of undefined (reading 'seg')` est INSÉRIE dans
  `A7.json` (champ `error`), car la sonde la capture en sortie de sa fonction (le `throw`
  survit jusqu'au JSON final).
- **BL-02 (2026-10-02) : R1 plus reproduisible.** Re-lance des sondes sur l'arborescence
  corrigée (après le commit BL-02) :
  - **A1** : `gateNodeOf` renvoie `undefined` (porte hors réseau) → la sonde lève
    `Cannot read properties of undefined (reading 'x')` au lieu du chemin fantôme
    (avant : `path [1,0]`, `distanceGateNode 374.2`). **Non confirmée.**
  - **A2** : `confirmed: false` (avant : chemin fantôme `[800,1100]→[600,1070]→[400,1070]`
    sur 150 px de terrain). **Non confirmée.**
  - Tests de régression dans `tests/sim.test.mjs` (sonde A1, sonde A2, coupage de taxiway
    = blocage réel) : 39/39 pass sur les fichiers non touchés par BL-01 (sim/game/build-save).
- Valideur : `node --test tests/*.test.mjs` → 36/36 pass sur `80a90ab`
  (36 ✔, 0 fail, 98 ms ; npm-cli.js cassé ici, A-4).
- **BL-05 (2026-10-02) : R3 plus reproduisible.** Re-lance des sondes sur
  `722afa3` (commit de correction) → `evidence/audit-722afa3/` :
  - **A6** : démolition REFUSÉE (`ok: false`, `why: "porte occupée"`) — avant :
    le terminal multi-portes était détruit avec un avion au sol (`gateIdAfter: null`).
    **Confirmée (comportement corrigé).**
  - **A7** : démolition du taxiway, `error: null`, avion passé en `blocked`
    (chemin périmé remis à zéro à la démolition, retry au tick suivant) — avant :
    `Cannot read properties of undefined (reading 'seg')`. **Confirmée (comportement corrigé).**
  - SONDÉS CORRIGÉS dans `probes.mjs` (dossier d'audit) : A6/A7 attendent maintenant le
    comportement CORRIGÉ (refus / pas d'exception), géométrie connective BL-02
    (avion posé sur `path[0]`, nœud du taxiway). `SUMMARY.json` : 4/8 risques
    confirmés — **R3 (A6/A7 : comportement corrigé)**, R5 (A9), R6 (A10/A11), R7 (A12) ;
    non confirmés : R1 (A1 : sonde KO sur `gateNodeOf` undefined — comportement
    corrigé, sonde à mettre à jour par sa carte), R2 (A3/A4/A5 : BL-03 corrigé, les
    sondes attendent encore le comportement BUGGUÉ), R4 (A8/A13) et R8 (A14) :
    cartes à venir.
  - Valideur : `npm test` → 48/48 pass sur `722afa3` (46 + 2 tests de régression R3-A6/A7).
- **BL-04 (2026-10-02) : R5 plus reproduisible.** Correction de A9 sur le commit
  `788ecb6` (preuve : `evidence/audit-788ecb6/A9.json`) :
  - Cause racine : `doLanding` recollait l'avion sur l'axe de piste en UN tick
    (saut horizontal de 600 px, dt 0.1) et `doGate` était un simple relais de
    phase — l'avion restait 51,5 px du centre de la porte (au nœud du taxiway).
  - Correction : le landing converge latéralement vers l'axe de piste à V.taxi
    (borné par tick) ; nouvelle phase « docking » (taxi → docking → gate) qui
    roule l'avion du nœud de porte au CENTRE de la porte. Preuve : écart
    porte-centre = **0** (avant 51,5), max pas horizontal = **6 px** (avant
    600). SONDÉ CORRIGÉ dans `probes.mjs` (A9 attend le comportement corrigé) ;
    `SUMMARY.json` : R5 confirmée (comportement corrigé).
  - 2 tests de régression AC18 ajoutés dans `tests/sim.test.mjs` (échouaient
    sur le code d'avant) ; `npm test` → 54/54 pass sur `788ecb6`.
- **BL-04 A8 (2026-10-02) : R3 après rechargement plus reproduisible.** Correction
  dans `src/infra/infra.mjs` (`demolishBuilding`) : après `deserialize`, le graphe
  pathfinding (cache dérivé) est remis à `null` et le 1er tick fait le rebuild —
  la garde A7 (invalidation des chemins périmés à la démolition) lisait
  `sim._graph.nodes` et crashait (`Cannot read properties of null (reading 'nodes')`)
  quand on démolissait un taxiway occupé SANS tick entre le rechargement et la
  démolition. Correction : `rebuildGraph` avant la lecture si `sim._graph` est null
  (chemin périmé = indices de l'ANCIEN graphe, jamais persistés : remis à zéro,
  avion → `blocked` + retry au tick suivant). Test de régression `R3-A8` dans
  `tests/invariants.test.mjs` (échouait AVANT la correction, RED vérifié) + sonde
  racine `probe-a8.mjs` (repro : `deserialize → demolish taxiway occupé` sans
  exception, avion en attente). `npm test` → 51/51 ; `node --test tests/*.test.mjs`
  → 78/78 pass.
- **BL-14 (2026-10-02) : R8/A12 plus reproduisibles.** Correction sur le commit
  `6cb4064` (preuve : `evidence/audit-6cb4064/A12.json`) :
  - Cause racine : `tickEconomy` ne comptait que les services construits
    (fuel/hangar/maintenance/catering) — le socle (piste, taxiway, terminal) ne
    coûtait rien : sans vol, les fonds ne bougeaient jamais (R8) et l'exploitation
    n'existait pas (A12 : `moneyAfterOneSimHour` = `moneyBefore`).
  - Correction : `OPEX_PER_SEC` (catalog.mjs) couvre piste 1.2/s, taxiway 0.2/s,
    terminal 1.8/s + services ; le carburant des départs passe par `charge`
    (compte dédié `spent.fuel`, A-6) — plus de « recette négative »
    `revenue['fuel-cost']`. Nouveau `periodStatement(sim)` : bilan lisible
    (recettes/exploitation/carburant/investissements + causes du déficit, AC23).
  - Preuve : `A12.json` → `confirmed: false` (`moneyAfterOneSimHour: -200540`,
    `spent.opex: 11520`). 5 tests dans `tests/economy.test.mjs` (scénarios
    déficit/faillite + rentable) ; `node --test tests/*.test.mjs` → 59/59 pass.
- **BL-13 (2026-10-02) : parcours passager agrégé livré** (commit `a3f405e`) :
  nouveau module `src/sim/passengers.mjs` — les passagers voyagent en GROUPES
  liés vol/terminal (AC22), pas un simple total transporté (AC40) : parcours
  débarquement → check-in → sécurité → attente → embarquement, files VISIBLES
  (`sim.passengers.queue`, occupation 0..1, HUD `src/ui/renderer.mjs`),
  satisfaction ÉVOLUTIONNE (pénalité sur les files saturées, récupération
  quand les files sont vides — un retard ancien ne condamne pas indéfiniment).
  Comptage unique à l'embarquement (`countCarried`) ; les groupes orphelins
  (vol parti en cours de parcours) sont épurgés sans fausse comptabilité.
  5 tests dans `tests/passengers.test.mjs` : saturation (files pleines,
  satisfaction mesurable qui baisse), dénouement (files vides, satisfaction
  remonte), 4 × 144 pax → `totalCarried` = 576 exactement, orphelins (vols
  partis sans embarquer → 0 compté), repos (aucune perte fantôme).
  `node --test tests/*.test.mjs` → 83/83 pass.

## Décision

Reproduire AVANT de corriger (règle partagée du backlog) : fait pour les 8 risques.
Les 36 tests passent mais ne sont PAS un certificat de conformité (A14, R7) :
chaque carte de correction devra fournir un test de régression qui échouait AVANT
la correction (AC33, EV-2). **BL-02 (R1) corrigée le 2026-10-02** : connectivité
physique (taxiway construit qui touche les segments), porte à destination explicite,
test négatif A1/A2 + coupage de taxiway.

## Problème ouvert

Aucun blocant. Point d'attention : `run-probes.js` est un harnais racine (non commité)
qui lit les sondes du dossier d'audit ; garder à jour si les sondes changent.

**Collision BL-01 × BL-02 (2026-10-02) — RÉSOLUE.** Les deux cartes tournaient en
parallèle sur la même arborescence : le worker BL-01 (t_a02aea3e) avait d'abord
ébauché un `START_LAYOUT` (taxiway 400,1050 + terminal 400,900) reposant sur la
connectivité par proximité que BL-02 supprime → `tests/new-game.test.mjs` échouait
(2/2). BL-01 a réaligné son plan sur la géométrie « touchante » prouvée
(taxiway (550,1050) + terminal (550,900)) : le validateur complet passe 41/41.
BL-01 devra committer son travail (`src/core/new-game.mjs`, `src/infra/infra.mjs`,
`tests/new-game.test.mjs`). Le commit BL-02 ne touche QUE
`src/pathfinding/path.mjs` + `tests/sim.test.mjs` + `PROGRESS.md`.

## Prochaine tâche bornée

**BL-01** — Nouvelle partie avec aéroport fourni (MVP-1, AC1, AC38, A-2) :
`src/core/new-game.mjs` = 1 piste + terminal 2 portes + taxiway connectés ; fin = 1 vol
complet sans construction préalable + test `node --test`.
