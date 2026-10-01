# PROGRESS — Airport Tycoon (point de reprise, AC30 / EV-7)

Base : `80a90ab` (80a90abf4d8000650135442018a263035b2cc1b8). Dernière mise à jour : 2026-10-01 (fin BL-00).

## État du backlog (BACKLOG.md, 20 cartes BL-00..BL-19)

| Carte | Statut |
|---|---|
| BL-00 Reproduction 8 risques + PROGRESS.md | **fait (2026-10-01)** |
| BL-01 Nouvelle partie aéroport fourni | **en cours** (worker t_a02aea3e, non commité) |
| BL-02 Connectivité physique (R1) | **fait (2026-10-02, worker t_fe23a99e)** |
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

**Collision BL-01 × BL-02 (2026-10-02) :** les deux cartes tournent en parallèle sur la
même arborescence. Le worker BL-01 (t_a02aea3e) a laissé des modifications NON COMMITÉES
(`src/core/new-game.mjs`, `src/infra/infra.mjs`, `tests/new-game.test.mjs`) dont le plan
de départ (taxiway 400,1050 + terminal 400,900) repose sur la connectivité par proximité
que BL-02 supprime → `tests/new-game.test.mjs` échoue (2/2) sous le correctif BL-02.
BL-01 devra réaligner son `START_LAYOUT` sur la géométrie « touchante » prouvée
(taxiway (550,1050) + terminal (550,900), voir le commentaire du fixture dans
`tests/sim.test.mjs`) et committer son travail. Le commit BL-02 ne touche QUE
`src/pathfinding/path.mjs` + `tests/sim.test.mjs` + `PROGRESS.md`.

## Prochaine tâche bornée

**BL-01** — Nouvelle partie avec aéroport fourni (MVP-1, AC1, AC38, A-2) :
`src/core/new-game.mjs` = 1 piste + terminal 2 portes + taxiway connectés ; fin = 1 vol
complet sans construction préalable + test `node --test`.
