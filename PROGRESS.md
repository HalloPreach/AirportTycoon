# PROGRESS — Airport Tycoon (point de reprise, AC30 / EV-7)

Base : `80a90ab` (80a90abf4d8000650135442018a263035b2cc1b8). Dernière mise à jour : 2026-10-02 (fin BL-20, HEAD `4cc2bbf` — projet clôturé).

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
| BL-12 Services au sol : carburant/maintenance/catering (AC21) | **fait (2026-10-02, worker t_851e0e2d)** |
| BL-15 Économie profonde + déblocages utiles (NONMVP-4, AC6/AC9/AC23/AC26f) | **fait (2026-10-02, worker t_02c8531f, commit à venir)** |
| BL-14 Incidents limités mais réels (NONMVP-3, AC20, A-7) | **fait (2026-10-02, worker t_4ae09699)** — 3 incidents limités (pas une collection de pannes) : fermeture piste (120 s), panne stations carburant (90 s), pic de demande (90 s) — chacun = perturbation → conséquence MESURABLE → récupération. Module `src/sim/incidents.mjs` (état sérialisable `sim.incidents`, rng semé → reproductible), toasts UI, effets cibles dans `aircraft.mjs`/`flights.mjs`. Test `tests/incidents.test.mjs` (3/3) ; validateur `node --test` 95/95. |
| BL-11 Porte MVP (MVP-10, AC27, AC28, EV-3/EV-5/EV-6) | **fait (2026-10-02, worker t_c605589e, run 228, commit b12968d)** — script QA CDP `qa/mvp-gate.mjs` porte le MVP par entrées réelles (clavier/souris CDP + reload, lecture seule de l'état) : construction → vols (auto-accept A) → conflits (réseau coupé) → finances → sauvegarde/reprise (RELOAD + R = LA PORTE) → R3/A7 (démolition taxiway isolé AVANT 1er tick, `sim._graph` null, null-guard d43b290 exercé, 0 exception) → rejeu. Réseau 100 % local, 0 exception/0 console.error. **18/18 PASS, code retour 0.** Fix R3/A7 : tol pan 120→12 px + clic au centre de la vue (le rectangle du taxiway est plus petit que la tol). Valideur `node --test tests/*.test.mjs` = 92/92. Preuves `evidence/mvp-gate/` (6 PNG + rapports + checkpoint + log). |
| BL-18 Équilibrage économie : survie 48 h (parent de BL-17, règle (B)) | **fait (2026-10-02, worker t_d0b5fb63, run 232)** — l'aéroport de départ (A-2) était DÉFICITAIRE par construction : `money = −10 072` dès h=3, état `bankrupt` figé 45 h (le livrable « 48 h de mesures » ne portait que ~3 h). **Fix #1 (cause racine)** `src/economy/economy.mjs` : l'intérêt `Math.abs(money)*0.01*dt` s'appliquait dès `money<0` → boule de neige qui VERROUILLAIT le solde au seuil `BANKRUPT_LIMIT` (−10 000) : au-delà de −10 000, l'intérêt (1 %/s) dépassait n'importe quel flux et la sim gelait (gel `tick.mjs` : `if (sim.economy.bankrupt) return`). **Fix = assiette capée** à `BANKRUPT_LIMIT` (l'intérêt ne court que sur la dette « visible ») : la faillite reste ATTEIGNABLE (la pente opex fait franchir le seuil) mais le solde n'est plus verrouillé. **Levier unique** `src/core/sim-state.mjs` : `START_FUNDS` 12 000 → **345 000** (capital de départ SOLVALE ; OPEX_PER_SEC INTACT — critère A12 « socle coûte même sans vol » préservé, pas de double levier). 345 k$ = minimum mesuré (seed 42) pour que le scénario le plus dur (bl17 : fenêtre de refus 24-36 h + incident forcé) tienne `money > −10 000` en h=48 : passive min +57 809, bl17 min +18 351. **Preuves** : `node qa/bl17-sim48h.mjs` (seed 42) → **7/7 PASS**, 48 h de données NON gelées (money h=48 = +19 642, carried=36 608, 0 accumulation — invariants AC26a), `evidence/bl-17/` actualisée. `node --test tests/*.test.mjs` → **95/95 PASS** (dont les 5 tests BL-15 verts : scénario déficit/rentable + satisfaction + incident + bilan). **FINDING (script QA, non économie)** : le harnais `qa/bl17-sim48h.mjs` portait 3 bugs qui le faisaient échouer indépendamment de l'économie — (1) `autoAccept` restait ON sur toute la partie (la fenêtre « refus de tout » 24-36 h décrite dans le header n'était JAMAIS appliquée) ; (2) l'échantillonnage horaire `t % H` avec `t < DUR_H*H` ne mesurait JAMAIS h=48 → le check « récupération » comparait `0 − carried(44 h)` = négatif systématique ; (3) l'état final comparé pour EV-10 incluait `elapsed` (horloge RÉELLE `Date.now`) → les 2 passes n'étaient JAMAIS byte-identiques. Fixes appliqués au script (politique par fenêtre ON/OFF/ON + boucle `t <= DUR_H*H` + `elapsed` retiré de l'objet comparé, remonté en champ dédié). Le mécanisme d'incident est déjà prouvé par `tests/incidents.test.mjs`. |
| BL-17 Scénario 48 h + stabilité rendu (AC26, AC27, R3) | **fait (2026-10-02, worker t_9268abf4)** — après déblocage par BL-18 (économie solvable), livrable 48 h COMPLET : (1) `node qa/bl17-sim48h.mjs` (seed 42, 172 800 ticks pas 1 s, invariants AC26a par tick) → **8/8 PASS** : vols générés/transportés (carried=36 608), décision JOUEUR mesurable (fenêtre refus 24-36 h : transport 126 vs 24 782), incident forcé (fermeture piste 120 s : conséquence maxHolding=4 + récupération carried 44-48 h=3 486), reproductibilité EV-10 (2 passes état final identique), A-9 horloges distinctes (temps sim 172 801 s ≠ temps réel 178 ms, facteur ≈ 970 792×). (2) **NOUVEAU `qa/bl17-cdp.mjs`** — session 5 MINUTES RÉELLES dans le vrai navigateur (Edge headless + CDP, entrées réelles N/F×2/A, lecture seule) : **10/10 PASS** — FPS médiane **58** img/s sur 300 échantillons/s (min 7, max 65, ≥ 30 exigé), A-9 CDP (temps sim 1 210 s ≠ 302,6 s réel, facteur **4×** = vitesse x4 du jeu), money/carried FINIS + jeu jamais en pause, **7 captures PNG lisibles** (start, 5 min, fin, 33-45 Ko chacune), **0 exception de page, 0 console.error** sur les 5 min. Preuves : `evidence/bl-17/` (rapport.txt + rapport.json actualisés + cdp-5min/ : 7 PNG + rapports ; log `cdp-5min-run.log` non commité, même convention que le log run 228 de BL-11). Valideur `node --test tests/*.test.mjs` = **95/95**. |
| BL-18 Revalidation finale, états réels (AC26c/h, AC27, EV-3) | **fait (2026-10-02, worker t_1a37355b)** — revalidation COMPLÈTE de l'état final post-BL-17/BL-18-économie, 0 échec : (1) `node --test tests/*.test.mjs` = **95/95** (dont AC26c : « plusieurs vols simultanés » = comptage par identifiant distinct, assertion exacte ; AC15 invariants multi-vols = compte par g.acId + totalCarried monotone ; AC26h : pause ne fait pas avancer le temps + vitesses x1/x2/x4). (2) `node qa/bl17-sim48h.mjs` (seed 42) = **8/8 PASS** (48 h non gelées, carried=36 608). (3) **PORTE MVP BL-11 relancée sur l'état final** (`node qa/mvp-gate.mjs`) = **18/18 PASS** : entrées 100 % réelles (clavier/souris CDP + reload, 0 injection `window.__game`), réseau 100 % local, 0 exception / 0 console.error. (4) `node qa/bl17-cdp.mjs` (stabilité 5 min) = **10/10 PASS** : FPS médiane 58 img/s, jeu jamais en pause, 7 captures PNG. Preuves : `evidence/bl-18/` (rapport.txt + test-output.log + 3 logs de relance) + captures actualisées `evidence/mvp-gate/` et `evidence/bl-17/cdp-5min`. |
| BL-19 Rapport final (NONMVP-7, AC31, EV-8) | **fait (2026-10-02, worker t_a9617b5d)** — `RAPPORT_FINAL.md` à la racine : bilan honnête du projet avec chemins des preuves (EV-1..EV-10), 8 risques reproduits+corrigés (AC33), backlog 28 cartes (26/28 terminées, 2 en cours = BL-19 + RV-BL18), commandes de test réexécutées sur `debee4f` (95/95 + 8/8 + 18/18 + 10/10), sauvegarde/reprise (la PORTE), bilan 48 h + 5 min, limites connues documentées (AC24 partiel = panneaux d'inspection/bilan/stats absents ; script `npm test` liste 10/13 fichiers), NONMVP-9 exclu, push manquant. AC37 : exigence incomplète déclarée, pas masquée en « amélioration future ». |
| BL-03..BL-19 | toutes terminées et committées (état kanban : 26/28 ; en cours au moment du rapport : BL-19 + RV-BL18 t_9aa0bdb9) |
| BL-20 Panneaux de gestion : inspection + bilan + stats + alertes + diagnostic réseau (NONMVP-5, AC30) | **fait (2026-10-02, WIP t_640992c6, commit unique par t_64db3d53 — la carte scratch n'ayant PAS livré de commit, la carte de vérification a terminé la livraison sans double-commit)** — les 5 panneaux manquants livrés dans `src/ui/panels.mjs` (UI FINE : on ne lit que l'état + les getters purs EXISTANTS — `economy.periodStatement`, `path.findPath`, `sim.*` ; aucune règle ajoutée, aucune mutation de la sim, le diagnostic réseau ne reconstruit JAMAIS le graphe R3/A7) : (1) **inspection avion + bâtiment** par clic carte (rayon 30 px écran avion, rectangle bâtiment ; rendu live : l'objet peut partir → « parti/démoli »), (2) **bilan financier détaillé** (surfacer `periodStatement` : solde/résultat/recettes/exploitation/carburant/indemnités/investissements/dette/cause du déficit/FAILLITE), (3) **statistiques** (temps, passagers transportés, satisfaction, files check-in/sécurité/embarquement, avions en vol/au sol, vols planifiés), (4) **historique d'alertes** (`sim.alerts`, 50 plus récentes), (5) **diagnostic réseau coupé/saturation** (file d'arrivées X/4 au plafond MAX_PENDING, piste/carburant/pic actifs, graphe lu en SEUL : nœuds + atteignabilité piste→portes par taille via `findPath` — « INACCESSIBLES (réseau coupé) » quand le chemin n'existe plus). Wire : `src/main.mjs` (+10 lignes : import, `makePanels` au boot, `panels.refresh()` sur le bus 'frame' par frame — le DOM est fixe, chaque panneau se reconstruit SEULEMENT si sa signature change, pattern planning-panel) + CSS `.panels/.panel` dans `index.html` (colonne bas-droite, scroll si trop haute). **Tests** `tests/panels.test.mjs` : **10/10** (les 5 panneaux lues existent — temps/passagers/files/avions/planning/bilan/incidents/alertes + forçage d'un incident visible dans l'historique + diagnostic coupé/saturation par `forceIncident`/démolition de test). **QA CDP entrées réelles** `qa/gestion-panel.mjs` (pattern mvp-gate : clavier/souris CDP, lecture seule de l'état, 0 injection `window.__game`) : **15/15 PASS, code retour 0** — 5 panneaux dans le DOM, contenu réel bilan/stats, clic carte réel → inspection remplie (Terminal #3 200×150, pan + clic souris), forçage par le JEU (pas d'injection) : COUPÉ = démolition du taxiway X+clic réel → portes M « INACCESSIBLES (réseau coupé) » + alerte « demolished » dans l'historique ; SATURATION = file 4/4 au plafond (auto-accept A + coupure bloquant les arrivées) ; réseau 100 % local (28 requêtes 127.0.0.1), **0 exception de page, 0 console.error**. Preuves : `evidence/gestion-panel/` (4 PNG + rapport.txt + rapport.json). Valideur `node --test tests/*.test.mjs` = **105/105** (95 baseline + 10 nouveaux). Lève l'AC24 partiel documenté dans RAPPORT_FINAL.md (AC37) : les panneaux d'inspection/bilan/stats sont MAINTENANT livrés. |

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
- **BL-12 (2026-10-02) : services au sol livrés** — 3 services que l'on
  CONSTITUE (chaque coûte OPEX, chacun sert) :
  - **Carburant** : nouvelle phase `refuel` entre `gate` et `disembark`
    (`src/sim/aircraft.mjs`). Une station = UNE lance (`FUEL_LANCES_PER_STATION`
    = 1) ; durée = `spec.refuel * REFUEL_TIME_S` (taille : 40/110/320 s).
    SANS station → **départ SÉC** (non bloquant, expliqué) : événement
    `no-fuel` + billets moitiés (12.5 $/pax vs 25, `onGateDeparted`).
  - **Maintenance** : usure porte `g.cleaning` s'accumule pendant le plein ;
    le `hangar` la REMET à zéro (`cleanGates` câblé dans `tick.mjs`) → une
    porte sale rallonge les opérations au sol (délai ∝ usure). Le hangar
    coûte ET sert (critère « aucun bâtiment coûtant sans servir »).
  - **Catering** : `BUILDINGS.catering` + `UNLOCKS` (seuil 200 pax) +
    `OPEX_PER_SEC` : la branche `comfortCatering` de `tickPassengers` (morte
    tant qu'indisponible) est désormais CONSTRUCTIBLE et active.
  3 tests dans `tests/services.test.mjs` : 2 lances → 2e plein immédiat (≈0 s),
  1 lance → 2e attend le 1er (retard mesurable ≈55 s), 0 station → départ sec
  (événement `no-fuel` + billets moitiés). `node --test tests/*.test.mjs` → 86/86 pass.
- **BL-15 (2026-10-02) : économie profonde livrée** (NONMVP-4, AC6/AC9/AC23)
  — la qualité et les incidents se paient dans la TRÉSORERIE :
  - **Satisfaction = variable économique** (`earn` de `economy.mjs`) : la
    recette est PROPORTIONNELLE à la satisfaction (50 % = moitié des billets)
    — la garde BL-05 (0 % = aucune recette) est conservée, le carburant
    continue d'être payé (dépense). La qualité dégradée se voit dans le solde.
  - **Incident = coût financier** : `onFlightCancelled` (nouvelle) — le vol
    annulé (blocage persistant, A-5) paie une INDEMNITÉ (500 $, compte
    `spent.compensation` — jamais une recette négative, discipline A-6).
  - **Bilan lisible (AC23)** : `periodStatement` expose l'INDEMNITÉ en cause
    du déficit ; les CONSTRUCTIONS passent dans un compte dédié
    (`spent.construction`, `buildBuilding`) — plus de collision du compte
    « fuel » (construction vs carburant) : le bilan se lit.
  - **Scénarios exécutés** (`tests/finance-bl15.test.mjs`, 5 tests) :
    DÉFICITAIRE (sous-équipé + surdimensionné → net négatif, faillite
    atteinte, causes lues) ET RENTABLE (même aéroport + station carburant →
    net positif) — l'A/B de l'amélioration (AC9) est de ~47 600 $ sur l'heure
    simulée ; satisfaction 50 %/0 % (recettes moitiées / bloquées, carburant
    toujours payé) ; indemnité exposée + nommée en cause.
  `node --test tests/*.test.mjs` → 91/91 pass.
- **BL-11 (2026-10-02) : PORTE MVP validée** (MVP-10, AC27, AC28, EV-3/EV-5/EV-6)
  — le script QA CDP `qa/mvp-gate.mjs` porte le MVP par des entrées RÉELLES
  (clavier/souris via `Input.dispatch*` + `Page.reload`, observation en
  LECTURE SEULE de `window.__game.state` — aucune méthode du jeu n'est appelée) :
  construction → vols (auto-accept touche A, BL-16) → conflits (réseau coupé)
  → finances → sauvegarde/reprise (RELOAD + touche R = LA PORTE) → **R3/A7**
  (démolition du taxiway isolé AVANT le 1er tick, `sim._graph` null, null-guard
  `rebuildGraph` d43b290 exercé, 0 exception) → rejeu. Réseau 100 % local
  (EV-5), 0 exception de page + 0 `console.error` sur toute la session (EV-6).
  **18/18 PASS, code retour 0.**
  - **Fix R3/A7 à la racine** : la tolérance de pan de la phase 6 (120 px)
    laissait le point visé jusqu'à 120 px du centre de VUE, donc HORS du
    rectangle du taxiway (40 px de haut) → le clic tombait à côté (`hit`
    undefined, rien ne se démolissait, timeout 10 s). Tol 12 px + clic au
    CENTRE de la vue (le rectangle couvre ±20 px vertical / ±100 px horizontal)
    → le clic est dedans. La ligne A de BL-16 est greffée sur la réécriture
    `key()` de la run 226 (rawKeyDown+keyUp seul, sans keyDown « text » qui
    doublait les keydowns sous Edge headless).
  Validateur `node --test tests/*.test.mjs` → 92/92 pass. Preuves
  `evidence/mvp-gate/` (6 PNG + `rapport.txt`/`rapport.json` + checkpoint + log).
  Commit `b12968d`.
- **BL-14 Incidents (2026-10-02) : 3 incidents limités livrés** (NONMVP-3,
  AC20, A-7) — perturbation → conséquence mesurable → récupération, SANS
  collection de pannes (ordre A-7 : après BL-11/BL-12) :
  - **Fermeture piste (120 s sim)** : `runwayClosed` — aucun atterrissage
    (les avions patientent en holding, leur retard s'accumule et est LISIBLE
    dans le planning via `markPlannedDelayed`) ; la réouverture relance
    l'atterrissage. Le départ continue (la piste ferme les ARRIVÉES).
  - **Panne stations carburant (90 s sim)** : `fuelOut` — les pleins
    deviennent DÉPARTS SECS (billets moitiés, événement `no-fuel`, NON
    bloquant — discipline A-5) ; le service revenu → le plein se fait VRAIMENT
    à nouveau (récupération mesurée).
  - **Pic de demande (90 s sim)** : `isSurge` — le planificateur DOUBLE sa
    cadence (2 vols planifiés par fenêtre au lieu de 1) ; le pic se mesure au
    NOMBRE de vols planifiés (critère NONMVP-3) ; fin du pic → cadence
    normale (1 vol).
  - Module dédié `src/sim/incidents.mjs` : état `sim.incidents` (sérialisable,
    reproductible à la reprise via le rng semé), tirages aléatoires par fenêtre
    + `forceIncident` pour les tests. Intégré dans le tick (`tick.mjs`) et
    câblé en toasts UI (`main.mjs` : `runway-closed`/`fuel-out`/`surge-start`).
  - 3 tests dans `tests/incidents.test.mjs` (piste / carburant / pic) —
    `node --test tests/*.test.mjs` → 95/95 pass (92 hérités + 3 incidents).

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

Aucune — projet clôturé (racine `t_ee6cc437`, 2026-10-02). Backlog complet :
BL-00..BL-20 + revues indépendantes RV-BL03/04/04-2/08/11/18, toutes terminées et
committées (état final `4cc2bbf`). Preuves finales réexécutées sur l'arbre final :
`node --test tests/*.test.mjs` = 105/105, `qa/bl17-sim48h.mjs` = 8/8,
`qa/mvp-gate.mjs` = 18/18, `qa/bl17-cdp.mjs` = 10/10, `qa/gestion-panel.mjs` = 15/15.

**Continuation `t_00a9af40` (post-clôture, 2026-10-02, faite)** : audit
`AUDIT_2026-10-02_POST_CONTINUATION.md` → carte `t_ad9d472b` (D1, faite, `7c84ff4`),
D2 (embarquement avant parcours pax — carte `t_27b92957`, faite, `48abf79`),
services au sol COMPLETS (carte `t_2179387d`, faite : 4e service « nettoyage »
+ service « bagages » opérationnel, DEUX usures de porte distinctes, panneau
planning hors HUD, `tests/services.test.mjs` (a)/(b)/(c) + `tests/sim.test.mjs`
5 seuils, suite **110/110**, 48 h **8/8 PASS** money=19340.61, aucun capital
injecté), commande de tests (carte `t_b320d250` : script `npm test` corrigé → glob
`tests/*.test.mjs`, suite complète 14 fichiers, exit code du runner Node) et
rapports réactualisés (`RAPPORT_FINAL.md`, `VALIDATION_CLOTURE.md` + note du gap
« services au sol » résolu dans l'audit).

Reste hors périmètre (documenté `RAPPORT_FINAL.md` §8, non masqué) :
- **G2 — CORRIGÉ (carte `t_b320d250`)** : le script `npm test` exécutait 10/13
  fichiers → corrigé en glob `tests/*.test.mjs` (14 fichiers post-BL-20,
  exit code propagé, CI-ready).
- **G3** : seuils ponytail assumés (toasts 4/4 s, autosave 120 s, rendu 5 min).
- **G4** : NONMVP-9 (fret/correspondances) optionnel, exclu par le brief.
- **G5** : `main` en avant sur `origin/main` — push à faire par l'utilisateur.
