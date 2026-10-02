# R17 — Preuve : retards & goulots par cause, ponctualité à dénominateur clair

Tâche : t_fc0d1920 (R17). Prerequis : G1, R04, R05, R13, R15 (tous clos,
G1 validé sur 2369c67). Décision D7 tranchée : **module unique de vérité des
retards = `ac.delayed` (aircraft.mjs)** ; R17 n'ajoute que les CAUSES par
goulot + une fenêtre bornée, sans dupliquer le compteur.

## Résultat

1. **Causes par goulot (lecture dérivée, pas de compteur parallèle).**
   `causeAt(sim, ac)` (aircraft.mjs, exporté) LIT l'état : quelle ressource
   retient l'avion (piste / porte / segment / carburant / passagers /
   annulé) et renvoie la cause lisible. Le retard reste `ac.delayed`
   (source unique) ; la cause est `ac._delayCause`, posée PAR le module qui
   retarde (doHolding/doTaxi/doBlocked/doRefuel), relue au tick. Le
   panneau d'inspection affiche le GOUTOU (causeAt), pas la phase.
   - piste : attente d'atterrissage (piste fermée OU occupée) — `doHolding`.
   - porte : `doBlocked` (heading='gate') — porte/segment d'arrivée indisponible.
   - segment : conflit taxiway (segment d'arrivée pris).
   - carburant : `doRefuel` — lance(s) saturée(s) (attente).
   - passagers : files d'embarquement (board).
   - annulé : blocage persistant > borne (A-5) ou attente d'atterrissage
     bornée (A-4) — l'annulation EST le retard extrême.

2. **Aucun double cumul (D7).** Le planificateur (flights.mjs) ne cumulait
   PAS `ac.delayed` pour les avions en approche/holding — `doHolding`
   (aircraft.mjs) est le SEUL compteur du retard d'atterrissage. Le
   planificateur note la cause (markPlannedDelayed) et la purge, sans
   toucher au compteur. Un avion arrêté ne cumule pas deux fois le même
   retard dans plusieurs modules. (Test r17 #1 : 1 tick → +1 s, pas +2.)

3. **Fenêtre bornée + dénominateur clair.**
   - `sim.punctuality` = objet plat sérialisable `{onTime,total,causes,
     cancels,entries[]}` borné à `PUNCTUALITY_MAX=50` (fenêtre glissante,
     pas de croissance sans fin — critère « statistiques sur une fenêtre
     bornée »). `ensurePunctuality` (idempotent) initialise, `logFlightEnd`
     enregistre chaque FIN DE VOL (départ OU annulation).
   - `punctualityStats` : `rate = onTime/total` où **total = toutes les fins
     (départs + annulations)** — le dénominateur inclut la politique des
     annulations (un vol annulé = NON ponctuel, cause comptée). `null` si
     aucun vol terminé dans la fenêtre (pas de faux chiffre).
   - **Ponctualité par rapport à un horaire de départ prévu + durée de
     rotation nominale EXPLICITE** : `NOMINAL_TURNOVER_S = 240 s` (catalog)
     + avitaillement `AIRCRAFT[acType].refuel × REFUEL_TIME_S` (lié à la
     taille : un gros plein (747) prend plus qu'un petit (Cessna)) =
     `nominalRotation(acType)`. Un vol est « à l'heure » si
     `ac.delayed ≤ nominalRotation(acType)`. (Critère « durée de rotation
     nominale explicite ».)

4. **UI (panels.mjs, zéro DOM en sim).** Le panneau d'inspection affiche
   le GOUTOU (causeAt) quand l'avion est en retard ; le panneau
   statistiques affiche la ponctualité `onTime/total` (dénominateur clair,
   annulations comptées) + « pas encore » si aucun vol terminé. Les
   chiffres de l'UI = mêmes données que les règles (pas d'état parallèle).

## Fichiers

- `src/data/catalog.mjs` — `NOMINAL_TURNOVER_S = 240` (rotation nominale
  explicite : ops au sol + avitaillement).
- `src/sim/aircraft.mjs` — `causeAt`/`noteCause`/`DELAY_CAUSE_FR` (causes
  par goulot, lecture dérivée), `ensurePunctuality`/`logFlightEnd`/
  `punctualityStats`/`nominalRotation`/`DELAY_WINDOW_S` (fenêtre bornée +
  dénominateur clair), `PUNCTUALITY_MAX=50`, `HOLDING_CANCEL_S=600`
  (annulation bornée, cause lisible).
- `src/flights/flights.mjs` — le planificateur ne cumule PLUS `ac.delayed`
  (D7) ; `markPlannedDelayed(entry, why)` note la cause sans dupliquer le
  compteur ; `purge` retire l'entrée en retard.
- `src/ui/panels.mjs` — inspection affiche le GOUTOU ; stats affiche la
  ponctualité à dénominateur clair.
- `tests/r17-punctuality.test.mjs` — 7 tests (preuve ci-dessous).

## Preuve (tests, zéro DOM, déterministe)

`tests/r17-punctuality.test.mjs` — 7/7 :
1. **D7 / aucun double cumul** : un avion en attente (holding) cumule le
   retard UNE fois — 1 tick → `ac.delayed` +1 s (pas +2), la cause est
   notée (piste), le planificateur ne le duplique pas.
2. **Cause = le GOUTOU** : `causeAt` renvoie la bonne cause par goulot
   (scénarios isolant chaque ressource) — piste/porte/segment/carburant/
   passagers/annulé.
3. **Fenêtre bornée** : 200 fins de vol → la fenêtre reste à 50 entrées
   (pas de croissance sans fin), le taux est sur les 50 dernières.
4. **Dénominateur clair (annulations comptées)** : 10 départs à l'heure +
   2 annulations → `total=12`, `cancels=2`, `onTime=10`, `rate=10/12` ; la
   cause des annulations est comptée (`causes.piste=2`).
5. **Aucun vol terminé → null** : début de partie → `rate=null` (l'UI dit
   « pas encore »), pas de faux chiffre.
6. **Rotation nominale explicite** : `nominalRotation('medium') =
   NOMINAL_TURNOVER_S + refuel×REFUEL_TIME_S` ; la rotation d'un avion plus
   gros (large) ≥ medium (plus d'avitaillement).
7. **Sauvegarde/restauration** : la fenêtre `sim.punctuality` (objet plat)
   survit à serialize→deserialize ; le `_delayCause` (dérivé, volatil) est
   relus au tick.

## Compatibilité

- Invariants durs respectés : état métier sérialisable (`punctuality` objet
  plat), caches dérivés reconstruits, sim sans DOM/timers/réseau, pas de
  nouvelle dépendance (stdlib node:test), START_FUNDS intact, aucune
  assertion retirée.
- `ac.delayed` reste la source unique de vérité (D7) — R17 n'ajoute que
  causes + fenêtre bornée.
- `NOMINAL_TURNOVER_S` = 240 s (R15 : seconde de jeu) ; l'unité interne
  unique reste la seconde de jeu (pas d'état parallèle).
- Les chiffres de l'UI/sonde = mêmes données que les règles.
- Checkout partagé : commit path-limited aux fichiers R17 ; les 65 fichiers
  non suivis protégés (qa/_*, docs/, RECONCILIATION_*.md, evidence/)
  intacts ; aucune publication/push/déploiement.

## Limitation

- Le GOUTOU affiché est celui NOTÉ au dernier retard (`_delayCause`) —
  c'est la cause dominante, pas un historique par ressource (le
  décomparatif « par goulot » reste dans la fenêtre bornée + les stats).
- L'attente d'embarquement (files passagers) compte dans `ac.delayed` mais
  la cause « passagers » est notée quand le timer négatif s'écoule ;
  l'avitaillement (doRefuel) attend sans cumuler `ac.delayed` (phase
  temporisée), sa cause « carburant » est notée si un retard s'y superpose.
- Vérifié au niveau sim + tests (193/193) ET navigateur : PORTE CDP
  `node qa/mvp-gate.mjs` **18/18 PASS** (EV-3.1–3.9 + R3/A6a/A7 + EV-5/EV-6,
  zéro exception page / console, réseau 100 % local) — les phases
  blocked/holding/delayed (mes changements de boucle) sont exécutées sans
  plantage sur la page réelle. (Le 1er run a planté sur une lecture
  `__game.state.camera.x` en teardown — flake de timing de démontage,
  non reproductible au re-run ; la porte passe 18/18.)

## Suite

- G2 (t_93b886f9) : overlay réseau + planning décisionnel consommeront
  `causeAt`/`punctualityStats` (goulots UI de J2+).
- PORTE CDP à relancer (affichage du GOUTOU + ponctualité en UI réelle).
