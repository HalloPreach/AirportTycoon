# Validation G0-G7 — Rapport final (carte t_67d0ef24)

Date : 2026-10-02. Commit testé : `e3dc3fc` (HEAD, 15 commits au-dessus de `origin/main`).
Cartes du jalon : 51 (43 R + 8 G), graphe 186 arêtes, acyclique, 0 doublon
(`qa/_final-check.cjs` : 186/186 présentes, 0 manquantes, acyclique OUI, doublons aucun).
Suite complète : `npm test` = **147/147 PASS, 0 fail** (relancé aujourd'hui sur `e3dc3fc`).

Méthode : chaque critère est vérifié par relance sur le commit testé (pas par copie des
résumés de cartes) : probes rejouées, exports JSON comparés, tests relancés, Kanban live
lu en lecture seule (`qa/_g-status.cjs`, `qa/_r08-lock.cjs`).

## Synthèse

| Gate | Jalon | Statut | Justification |
|------|-------|--------|---------------|
| G0 | Référence (J0) | **VALIDÉ** | 4 critères (a)-(d) relancés et passés sur `e3dc3fc` (§ G0) |
| G1 | Fiabilité (J1) | **BLOQUÉ** | R10, R13, R14 non livrées (R08 livrée après coupure ; critère a non satisfait) (§ G1) |
| G2 | Compréhension (J2) | **BLOQUÉ** | cascade : R15-R20 en todo (amont J1 non validé) (§ G2-G7) |
| G3 | Progression (J3) | **BLOQUÉ** | cascade : R21-R26 en todo (amont J1+J2 non validés) |
| G4 | Exploitation (J4) | **BLOQUÉ** | cascade : R27-R31 en todo (amont J3 non validé) |
| G5 | Risque (J5) | **BLOQUÉ** | cascade : R32-R35 en todo (amont J4 non validé) |
| G6 | Équilibrage (J6) | **BLOQUÉ** | cascade : R36-R38 en todo (amont J5 non validé) |
| G7 | Livraison (J7) | **BLOQUÉ** | cascade : R39-R43 en todo (amont J6 non validé) |

Règle appliquée partout (spec des G) : on n'examine pas le nombre de cartes clôturées,
mais les preuves des cartes + le scénario intégré du jalon. Sur prérequis non satisfait :
le G reste ouvert, jamais `done` — d'où le statut BLOQUÉ (justifié) et non VALIDÉ pour
G1-G7. Aucune carte G n'est passée en `done` sans prérequis.

État Kanban vérifié (live, `qa/_g-status.cjs`, à la coupure) : 12 done (R01-R12, G0),
R10 running, R13 ready, R14 + le reste todo. Le board reflète l'état réel ; les statuts
n'ont pas été modifiés (tous cohérents), la justification des blocages est portée ici +
en commentaire sur G1 (comment_ids 163/164).

## G0 — Référence (J0) : VALIDÉ sur `e3dc3fc`

Critères de la carte (t_1263a756) : (a) référence au commit réellement examiné ;
(b) rejeu exact d'une configuration = résultat identique ; (c) ≥4 politiques comparées ;
(d) seeds signalées inefficaces tant que R09 n'est pas faite.

- **(a) Référence au commit** : les 11 cartes done sont rattachées à leurs commits
  (R09=`356e15b`, R12=`92ef251`, R04=`843dd65`, R11=`bc94978`, R05=`e3dc3fc`, …) ;
  la note de référence = `SYNTHESISE_EXIGENCES_HERMES.md` (rôle R01, confirmé par la
  carte G0 elle-même). Preuves = exports JSON sous `evidence/` (dossier par run + commit
  dans le rapport via `GIT_COMMIT`).
- **(b) Rejeu exact = résultat identique** : deux rejeux de la config
  `seed 42 / 6 h / dt 1 s / policy accept / services all` relancés aujourd'hui sur
  `e3dc3fc` (`evidence/g0-recheck-a/`, `evidence/g0-recheck-b/`) : les états diffèrent
  **uniquement par `runId`**, rapports identiques hors `runId`/`commit`
  (`qa/_g0-recheck.cjs` : « state differents QUE par runId ? true », « rapports
  identiques (sans runId/commit) ? true »). Fin : money 659467.26, pax 30467, dette 0.
- **(c) ≥4 politiques comparées** (relancé aujourd'hui, `evidence/g0-4p-*/`, seed 42 /
  6 h / dt 1 s) — les décisions produisent des issues réellement différentes :

  | Politique | money fin | pax | Issue |
  |---|---|---|---|
  | aucune décision | **-10091.12** | 0 | **faillite** (arrêt prématuré t=68 min) |
  | acceptation générale | 588629.17 | 43049 | OK (409 in / 407 out, 0 annulé) |
  | carburant seul | 659467.26 | 30467 | OK (299 in / 293 out, 1 annulé) |
  | tous services | 567705.73 | 34915 | OK (341 in / 336 out, 0 annulé, sat 99.5 %) |

- **(d) Seeds** : AVANT R09, seeds 42/99 produisaient la même partie (seul `rngSeed`
  différait — `evidence/r09-seed-42/`, `evidence/r09-seed-99/` + `qa/_seed-diversity-check.cjs`).
  APRÈS R09 (`356e15b`), les seeds 42/99 DIVERSIFIENT : money fin 103272.80 vs 100240.16,
  pax 6900 vs 6697 → critère (d) clos, seeds désormais efficaces.
- **PORTE bl17 (scénario 48 h)** relancée sur `e3dc3fc` : money 12000 → 3255497.89 $,
  254846 pax, 2449 in / 2445 out / **0 annulé, 0 indemnité**, incidents absorbés
  (runway 84 / fuel 119 / surge 306), faillite non → **PASS** (`evidence/g0-bl17-recheck/`).
- **G0 = done** sur le Kanban (t_1263a756), cohérent avec le présent résultat.

## G1 — Fiabilité (J1) : BLOQUÉ (t_6929c5cf)

Critère (a) : « chaque R03-R14 fermée avec preuve test/sim ». État des 12 prérequis :

| R | Statut | Note |
|---|--------|------|
| R03 chemins après rebuild | done `843dd65` ✓ | inval+recalcul depuis position actuelle |
| R04 réservation explicite | done t_3de644b3 ✓ | piste/segment/porte explicites |
| R05 critères piste/port | done `e3dc3fc` ✓ | centralisés, sondage gain 2e piste |
| R06 auto-accept unifiée | done t_c932707c ✓ | `state.planningAuto` source unique |
| R07 inspection vivante | done t_232419f6 ✓ | signature état objet suivi |
| **R08 lances en panne** | done ✓ (après coupure) | livrée `21b7ad7` : acquisition/libération lance CENTRALISÉE (acquireLance/releaseLance), test `tests/r08-lances.test.mjs` (suite 147→**153/153**) ; au moment de la coupe R08 était running, R10 a repris la file |
| R09 PRNG | done `356e15b` ✓ | seed mélangé dans mulberry32, 2 seeds → 2 suites |
| **R10 rejets lisibles + migration** | **running** ✗ | run en cours (pris dans la file après R08) ; prérequis R03-R09 tous done |
| R11 coûts obligatoires | done t_eef3e9c8 ✓ | débit même en déficit, achat facultatif seul refusé |
| R12 réconciliation | done `92ef251` ✓ | dette 1×, EV-9 tient, dette en ligne du bilan |
| **R13** | **ready** ✗ | en file, non exécutée |
| **R14** | **todo** ✗ | verrouillée derrière R10/R13 (prérequis R03-R13) |

Justification du BLOQUÉ : 3/12 prérequis non livrés (R10 running, R13 ready, R14 todo)
R14 todo) → critères (a) et (b) (partie intégrée) inaccessibles. Les preuves partielles
déjà présentes sont notées pour accélérer la validation : R09 (2 seeds → 2 suites ✓),
R11/R12 (déficit réel + identité trésorerie, tests R12 dans la suite 147/147 ✓),
R05 (test piste occupée ✓), avant/après D1/D2 (commits `7c84ff4`, `48abf79`).
À relancer : G1 dès que R08 + R10 + R13 + R14 sont done (le worker R08 est actif —
non perturbé, protocole checkout partagé).

