# Validation G0-G7 — Rapport final (carte t_67d0ef24)

Date : 2026-10-02. Commit testé : `e3dc3fc` (HEAD, 15 commits au-dessus de `origin/main`).
Mise à jour t_8d22ad76 (root, 2026-10-02) : statut live 13 done (G0, R01-R09, R11, R12,
R13 `115eb69`) / R10 running (run 278) / R12b ready / R14 + G2-G7 todo.
Mise à jour t_6929c5cf (G1, 2026-10-02) : **G1 VALIDÉ** sur `2369c67` (suite 174/174,
partie intégrée `qa/g1-integrated.mjs` 15/15, porte CDP mvp-gate 18/18) ; la vague J2
(R15-R20) est libérée, G2 (t_93b886f9) attend R15-R20.
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
| G1 | Fiabilité (J1) | **VALIDÉ** | `2369c67` : 12 prérequis R03-R14 clos avec preuve (suite 174/174) + partie intégrée `qa/g1-integrated.mjs` 15/15 + porte CDP 18/18 (§ G1) |
| G2 | Compréhension (J2) | **VALIDÉ** | `63f11d1` : R15-R20 clos avec preuve + 1er cycle navigateur CDP `qa/g2-j2.mjs` 19/19, comparaison chiffrée (§ G2) |
| G3 | Progression (J3) | **BLOQUÉ** | cascade : R21-R26 en todo (amont J1+J2 non validés) |
| G4 | Exploitation (J4) | **BLOQUÉ** | cascade : R27-R31 en todo (amont J3 non validé) |
| G5 | Risque (J5) | **BLOQUÉ** | cascade : R32-R35 en todo (amont J4 non validé) |
| G6 | Équilibrage (J6) | **BLOQUÉ** | cascade : R36-R38 en todo (amont J5 non validé) |
| G7 | Livraison (J7) | **BLOQUÉ** | cascade : R39-R43 en todo (amont J6 non validé) |

Règle appliquée partout (spec des G) : on n'examine pas le nombre de cartes clôturées,
mais les preuves des cartes + le scénario intégré du jalon. Sur prérequis non satisfait :
le G reste ouvert, jamais `done` — d'où le statut BLOQUÉ (justifié) et non VALIDÉ pour
G1-G7. Aucune carte G n'est passée en `done` sans prérequis.

État Kanban vérifié (live, à la coupure) : 12 done (R01-R12, G0), R10 running, R13 ready,
R14 + le reste todo. Mise à jour t_8d22ad76 (live, `qa/_root-check.mjs`) : **13 done**
(R01-R09, R11, R12, R13, G0), R10 running (run 278, heartbeat ~1 min), R12b ready
(re-baseline fixtures probe), R14 + G1-G7 todo. Le board reflète l'état réel ; les statuts
n'ont pas été modifiés (tous cohérents, 52 cartes / 190 arêtes intra-famille / acyclique
/ 0 orphelin), la justification des blocages est portée ici + en commentaire sur G1
(comment_ids 163/164).

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

## G1 — Fiabilité (J1) : VALIDÉ sur `2369c67` (t_6929c5cf)

