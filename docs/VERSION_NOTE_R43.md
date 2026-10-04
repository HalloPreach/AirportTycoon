# Note de version — R43 (livraison)

**Version** : commit `3232311` + livrables R43 (2026-10-04) · **Statut : candidate**
(RAPPORT_FINAL.md détaille les preuves ; cette note est le résumé version).

## Comportement final

- Aéroport jouable : construire (8 types, touches 1-8) → offres de vols → atterrissage/
  amarrage/embarquement/décollage → revenus/coûts → périodes financières.
- 3 paliers de progression (R21) : Lancer / Saturation / Agrandir — les déblocages de
  services sont des **conditions mesurables** (R23 : carburant = offre en vue + période
  net ≥ 0 ; nettoyage/hangar = usure porte ≥ 10 ; bagages = file ≥ 90 pax ou 400 pax ;
  restauration = 300 pax). Les seuils pax 100/300 d'avant R23 sont **retirés**.
- Services à effet : carburant (pleins), nettoyage/hangar (usure remise à zéro),
  bagages (+8 pax/s check-in), restauration (satisfaction). Multi-terminal : 2e terminal
  constructible, services ciblés par terminal (R27-R30).
- Incidents limités (R32) **persistants** (R41) ; contrats 3 modèles (R24) ; emprunt à
  intérêt capé (R35) ; améliorations ciblées par terminal (R31).
- Horloge : 1 tick = 1 s de jeu, vitesse x1/x2/x4 (F).

## Migrations (chargement robuste)

- Pattern `ensure*` (re-attach d'état manquant) : passagers, upgrades, emprunt,
  **incidents** (bug R41 corrigé : `ensureIncidents` ne re-attachait pas `sim.incidents`
  → sauvegarde pré-R32 « sans crash » mais incidents en silence).
- Validation de save (D4) : rejette `sim.incidents` / `sim.passengers` présents mais
  illisibles ; champ absent = migré silencieusement. Preuve : `tests/r41-migrations.test.mjs`.

## Vérifications (au commit testé, 2026-10-04)

- Suite complète **317/317**. QA navigateur **19/19** (R40, 13 flux UI réels).
- Endurance navigateur **16/16** (R42 CDP, 20 min de jeu, reprises). Endurance Node
  **3/3 seeds × 24 h** (12 ms/h, heap stable, sauvegardes OK).
- Équilibrage multi-seeds **27/27** (G6 : matrice R36 + critères R37 sur 12 seeds +
  3 scénarios R38 rejouables, byte-identiques).
- Reprise + migrations validées (R41 + R42-E + G6 byte-identique).

## Limites (honnêtes)

- 1re session navigateur **20-30 min traversant les 3 paliers** : non close ici
  (session chargée = 20 min de jeu ; 3 paliers validés par le cœur de prod R38/G6)
  → version **candidate**, à clore à G7.
- Graphique simpliste (sprites vectoriels) ; équilibrage = cibles (R37) ; multi-terminal
  complet (≥2 terminaux opérationnels) non objectif de cette version.