## G2-G7 — BLOQUÉS en cascade

Aucune carte R15-R43 n'est exécutée (toutes `todo`, aucun run) et chaque jalon exige
l'amont validé (règle des G : « amont non validé » = statut À FAIRE/BLOQUÉ, pas VALIDÉ) :

- **G2** ← R15-R20 (todo, gated J1) — 1er cycle navigateur : non exécutable, amont J1 bloqué.
- **G3** ← R21-R26 (todo, gated J1+J2) — progression/contrats : non exécutable.
- **G4** ← R27-R31 (todo, gated J3) — 2 terminaux/exploitation : non exécutable.
- **G5** ← R32-R35 (todo, gated J4 ; note fixtures D5) — risque/déficit : non exécutable.
- **G6** ← R36-R38 (todo, gated J5) — matrice ≥10 seeds effectives (R09 pré-req ✓ déjà) :
  non exécutable.
- **G7** ← R39-R43 (todo, gated J6) — livraison : non exécutable. Note spec : G7 exige un
  rapport de livraison NOUVEAU au commit final (le `RAPPORT_FINAL.md` BL-19 est archivé,
  à régénérer) — ce présent rapport ne le remplace pas, il documente l'état de validation.

## Blocages, preuves et décisions

- **R08 en cours** : worker actif (run démarré 1790953446, lock live `DESKTOP-CAIE63R:22820`,
  expiration 1790954409). Décision : ne pas intervenir, ne pas commiter par-dessus (protocole
  arbitrage du checkout partagé ; git tracked clean vérifié avant ce rapport).
