# Airport Tycoon — Conception, stack & backlog

> Document de conception produit à partir de `PROJECT_BRIEF.md`. Source de vérité
> pour le choix de stack et l'ordre du travail. **Aucun code de jeu n'est implémenté
> ici** — c'est le contrat d'entrée des cartes qui suivent.

## 0. Contraintes (rappel du brief)

- Jeu de gestion d'aéroport 2D, **réellement jouable, local, hors ligne**.
- **Interdit au runtime** : cloud, API IA/LLM, serveur, service externe.
- Modulaire, **sans surarchitecture**, pas de fichier géant ; dépasser le prototype.
- 13 critères de fin obligatoires, validés par exécution réelle + preuves.

## 1. Environnement inspecté

| Outil | Version / état |
|-------|----------------|
| OS | Windows 11 |
| Node.js | v24.15.0 (test runner `node:test` dispo) |
| npm | 12.0.2 |
| Python | 3.11.16 |
| git | 2.54.0 |
| Edge | `/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` (headless CDP OK) |
| Chrome | absent |
| Repo | seul `PROJECT_BRIEF.md`, pas de code, pas de `.git` |

Skill disponible pour la validation UI sans GUI : `headless-cdp-web-qa`
(Edge + Node, WebSocket CDP brut, résultats = classes/rects, pas de screenshot).

## 2. Décision de stack (justifiée)

**Choix : HTML5 Canvas 2D + JavaScript ES modules (vanilla), servi par un mini
serveur statique Node **zéro dépendance** ; tests de logique via `node:test`
(stdlib) et validation UI/intégration via Edge headless CDP.**

Ligne de raisonnement (escalier, on arrête au premier qui tient) :

1. **Besoin** : un jeu 2D local jouable sans réseau au runtime → un web app local
   servie en `file://` ou sur `127.0.0.1` satisfait la contrainte (zéro réseau).
2. **Déjà dans le codebase** : rien (repo vide sauf le brief).
3. **Stdlib** : le navigateur Canvas 2D + les ES modules natifs couvrent le rendu
   et la structure **sans aucune dépendance** → aucun moteur de jeu, aucun bundler,
   aucun framework.
4. **Feature native** : Canvas 2D est natif ; `requestAnimationFrame` fournit la
   boucle ; `localStorage`/`<input type=file>` la persistance.
5. **Déjà installé** : Edge est présent et le skill `headless-cdp-web-qa` permet de
   valider l'UI headless ; `node:test` est stdlib.

Ce qui est écarté et pourquoi :

- **Pygame / Python** : test headless difficile (nécessite un affichage), pas
  d'alignement avec le skill CDP existant.