Critère (a) : « chaque R03-R14 fermée avec preuve test/sim ». Les 12 prérequis sont
tous livrés et leur preuve est dans la suite (relancée aujourd'hui, **174/174 PASS**) :

| R | Preuve (tests) |
|---|----------------|
| R03 chemins après rebuild | `tests/invariants.test.mjs` (A7/A8 + 4 scénarios R03) |
| R04 réservation explicite | `tests/invariants.test.mjs` (3 tests R04 : annulation bornée, porte libérée, piste fermée) |
| R05 critères piste/port | `tests/r05-runway.test.mjs` (7 tests, centralisation `infra.mjs`) |
| R06 auto-accept unifiée | `tests/new-game.test.mjs` + `tests/planning-panel.test.mjs` (7 tests R06) |
| R07 inspection vivante | `tests/panels.test.mjs` (2 tests R07 : le panneau suit l'objet suivi, pick invalidé) |
| R08 lances en panne | `tests/r08-lances.test.mjs` (acquisition/libération centralisée `acquireLance/releaseLance`) |
| R09 PRNG | rejeux seeds 42/99 divergents (`evidence/r09-seed-42/99/`) + test dans la suite |
| R10 rejets lisibles | `tests/r10-save-validation.test.mjs` (version stricte, ids doublés, type inconnu, réservations des deux côtés, chemin, files) |
| R11 coûts obligatoires | test « débit même en déficit, achat facultatif seul refusé » (scénario R11 de la suite) |
| R12 réconciliation | `tests/r12-reconciliation.test.mjs` (EV-9 : `money = START + rec − dep − debt`) |
| R13 déploiement/plafond | `tests/r13-deployment.test.mjs` (5 tests : 4/4→4, 2→2, 0→0, expiration 10 min) |
| R14 erreurs/volume | `tests/r14-history.test.mjs` (journal borné 500, tick injectable) |

Critère (b) : « le scénario intégré du jalon est exercé au niveau sim, non seulement
les tests unitaires » — **`qa/g1-integrated.mjs`** (harnais unique, cœur de production
`tick.mjs` + PRNG semé, zéro fixture) relancé aujourd'hui sur `2369c67` : **15/15**
(`evidence/g1-integrated/rapport-g1-integrated.json`) :

- sans crash : 172 800 ticks (48 h, seed 42, dt 1 s) avec invariants par tick
  (money/pax/positions finies, phases connues) — aucun échec ;
- construction de la 2e piste (chargée en invest), démolition d'un service (refund
  lisible), panne carburant forcée (événement `fuel-out`), indemnité R11 débitée en
  déficit (`-1000 → -1500`, comp 500), journal R14 borné (max=500) ;
- save → load → reprise : état restauré (argent/horloge/avions), préférence R06
  restaurée, **PRNG restauré** (seed 42, counter 9259 → reproductible), graphe dérivé
  reconstruit (`_graph=null + dirty`), 2e tick post-load sans plantage, **zéro
  réservation fantôme des deux côtés**, aucune lance occupée après panne ;
- issue saine : money 12 000 → 3 124 942.66 $ (dette 0), net 3 112 942.66,
  pax 240 707, faillite non ;
- état exporté (`state-g1-integrated.json`) ; rapport `rapport-g1-integrated.json`.

Limite UI du jalon (consignée, spec G1) : la partie intégrée exerce le CŒUR au niveau
sim. La preuve navigateur de la PORTE (nouvelle partie, construction, vols, démolition,
sauvegarde + RELOAD + reprise) est le CDP **mvp-gate relancé aujourd'hui : 18/18**
(`evidence/mvp-gate/` : `rapport.txt`/`rapport.json` + 6 captures), zéro exception page,
toutes requêtes locales. Les goulots UI de J2+ (unités lisibles, overlay réseau,
planning décisionnel) sont hors périmètre G1 et attendus par R15-R20 → G2.

Statut final : **G1 VALIDÉ** sur `2369c67` — les 12 prérequis R03-R14 sont clos avec
preuve, la partie intégrée est saine (critère a+b), la limite UI est consignée ci-dessus.
La vague J2 (R15-R20) est libérée ; G2 (t_93b886f9) reste en todo tant que R15-R20 ne
sont pas livrées (règle : un G ne se valide pas sur le seul nombre de cartes).

## G2 — Compréhension (J2) : VALIDÉ sur `63f11d1` (t_93b886f9)

Critères de la carte : (a) commandes accessibles sans README ni touches mystiques ;
(b) unités correctes (coût affiché/min = débit constaté, pause ne débite rien, x4
cohérent) ; (c) inspection vivante (phase change sans reselection, objet disparu ≠ actif) ;
(d) goulot lisible par cause (piste/porte/carburant/passagers, pas de double comptage) ;
(e) planning utilisable (offre impossible → obstacle expliqué, décision non doublée).
Preuves attendues : observation navigateur (CDP/Edge) du 1er cycle avec captures ;
valeurs affichées = valeurs sim exportées (comparaison chiffrée).

Prérequis : les 6 cartes R15-R20 sont closes avec preuve (R15 `90609b1`+`7cfa98c`,
R16 `47da950`+`b885d3c`, R17 `7faa963`, R18 `5f675ec`, R19 `5b431da`, R20 `fb13efd`) —
relu via les handoffs de tâches parents, pas par le seul nombre de cartes.

**1er cycle navigateur** — `qa/g2-j2.mjs` (scénario CDP Edge headless, re-exécuté
aujourd'hui sur `63f11d1`) : **19/19 PASS, 0 FAIL**, zéro exception page
(`evidence/g2-j2/` : `rapport.json`/`rapport.txt` + 5 captures). Réception →
construction → offres → décision → inspection :

- **(a)** commandes à la souris : nouvelle partie (menu), Passer (intro), Pause (P),
  Vitesse (F), Sauvegarder (S), Charger (L), Piste/Terminal/Démolir (toolbar) —
  toutes présentes et fonctionnelles sans clavier ; pause active (état figé) ;
- **(b)** pause : money/time inchangés entre deux lectures (11999.36 / 0.2 avant
  et après) ; cadence : x4 = 4 s simulées / 12.8 $ pour x1 = 1 s / 3.2 $
  (4× exact, copies de simulation) ; coût piste affiché **72 $/min = 72 $ observés
  sur 60 s de tick** (comparaison chiffrée affiché=sim, 4 320 $/h) ;
- **(c)** inspection vivante : la phase change d'« attente » à « atterrissage »
  **sans reselection** ; objet supprimé de `sim.aircraft` → le panneau affiche
  « parti — plus en simulation » sans reselection ;
- **(d)** 5 causes de goulot (piste/porte/segment/carburant/passagers) : la cause
  affichée dans l'inspection = `causeAt` (modèle) dans chaque état ; retard compté
  **une seule fois par seconde** (60→61 sur tick de 1 s, pas de double comptage) ;
- **(e)** planning : offre large (301 pax, ⛔ pas de porte de taille L) → obstacle
  explicite affiché ; offre medium (73 pax) acceptée par clic → statut `accepted`
  une fois ; `decideFlight` répété sur le même vol = `false` (décision non doublée).

Suite Node relancée sur `63f11d1` : **210/210 PASS** (dont 7 R16, 4 R15, 7 R17,
3 R18, 5 R19, 8 R20).

Limites consignées (honnêtes) : le scénario CDP utilise des fixtures explicites pour
les états d'avion/congestion difficiles à attendre — la QA cible les 5 critères, elle
n'est pas une preuve d'un cycle de vol complet de bout en bout ; le jugement global de
« compréhension joueur » reste subjectif. Invariants respectés : état métier JSON-sérialisable intact, sim sans DOM/timers, pas de nouvelle dépendance, assertions
intactes (aucune retirée).

## G3-G7 — BLOQUÉS en cascade

Les cartes R15-R43 : R15-R20 done (vague J2, G2 validé ci-dessus), R21-R43 en todo
sans run. Chaque jalon exige l'amont validé (règle des G : « amont non validé » = statut
À FAIRE/BLOQUÉ, pas VALIDÉ) :

- **G3** ← R21-R26 (todo, gated J1+J2 — J1 validé `2369c67`, J2 validé `63f11d1` →
  PRÊTES à exécuter) — progression/contrats : non exécutable tant que R21-R26 sont todo.
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

1. G1 VALIDÉ (`2369c67`) : la vague J2 est libérée — dispatcher relâche R15-R20
   (parents = G1 + les R de J1) puis G2 (t_93b886f9) dès R15-R20 done.
2. G2 exercera le 1er cycle navigateur (unités R15, finances périodiques R16, goulots
   R17, overlay réseau R18, planning décisionnel R19, intro R20) ; G3-G7 en cascade.
3. G7 produira le rapport de livraison régénéré au commit final (pas de réutilisation de BL-19).