- **Statuts Kanban** : laissés tels quels — déjà cohérents avec l'état réel (vérifié live).
  Justifications de blocage : ce rapport + commentaire durable sur la carte G1.
- **Graph** : 186/186 arêtes du spec présentes, 0 manquantes, graphe acyclique, 0 doublon.
  288 arêtes supplémentaires existent hors du périmètre des 51 cartes (autres familles de
  cartes + arêtes de contention ajoutées par les workers, ex. R04→R09, R05→R08) : elles
  n'apportent aucun cycle et ne remettent pas en cause le gating G0 (done) ni le BLOQUÉ G1.
- **Aucun G passé en done sans prérequis** (règle « jamais done sur échec/prérequis non
  satisfait »).
- **Preuves de ce rapport** (à `e3dc3fc`) : `evidence/g0-recheck-a|b/` (déterminisme),
  `evidence/g0-4p-{nodecision,accept,fuel,all}/` (4 politiques), `evidence/g0-bl17-recheck/`
  (PORTE 48 h), `evidence/r09-seed-42|99/` + check (seeds post-R09), script de vérification
  `qa/_g0-recheck.cjs`, exports d'état `qa/_g-status.cjs` / `qa/_r08-lock.cjs` /
  `qa/_g1-prereqs.cjs` / `qa/_g-bodies.cjs`.

## Suites

1. Laisser R08 terminer (worker actif) ; dispatcher relâche R13 (ready), puis R10, puis R14.
2. Dès R08+R10+R13+R14 done → relancer la validation G1 (partie intégrée + critères a-d) ;
   sur succès G1 → débloquer la vague J2 (R15-R20) puis G2, etc.
3. G7 produira le rapport de livraison régénéré au commit final (pas de réutilisation de BL-19).