- **Unity / C# / .NET** : lourd, écosystème, contre « sans surarchitecture ».
- **Moteur web (Phaser, PixiJS, …)** : dépendance superflue — le Canvas 2D natif
  suffit pour de la 2D simple (échelle de l'escalier : déjà installé = le navigateur).

Conséquences :

- **Simulation pure et déterministe** (aucun import DOM/canvas) → exécutable dans
  Node, testable sans GUI. C'est elle qui porte la plupart des 13 critères.
- **UI = couche fine** : lit l'état, envoie des commandes, ne contient pas de règle.
- **Zéro `npm install`** : pas de dépendance de runtime → le build est trivial
  (copie statique) et le jeu démarre sans réseau.

## 3. Architecture (séparation des couches)

Principe directeur : **la simulation est pure, déterministe, sans DOM**. Elle
tourne dans Node (tests) et dans le navigateur (jeu). L'UI ne fait que lire l'état
et émettre des commandes.

Arborescence cible (modulaire, pas de fichier géant) :

```
AirportTycoon/
  PROJECT_BRIEF.md
  DESIGN.md            <- ce document
  index.html
  serve.mjs            # mini serveur statique Node, 0 dépendance
  README.md            # (ajouté au scaffold) comment lancer/jouer/sauvegarder
  src/
    core/              # boucle (rAF), horloge (pause, vitesse x1/x2/x4), état, événements
    sim/               # logique pure : cycle avion, passagers, conflits, incidents
    pathfinding/       # graphe taxiway, A*/Dijkstra, occupation, absence de chemin, rerouting
    economy/           # budget, revenus/dépenses, construction, faillite, progression/déblocages
    flights/           # planning, compagnies, catégories avions + contraintes, compatibilité portes
    infra/             # pistes, taxiways, terminaux, portes, bâtiments/services
    persistence/       # sauvegarde/chargement JSON (localStorage + fichier), version de schéma
    ui/                # canvas (rendu), caméra (pan/zoom), input (sélection/construction), HUD, menus
    data/              # données de contenu : avions, compagnies, coûts, équilibrage
  tests/
    *.test.js          # node:test — règles, conflits, pathfinding, économie, round-trip sauvegarde
  qa/
    cdp-*.mjs          # Edge CDP — intégration UI + preuves des 13 critères
```

Règles de module (garder la simulation testable) :

- `sim/`, `pathfinding/`, `economy/`, `flights/`, `persistence/` **n'importent
  jamais** de DOM, canvas ou API navigateur → exécutables dans Node.
- `ui/` importe l'état de `core/` + les commandes ; **aucune logique de règle**
  (pas de calcul de revenu, pas de décision d'atterrissage).
- `tick(state, dt, events)` est **déterministe** ; le rendu est séparé et idempotent.
- Sauvegarde = sérialisation JSON de `state` + **version de schéma** (gère les
  sauvegardes invalides/incompatibles : rejet lisible + repli sur nouvelle partie).

## 4. Backlog ordonné par dépendances

Le graphe d'exécution (profil `default`, modèle/provider local hérité) :

```
t_ea6db202 (ceci)
   └─> t_f09ab320  Scaffolder le projet 2D local et la boucle de jeu
          └─> t_dbdbd714  Implémenter la simulation aéroport et l'économie
          └─> t_08d6d880  Construire l'UI, les contrôles et la sauvegarde
          (dbdbd714 & 08d6d880 peuvent tourner en parallèle)
                 └─> t_99de306c  Intégrer, tester et valider les 13 critères
                        └─> t_c7eb57ef  (racine : se réveille quand tous done)
```

Dépendances réelles :

- `t_f09ab320` **dépend de** `t_ea6db202` (décision stack + ce backlog).
- `t_dbdbd714` et `t_08d6d880` **dépendent de** `t_f09ab320` (scaffold) —
  indépendants entre eux, **parallélisables**.
- `t_99de306c` **dépend de** `t_dbdbd714` **et** `t_08d6d880` (intégration).
- `t_c7eb57ef` (racine) se réveille quand tous ses enfants sont done.

### Sous-tâches bornées par carte

> Guides à raffiner à l'exécution. Chaque carte livre un **milestone réellement
> jouable** avant de passer à la suivante (conforme au brief : jouer, observer,
> corriger avant de poursuivre).

**t_f09ab320 — Scaffold** (parents : t_ea6db202)
- `git init` + `.gitignore` + README
- `index.html` + `serve.mjs` (serveur statique 0 dépendance)
- `src/core/` : `GameState`, boucle `requestAnimationFrame`, horloge (pause, vitesse)
- Écrans : menu → jeu, pause, sortie (clavier)
- Caméra 2D : pan (drag/molette) + zoom — déplaçable
- Fond de terrain minimal
- Preuve : le jeu démarre localement (navigateur / CDP), build de tests passe
- **Milestone M1 : nouvelle partie sur terrain vide, caméra jouable, pause/retour**

**t_dbdbd714 — Simulation + Économie** (parents : t_f09ab320)
- `src/infra/` : modèles pistes, taxiways, terminaux, portes, bâtiments ; coût construction/démolition
- `src/flights/` : planning, arrivée/départ, compagnies, catégories avions + contraintes (longueur piste, catégorie de porte)
- `src/sim/` : cycle avion entrant (approche → attente → autorisation → atterrissage → sortie → taxi → porte → débarquement → sol → embarquement → pushback → taxi → attente → décollage → départ) ; positions **interpolées, jamais téléportées**
- `src/pathfinding/` : graphe taxiway, A*, segments occupés, absence de chemin, rerouting ; conflits de ressource + retards
- Passagers agrégés : files, attente, capacités, satisfaction (effet cohérent)
- `src/economy/` : budget, revenus (vols/passagers), dépenses (exploitation/construction), déficit/faillite, progression/déblocages
- `src/persistence/` : sauvegarde manuelle/auto JSON + restauration, gestion état invalide/incompatible
- `tests/` : unitaires des règles, conflits multi-avions, pathfinding, économie, round-trip sauvegarde
- Preuve : tests `node:test` verts ; simulation déterministe
- **Milestones M3/M4 : premier avion porte-départ ; conflits multi-avions**

**t_08d6d880 — UI + Contrôles + Sauvegarde** (parents : t_f09ab320)
- `src/ui/` : rendu canvas (infra, avions en sprites vectoriels simples), HUD (finances, alertes, vitesse)
- Input : sélection, construction/démolition, inspection
- Menus/paramètres ; pause ; vitesse x1/x2/x4
- Écrans sauvegarde/chargement (boutons + raccourcis), feedback (toasts)
- Accessibilité de base (contrastes, focus clavier sur menus)
- Preuve : CDP headless — navigation entre écrans, capture d'état, performances
- **Milestones M5/M6 : passagers/économie visibles ; boucle sauvegardable**

**t_99de306c — Intégration + 13 critères** (parents : t_dbdbd714, t_08d6d880)
- Intégrer tous les systèmes ; jouer de bout en bout
- Exécuter les 13 critères (§5) avec preuves
- `qa/` runbook CDP ; logs ; captures
- README final : lancer, jouer, sauvegarder ; limites connues + pistes futures
- **Milestone final : les 13 critères validés**

## 5. Plan de validation des 13 critères

Méthode : logique simulée → `node:test` (déterministe, sans GUI) ;
UI/intégration → Edge headless CDP (skill `headless-cdp-web-qa`) avec captures
d'état ; le reste → runbook exécuté + preuves. **Chaque critère = une preuve**
(test vert, log, capture d'état).

| # | Critère | Preuve |
|---|---------|--------|
| 1 | Nouvelle partie | test : `newGame()` → état valide, budget initial, terrain vierge ; CDP : bouton « Nouvelle partie » |
| 2 | Construire un petit aéroport | test : placer piste + terminal + portes (coût, compatibilité) ; CDP : mode construction |
| 3 | Recevoir des vols | test : le planning génère des vols arrivants ; sim : vol apparaît à l'approche |
| 4 | Atterrir, rouler jusqu'à la porte, repartir | test : cycle complet d'un avion (chaque état) ; sim : positions interpolées (pas de téléportation) |
| 5 | Gérer plusieurs vols simultanément | test : N vols concurrents, conflits de piste/portes, sans crash |
| 6 | Subir des retards si l'aéroport est mal conçu | test : scénario surchargé → retards/côuts/satisfaction mesurés |
| 7 | Transporter des passagers | test : passagers embarqués/débarqués, files et capacité cohérentes |
| 8 | Recettes et dépenses effectives | test : flux financiers (revenus vs coûts) ; faillite possible en déficit |
| 9 | Agrandir l'aéroport | test : ajout d'infra + déblocage progression ; économie rentable |
| 10 | Sauvegarder | test : round-trip sérialisation JSON ; CDP : bouton sauvegarde |
| 11 | Quitter | test/CDP : sauvegarde auto au fermeture, état persisté |
| 12 | Recharger | test : restaurer un état cohérent ; gestion sauvegarde invalide/incompatible |
| 13 | Poursuivre normalement | CDP runbook : recharger puis simulation continue sans bug |

Robustesse à couvrir (brief) — chaque item a un test dédié dans `tests/` :
aucune piste / aucune porte compatible / taxiway coupé / avion bloqué /
suppression d'un bâtiment occupé / fonds insuffisants / demandes simultanées
pour la même ressource / sauvegarde pendant simulation / reprise / données
invalides ou incompatibles.

## 6. Ce qui est volontairement sauté (et quand le rajouter)

- **Aucun moteur de jeu, aucun bundler, aucune dépendance npm** → rajouter si un
  système (ex. rendu très complexe, physics) dépasse réellement le Canvas 2D natif.
- **Pas de réseau au runtime** (contrainte) → aucune API/LLM, par design.
- **Sprites vectoriels simples** (pas d'assets graphiques lourds) → à upgrader en
  vraie direction artistique **après** que la boucle est jouable.
- **`serve.mjs` minimal** (pas d'Express) → à élargir si des routes sont nécessaires.

## 7. Risques / limites connues (à surveiller pendant l'exécution)

- Déterminisme de la sim : garder `tick` pur ; éviter `Math.random()` non semé
  (semés pour la reproductibilité des tests).
- Performance multi-avions : A* sur le graphe taxiway peut coûter cher →
  `ponytail:` A* simple d'abord ; si c'est lent, Dijkstra itératif / heuristique
  bornée.
- Sauvegarde incompatible : version de schéma stricte ; rejeter proprement.
- Headless CDP : le canvas n'est pas inspectable en pixels — valider l'état DOM/JS
  (classes, HUD, positions des avions dans l'état), pas les pixels.
