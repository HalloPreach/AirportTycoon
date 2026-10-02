# R15 — échelle de temps & unités lisible — preuve (t_5d77c1d6, commit 90609b1)

## Échelle de temps (décision R15)
- **Unité interne unique = la SECONDE DE JEU.** L'horloge `advanceTime`
  (src/core/game-state.mjs) avance `state.time` en secondes de jeu :
  `played = dt_réelle × facteur_vitesse`. La sim consomme ce temps :
  `OPEX_PER_SEC[type] × dt_de_jeu` par tick (src/economy/economy.mjs:88-97).
- Pas de 2e unité ni conversion flottante : les durées et périodes sont
  dérivées de la même source. `opexPerMin = OPEX_PER_SEC × 60`,
  `opexPerHour = OPEX_PER_SEC × 3600` (src/data/catalog.mjs) — accès
  STRUCTURÉS, sans état parallèle, lisibles par les sondes (qa).

## Unités lisible (chiffres corrigés, plus de commentaires contradictoires)
L'ancien commentaire de OPEX_PER_SEC était faux (ex. « runway 1.2 = 230,4
$/jour » — en réalité 1.2 × 86 400 = 103 680 $/jour ; et « 400/jour ≈ 16,7/h »
incohérent avec les valeurs). Corrigé en valeurs exactes :

| type     | $/s (jeu) | $/min (×60) | $/h (×3600) |
|----------|-----------|-------------|-------------|
| runway   | 1.2       | 72          | 4 320       |
| taxiway  | 0.2       | 12          | 720         |
| terminal | 1.8       | 108         | 6 480       |
| fuel     | 4         | 240         | 14 400      |
| hangar   | 2         | 120         | 7 200       |
| catering | 2.5       | 150         | 9 000       |
| cleaning | 2         | 120         | 7 200       |
| baggage  | 2         | 120         | 7 200       |

Socle aéroport fourni (A-2) = piste + taxiway + terminal = **3.2 $/s** =
**192 $/min** = **11 520 $/h** ≈ 276 k$/jour ≈ **553 k$/48 h** (cohérent avec
la note « ~550 k$/48 h » de src/core/sim-state.mjs).

## Affichage : mêmes chiffres que les règles
- Le panneau d'inspection d'un bâtiment affiche « Exploitation : X $/min ·
  Y $/h » (src/ui/panels.mjs), calculé via `opexPerMin`/`opexPerHour` — la
  MÊME source que les règles (`OPEX_PER_SEC`). Pas de double $ ni de
  re-arrondi indépendant : `money()` (toLocaleString fr-FR) est partagé.
- La sonde `qa/probe-scenario.mjs` lit désormais `opexPerHour` (plus de
  formule en dur `OPEX_PER_SEC × 3600`) : les chiffres de la sonde et ceux de
  l'UI viennent de la même source.

## Validation (critères de fin R15)
1. **Le coût affiché d'un bâtiment par minute = le débit constaté sur 60 s.**
   `tests/r15-units.test.mjs` : sur une piste seule, le débit de
   `tickEconomy(sim, 60)` = 72.00 = `opexPerMin('runway')` ; pour les 8 types,
   `opexPerMin(type) === OPEX_PER_SEC[type] × 60` (le /min affiché est exact).
2. **La pause ne débite rien.** `advanceTime(pause) = 0` → la sim n'avance
   pas → 0 $ débite (test dédié). La porte CDP confirme `pause gèle le temps
   — moved=0`.
3. **x4 accélère temps ET sim de façon cohérente.** `advanceTime(x4, 1s)` = 4
   s de jeu → le débit d'opex est 4× (1 s réelle). La sim consomme le même
   temps de jeu que l'horloge → 4× débit pour 4× temps.
4. **Les chiffres de l'UI utilisent les mêmes données que les règles.** Test
   d'affichage `tests/panels.test.mjs` : le panneau rendu (mock DOM) montre
   « 72 $ /min · 4 320 $ /h » pour la piste = `opexPerMin/Hour('runway')`
   (les accès des règles). La sonde `servicesOpexPerHour` =
   `opexPerHour(type)` (même source).

## Preuve
- **tests/r15-units.test.mjs : 4/4** (accès dérivés, affiché=debit 60 s,
  pause=0, x4=4×).
- **tests/panels.test.mjs (test R15) : 1/1** (le panneau affiche /min·/h =
  les dérivés des règles).
- **Suite complète : 179/179** (baseline 174 + 4 r15-units + 1 panels-R15).
- **PORTE CDP (npm run qa) : 17/17 PASS** (30 frames, temps avance, pause
  gèle, vols complets, passagers, recettes, sauvegarde/rechargement, capture
  evidence/jeu-en-cours.png, aucune exception page). Le rendu réel du panneau
  en navigateur est couvert par la porte (le test Node mock-DOM couvre le
  contrat d'affichage).

## Compatibilité
- OPEX_PER_SEC intact (les valeurs ne changent pas, seules les commentaires
  sont corrigés) → l'équilibrage est conservé (critère A12).
- Les accès `opexPerMin`/`opexPerHour` sont de nouveaux exports (additifs,
  pas de breaking change) ; la sonde et l'UI y passent.
- `evidence/probe-custom-6h` a été régénéré par la sonde (config par défaut
  seed 0, services none) → rétabli au commit parent (le contenu diffère de
  la version commitée seed 42 / services all ; les fichiers n'appartiennent
  PAS à R15, ils sont protégés).

## Limitation
- Pas de HUD global du débit d'exploitation ($/min de la sim entière) —
  l'unité financière est lisible PAR BÂTIMENT (inspection) ; le débit global
  est déjà lisible via le bilan financier (periodStatement « Exploitation »).
  Un bandeau « −X $/min » global serait un ajout cosmétique, pas un
  correctif d'unité : laissé à R16 (périodes financières).
- L'unité est la SECONDE DE JEU (pas l'heure ni la minute) : la conversion
  /min et /h est dérivée (×60, ×3600), jamais stockée — pas d'état parallèle
  à resynchroniser.

## Suite
- R16 (périodes financières + prévision) et R17 (retards/goulots) dépendent
  de R15 (arête exacte) : les unités lisible et les accès `opexPerMin/Hour`
  leur servent de socle.
