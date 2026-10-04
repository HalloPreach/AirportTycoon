# RAPPORT FINAL — Airport Tycoon (version livrée, R43)

Carte : **R43 (t_89f5193b)** — « Livrer une version avec preuves et limites ».
Date : **2026-10-04**. État du jeu validé : commit **`3232311`** (R42, 65 commits au-dessus de `origin/main`, non poussé).
Ce rapport **régénère** le rapport final au commit final. Le rapport précédent
(BL-19, `debee4f`, 2026-10-02) est **archivé daté** :
`archive/rapport-final-BL-19-2026-10-02.md` (non réutilisé tel quel, comme l'exige la carte).

> **Statut de la version : CANDIDATE (candidate), pas « livraison entièrement validée ».**
> Tout le noyau est vert (suite 317/317, QA navigateur, endurance, migrations,
> équilibrage multi-seeds). Une limite essentielle reste ouverte —
> **l'observation d'une 1re session navigateur réelle de 20-30 min traversant les
> 3 paliers** (criterium G7-e) n'est pas close ici : la session navigateur chargée
> observée couvre **20 min de jeu** (R42 CDP, `x4`, 300 s réelles) et les 3 paliers
> sont validés **par le cœur de production** (R38/G6). La version est donc livrée
> comme candidate avec cette limite explicitée — ce que la carte R43 autorise.

---

## 1. Comportement final (ce que le jeu fait, au commit testé)

- **Boucle** : menu → nouvelle partie (seed) → construire (piste/taxiway/terminal/
  services) → offrir/accepter des vols → faire atterrir, amarrer, embarquer,
  décoller → percevoir billets + taxes, payer les coûts → périodes financières.
- **Horloge** : `1 tick = 1 s de jeu` ; vitesse `x1/x2/x4` (touche **F**) multiplie
  le `dt`. La sim avance **au temps de jeu** (pas au temps réel) — `x4` n'est pas une
  sim à `x1`.
- **Progression — 3 paliers (R21, `src/data/tiers.mjs`)** :
  1. **Lancer l'aéroport** — accepter une offre + choisir carburant ou départs secs.
  2. **Résoudre une saturation** — 2e piste (gain mesurable) ou absorber les retards.
  3. **Agrandir pour tenir un engagement** — contrat de croissance (R24) + capacité.
- **Déblocages — CONDITIONS MESURABLES (R23, `src/infra/unlocks.mjs`)** : les
  anciens seuils `100/300 pax` sont **remplacés** par des conditions lues dans l'état
  sim (besoin réel) :
  - `fuel` : une offre de vol en vue **ET** une période close `net ≥ 0`.
  - `cleaning` : usure « sale » d'une porte `≥ 10` (`g.cleaning`).
  - `hangar` : usure mécanique d'une porte `≥ 10` (`g.maintenance`).
  - `baggage` : file check-in `≥ 90` pax **ou** `400` pax transportés.
  - `catering` : `300` pax transportés (volumes).
- **Services à effet (pas de décor)** : carburant (pleins, pas de départ sec),
  nettoyage/hangar (remettent l'usure des portes à zéro → embarquements rapides),
  bagages (`+8 pax/s` au check-in), restauration (satisfaction remonte plus vite).
- **Multi-terminal (G4/R27-R30)** : un **2e terminal** est constructible ; les
  services se **cibler** sur un terminal (`target`, réaffectable) ; les files et
  capacités sont **par terminal** (la condition `baggage` somme les terminaux).
- **Incidents (R32, `src/sim/incidents.mjs`)** : incidents opérationnels limités,
  **persistants** (état `sim.incidents` sérialisé — re-attaché au chargement, R41).
- **Contrats (R24)** : 3 modèles (faible volume / volume régulier / qualité exigeante),
  prime/pénalité réglées **une fois** ; 1er contrat proposé à `≥ 300` pax transportés.
- **Emprunt (R35, `src/economy/economy.mjs`)** : `takeLoan` remonte le solde ; intérêt
  `1 %/s` **capé** (D5) — la dette ne devient jamais une spirale punitive.
- **Améliorations (R31, `src/infra/upgrades.mjs`)** : 3 choix ciblés par terminal
  (terminal/fueling/teams), niveau + coût déjà payé **sérialisés** (jamais re-débités).
- **Unités** : temps = secondes de jeu (`HH:MM:SS`) ; argent = dollars entiers ;
  pax = passagers ; usure = unités de dégradation (seuil 10).

## 2. Migrations (robustesse du chargement, R41)

Le pattern **`ensure*`** (re-attach d'état manquant) couvre les sous-systèmes ajoutés
après la première version : `ensurePassengers`, `ensureUpgrades`, `ensureLoan`,
`ensureIncidents` (R41 corrige le bug où `ensureIncidents` ne **re-attachait pas**
`sim.incidents` → une sauvegarde pré-R32 chargeait « sans crash » mais tournait sur
des locaux jetés, incidents en silence). La **validation de save** (D4) rejette
`sim.incidents` / `sim.passengers` **présents mais illisibles**. Sauvegardes anciennes
tolérées : champ absent → migré au chargement ; champ présent illisible → rejet lisible.
(Preuve : `tests/r41-migrations.test.mjs`, QA `q/r41-migrations.mjs`.)

## 3. Vérifications (toutes au commit `3232311`, 2026-10-04)

| Vérification | Outil | Résultat |
|---|---|---|
| **Suite complète** | `npm run test` | **317/317 pass**, 0 fail |
| **QA navigateur (13 flux)** | `node qa/r40-cdp.mjs` (Edge + CDP, 0 dépendance) | **19/19 pass** (console propre) |
| **Endurance navigateur (session prolongée + incidents + reprise)** | `node qa/r42-cdp.mjs` | **16/16 pass**, 20 échantillons, 20 min de jeu |
| **Endurance Node multi-seeds (3 seeds × 24 h)** | `node qa/r42-node.mjs` | **3/3 pass**, tick `12 ms/h`, heap stable, sauvegardes mid+fin OK, `issues: []` |
| **Équilibrage multi-seeds (matrice R36 + stratégies R37 + 3 défis R38)** | `node qa/g6-integrated.mjs` | **27/27 pass**, rejouabilité **byte-identique** (sha256), 4 critères R37 sur 12 seeds |
| **3 paliers (scénarios R38 rejoués par le cœur de production)** | `evidence/r38-*` | 3 scénarios **byte-identiques** + invariants OK |
| **Reprise & migrations** | R41 + R42-E (save/reload/reprise) + G6 byte-identique | validées |

- **Rapport d'équilibrage multi-seeds** : `evidence/g6-integrated/rapport-g6-integrated.json`
  (matrice `12 seeds × 5 politiques × 2 pas`, déterminisme, tolérance pas `0.4 s`,
  extension `48 h`) — disponible, régénéré au commit testé.
- **Captures** : `evidence/r40-*.png`, `evidence/r42-*.png` (UI réelle).
- **Rapports** : `qa/r40-report.json`, `qa/r42-cdp-report.json`, `qa/r42-node-report.json`,
  `evidence/g6-integrated/rapport-g6-integrated.json`.

## 4. Défauts restants (listés honnêtement)

- **Session navigateur réelle 20-30 min traversant les 3 paliers** (criterium G7-e) :
  **non close ici**. Session chargée observée = 20 min de jeu (R42 CDP) ; les 3 paliers
  validés par le cœur de production (R38/G6). **À clore (ou accepter) à G7.**
- **Graphique** : sprites vectoriels simples (silhouettes + rectangles) — à remplacer
  par de vrais assets sans toucher la sim.
- **Équilibrage** : chiffres des `UNLOCK_RULES` / `UPGRADES` / paliers sont des **cibles**
  (R37), pas des exigences — le rééquilibrage fin reste possible sans casser la sim.
- **Multi-terminal** : le **2e terminal** est constructible et fonctionnel (files/capacités
  par terminal), mais le chemin « aéroport multi-terminal complet » (plusieurs terminaux
  en opération simultanée) n'est pas l'objectif validé de cette version — le cas « 1
  terminal » reste la référence d'équilibrage (ponytail : seuil check-in `120` = 1
  terminal ; un 2e terminal ajusterait `checkinCap(sim)`).
- **Incidents / contrats / emprunt** : bornés et lisibles, mais leur **profondeur
  stratégique** (variété, effets croisés) est volontairement limitée (R32 « limités »,
  D5 « capé ») — extension possible sans refonte.

## 5. Fichiers du commit final (livrables R43)

- **Sources** : `src/**` (inchangé par R43 — R43 est la carte de livraison).
- **Tests** : `tests/**` (317), dont `tests/r41-migrations.test.mjs`.
- **Scénarios & équilibrage** : `qa/g6-integrated.mjs`, `qa/r40-cdp.mjs`,
  `qa/r42-cdp.mjs`, `qa/r42-node.mjs`, `src/scenarios.mjs`.
- **Rapports** : `qa/*-report.json`, `evidence/g6-integrated/`, `evidence/r40-*`,
  `evidence/r42-*`, `evidence/r38-*`.
- **Documentation** : `README.md`, `docs/gameplay.md` (met à jour règles/contrôles/
  unités/limites), `RAPPORT_FINAL.md` (ce fichier, régénéré), `archive/rapport-final-
  BL-19-2026-10-02.md` (archivé daté).
- **Note de version** : `docs/VERSION_NOTE_R43.md`.
- **Tableau `/kanban`** : mis à jour (R43 → done) + export de suivi.

---
*Ce rapport est la source de la livraison R43. Tout chiffre non réexécuté au commit
`3232311` est signalé comme « non vérifié » — jamais « PASS ».*
