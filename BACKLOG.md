# BACKLOG — Airport Tycoon (cartes bornées, dépendances, priorités)

Carte Kanban : t_14c9b7b1. Source : AC_EXTRAITS.md (AC1-40, MVP-1..10,
NONMVP-1..9, EV-1..10) + SYNTHESIS_CONTINUATION.md + AUDIT_2026-10-01.md.
Base : `80a90ab`. Grain : 20 cartes (A-3 tranché ici).

## Règles partagées (portées par TOUTE carte créée depuis ce backlog)
- Repo `C:\Users\Lucas\Documents\AirportTycoon`, base `80a90ab`, stack
  Canvas 2D vanilla 0 dépendance npm, structure modulaire conservée (AC34).
- Validateur : `node --test tests/*.test.mjs` (A-4 : npm-cli.js cassé dans
  cet environnement ; `npm run test` reste en référence package.json).
- Méthode : REPRODUIRE d'abord (probes du dossier d'audit
  `C:\Users\Lucas\Documents\Codex\2026-09-14\je-veux-changer-mon-mod-le\audit-airport`)
  AVANT de corriger ; chaque défaut corrigé a un test de régression qui
  ÉCHOUAIT pour la bonne raison avant correction (AC33, EV-2).
- `PROGRESS.md` (repo racine) : créé par BL-00, mis à jour (état backlog,
  preuves, décision, problème ouvert, prochaine carte) après CHAQUE carte
  terminée et avant toute interruption (AC30, EV-7). Pas de framework.
- Preuves dans `evidence/` (noms horodatés + commit). Local/offline : aucun
  LLM/API/CDN/cloud au runtime (AC36, EV-5).
- Concurrence figée : sous-agents frais (`delegate_task`), pas de worker
  additionnel, pas de NInfer, pas de profil/permanent/routeur/harness/daemon,
  aucune modification Chat Qwen/SOUL/configs Hermes/modèle (AC32).
- Revue indépendante (A-8) : les cartes critiques (BL-03, BL-04, BL-08,
  BL-11, BL-18) sont suivies d'une carte reviewer créée via `kanban_create`
  (contexte frais, ≠ implémenteur) qui vérifie les critères de fin avant
  validation. La carte de délégation (t_74be9707) exécute ce mécanisme.

## Décisions (tranchage des ambiguïtés A-1..A-9)
- **A-1 seuil "assez long"** : session de rendu finale = 5 min temps RÉEL,
  jeu à vitesse max, 0 erreur console, FPS échantillonné (médiane ≥ 30) ;
  scénario prolongé = 2 jours simulés (48 h sim). (Porté par BL-17/BL-18.)
- **A-2 aéroport de départ** : Fourni. Nouvelle partie = 1 piste + 1
  terminal minimal (2 portes) + taxiway connectés (BL-01).
- **A-3 grain des cartes** : 20 cartes (BL-00..BL-19), chacune = 1
  responsabilité bornée (1-2 modules + ses tests), critères de fin + preuve.
  Ni carte colossale ni carte par ligne du brief.
- **A-4 validateur** : `node --test tests/*.test.mjs` = source de vérité.
- **A-5 blocages persistants** : COMPTER + ANNULER. Le plafond d'arrivées
  compte les avions `blocked` (fin de l'accumulation A13) ; après 10 min
  simulées de blocage sans route réalisable, le vol est annulé avec cause
  visible (alerte UI + note planning). Détéournement non implémenté (YAGNI) ;
  re-dispatch uniquement si le vol est encore dans sa fenêtre de validité.
- **A-6 carburant** : compte DÉDIÉ en dépense (jamais recette négative) ;
  bilan par période = recettes / dépenses exploitation / carburant /
  investissements (BL-09).
- **A-7 incidents** : ordre figé — APRÈS la passe MVP (BL-11) et APRÈS les
  services (BL-12) : carte BL-14. Jeu limité (2-3 incidents), pas de
  collection de pannes.
- **A-8 revue indépendante** : carte reviewer via `kanban_create` après
  BL-03, BL-04, BL-08, BL-11, BL-18 (voir règle partagée).
- **A-9 conversion durées** : documentée dans CHAQUE preuve EV-4 : facteur
  de temps (vitesse max du jeu), durées simulées et réelles TOUJOURS
  séparées dans le JSON de sortie ; jamais présenter une boucle mémoire comme
  du temps observé (BL-17).

## Cartes

Priorités : P0 = MVP (MVP-1..10), P1 = complétion (NONMVP-1..6), P2 = clôture.

### Phase 0 — Base & reproduction (P0)

**BL-00** Reproduire les 8 risques et initialiser PROGRESS.md.
Dépend : —. AC/EV : EV-1, AC33.
Scope : exécuter `probes.mjs` + `probe-test-multivols.mjs` du dossier d'audit
sur `80a90ab` ; persister sorties JSON horodatées (A1..A14, R1..R8) dans
`evidence/` ; créer `PROGRESS.md` (état, preuves, décision, problème ouvert,
prochaine carte).
Fin : chaque défaut R1-R8 reproduit (`confirmed: true`) avec commit horodaté
; PROGRESS.md existe. Artefacts : `evidence/audit-80a90ab/*.json`,
`PROGRESS.md`.

### Phase 1 — MVP : fondations (P0)

**BL-01** Nouvelle partie avec aéroport fourni (MVP-1, AC1, AC38, A-2).
Dépend : BL-00. Scope : `src/core/new-game.mjs` — plan de départ : 1 piste +
terminal 2 portes + taxiway connectés (réseau physique valide selon BL-02).
Fin : scénario "nouvelle partie" → 1 vol complet (arrivée→départ) sans
construction préalable ; test `node --test`. Artefact : test + capture.

**BL-02** Connectivité physique (MVP-2, AC14, R1 : A1, A2).
Dépend : BL-00. Scope : `src/pathfinding/path.mjs` — liaison uniquement si
segment/porte reliée par taxiway CONSTRUIT, distance max bornée, portes à
destination explicite ; test NÉGATIF (chemin hors taxiway refusé) ; couper
un taxiway = blocage réel des routes concernées.
Fin : A1/A2 plus reproduisibles ; test négatif passe. Artefact : tests.

**BL-03** Réservations exclusives (MVP-3, AC5, AC15, R2 : A3, A4, A5) — CRITIQUE.
Dépend : BL-02. Scope : `src/sim/aircraft.mjs` — attribution atomique
(segment/piste/porte), occupation mise à jour au déplacement, landing et
departure exclusifs sur piste, libération sûre, attentes équitables ;
blocages persistants = décision A-5 (comptés + annulés à 10 min sim, cause
visible). Invariants vérifiés APRÈS CHAQUE TICK (EV-9).
Fin : A3/A4/A5 plus reproduisibles ; invariants/tick passent. Artefact : tests
invariants + suite reviewer (A-8).

**BL-04** Infrastructures sûres (MVP-4, AC16, R3 : A6, A7) — CRITIQUE.
Dépend : BL-03. Scope : `src/infra/infra.mjs` + `src/sim/aircraft.mjs` —
démolition : TOUTES les portes vérifiées, refus si occupé OU réaffectation
explicite ; suppression de taxiway occupée protégée ; itinéraires par
IDENTIFIANTS (pas indices) ; invalidation des routes ; aucun chemin → blocage
expliqué, pas de crash.
Fin : A6/A7 plus reproduisibles ; démolition pendant exploitation = pas de
crash. Artefact : tests + suite reviewer (A-8).

**BL-05** Compatibilité réalisable (MVP-5, AC17, R4 : A8, A13, AC39).
Dépend : BL-03. Scope : `src/data/catalog.mjs`, `src/infra/infra.mjs`,
`src/flights/flights.mjs` — portes L constructibles (ou vols L explicitement
limités au catalogue) ; effet cohérent des catégories/compagnies sur
besoins/taille/temps (pas cosmétique) ; plafond d'arrivées compte `blocked`
(A-5) ; satisfaction 0 % stoppe la croissance des recettes.
Fin : A8 (porte L possible ou limités) ; A13 (seed 42 : blocages finis,
satisfaction ≠ 0 %) plus reproduisibles. Artefact : tests seed 42.

**BL-06** Déplacement continu + cycle spatial complet (MVP-6, AC18, AC20,
R5 : A9).
Dépend : BL-02, BL-03. Scope : `src/sim/aircraft.mjs`, `src/pathfinding/path.mjs`
— approche progressive vers l'axe, atterrissage sans saut (delta position max
par tick borné), porte = vraie destination (position au centre), pushback
avec déplacement réel, orientation/phase lisibles ; cycle complet
approche→…→décollage.
Fin : A9 plus reproduisible ; trace de phases d'un vol complet sans saut.
Artefact : test delta position + trace de phases.

**BL-07** Planning pilotable + attribution (MVP-6/AC20, AC3, NONMVP-8).
Dépend : BL-03, BL-05. Scope : `src/flights/flights.mjs` — planning consultable
(compagnie, appareil, passagers, horaires prévus/réels, état, retard, cause)
+ décision acceptation/refus ; attribution compatible/disponible/accessible
avec alternatives ; fin du générateur aléatoire invisible.
Fin : test d'attribution + UI planning (données exposées à la UI par BL-16).
Artefact : tests planning.

**BL-08** Persistance validée (MVP-7, AC19, AC10, AC11, AC12, AC13,
R6 : A10, A11, EV-10) — CRITIQUE.
Dépend : BL-06. Scope : `src/persistence/save.mjs`, `src/ui/save-panel.mjs` —
validation schéma/types/identifiants/références/capacités au chargement ;
`serialize` pure (ne modifie plus la partie) ; caches dérivés reconstruits ;
sauvegarde invalidée PRÉSERVÉE (copie diagnostic) + incompatibilité annoncée
sans crash ; seed du générateur aléatoire conservé dans la sauvegarde
(EV-10) ; sauvegarde/reprise en phases actives (taxi, service occupé).
Fin : A10/A11 plus reproduisibles ; reprise sans perte vols/réservations/
files/services/finances (AC10-13). Artefact : tests fichiers malformés,
versions incompatibles + suite reviewer (A-8).

**BL-09** Économie de base (MVP-8, AC8, AC23 base, R8 : A12, A-6).
Dépend : BL-03. Scope : `src/economy/economy.mjs` — coût d'exploitation de
piste/taxiway/terminal (MÊME sans vol) ; carburant = compte dédié en dépense
(A-6) ; bilan par période séparé (recettes/exploitation/carburant/
investissements) avec causes du déficit.
Fin : A12 (coût d'exploitation présent) plus reproduisible ; scénario
déficit ET scénario rentable exécutables. Artefact : tests bilan.

### Phase 2 — MVP : tests & validation par exécution (P0)

**BL-10** Intégrité de la suite de tests (MVP-9, AC25, AC26, AC33, R7 : A14).
Dépend : BL-02..BL-06. Scope : `tests/*.test.mjs` — nettoyage A14 (comptage
par IDENTIFIANT distinct, pas multi-tick ; assertion exacte) ; tests qui
ÉCHOUENT si la sim manque (pas de retour silencieux) ; invariants post-tick
(réservation, position, comptes passagers, trésorerie — EV-9) ; scénarios
déterministes seed documenté (EV-10) ; couverture AC26 (a), (b), (d), (e)
partielle (capacité files), (f) partiel, (g).
Fin : `node --test` 0 échec, chaque défaut R1-R8 a un test qui échouait
avant ; A14 plus reproduisible. Artefact : sortie complète de `node --test`.

**BL-11** QA CDP par entrées réelles — PORTE MVP (MVP-10, AC27, AC28, EV-3,
EV-5, EV-6) — CRITIQUE.
Dépend : BL-10. Scope : `qa/cdp-boot.mjs` — parcours complet (construction,
vols, conflits, sauvegarde/reprise, finances) via CLIQUES/TOUCHEs/commandes
UI RÉELLES, aucune injection `window.__game` ; absence de requêtes externes
(logs réseau navigateur, pare-feu intact — EV-5) ; erreurs de console
collectées (EV-6) ; captures dans `evidence/`.
Fin : scénario complet PASS par entrées réelles ; 0 requête externe ; 0
erreur console ; captures + script dans `evidence/`. Artefacts : script,
sortie, captures. Suite reviewer (A-8) puis PROGRESS.md = "MVP validé".

### Phase 3 — Complétion (P1)

**BL-12** Services au sol opérationnels (NONMVP-1, AC21, AC26e).
Dépend : BL-06, BL-09. Scope : `src/economy/economy.mjs` +
`src/infra/infra.mjs` + `src/sim/aircraft.mjs` — carburant/nettoyage/
bagages/maintenance : disponibilité, capacité/temps, coût, effet réel sur
le vol (absence/saturation = attente expliquée) ; besoins liés taille/état
de l'avion ; déblocages non bloquants.
Fin : test saturation service → retard mesurable ; aucun bâtiment coûtant
sans servir. Artefact : tests saturation.

**BL-13** Parcours passager agrégé (NONMVP-2, AC7, AC22, AC40).
Dépend : BL-06, BL-09. Scope : `src/sim/` (nouveau module passagers agrégé)
— capacité terminal, check-in, sécurité, files, attente, débarquement,
embarquement, bagages ; groupes associés vol/terminal SANS double comptage ;
files visibles ; satisfaction évolutive (un retard ancien ne condamne pas
indéfiniment).
Fin : test saturation files + évolution satisfaction après correction ;
pas de simple total transporté (AC40). Artefact : tests files.

**BL-14** Incidents limités mais réels (NONMVP-3, AC20, A-7).
Dépend : BL-11 (porte MVP), BL-12. Scope : `src/sim/` — 2-3 incidents
(breakdown service/porte, fermeture piste temporaire, pic de demande) :
perturbation + réaction + conséquences + récupération ; pas de collection de
pannes.
Fin : test : incident → conséquence mesurée → récupération. Artefact : test
incident.

**BL-15** Économie profonde + déblocages utiles (NONMVP-4, AC6, AC9, AC23,
AC26f).
Dépend : BL-09, BL-12. Scope : `src/economy/economy.mjs` +
`src/core/game-state.mjs` — progression multi-étapes, ≥ 2 déblocages à effet
jouable (pas de verrous bloquants) ; conséquences retards/incidents/
satisfaction sur finances ; scénario déficit/faillite vs rentable ; bilan
par période avec causes.
Fin : 2 déblocages à effet mesurable ; scénario déficit ET rentable exécutés.
Artefact : tests finances.

**BL-16** Interface de gestion complète (NONMVP-5, AC24, AC26h partie UI).
Dépend : BL-07, BL-12, BL-13, BL-15. Scope : `src/ui/` — inspection
avion/bâtiment, liste de vols/planning, bilan financier, statistiques,
historique d'alertes (causes + action), diagnostic réseau coupé / service
saturé depuis la UI ; capacités/occupations visibles ; caméra/glisser ne
construit pas ; raccourcis compatibles formulaires.
Fin : QA CDP : chaque panneau lisible, diagnostic coupé/saturé visible.
Artefact : script QA + captures.

### Phase 4 — Clôture (P2)

**BL-17** Scénario prolongé + session de rendu (NONMVP-6, AC29, EV-4, A-1,
A-9).
Dépend : BL-14, BL-15, BL-16. Scope : script de simulation (2 jours sim) :
mesures débit vols, attentes, blocages, finances, population d'objets →
JSON ; session de rendu 5 min réel (seuil A-1) : FPS, 0 erreur console,
captures ; durées simulées/réelles TOUJOURS séparées + facteur de temps
documenté (A-9) ; stabilité prolongée (pas d'accumulation inexpliquée ni
blocage permanent).
Fin : JSON + captures dans `evidence/`, durées séparées, 0 accumulation.
Artefact : JSON + captures.

**BL-18** Couverture finale + revalidation entrées réelles (AC26c/h, AC27,
EV-3 final) — CRITIQUE.
Dépend : BL-17. Scope : tests multi-identifiants distincts (AC26c : comptes
conservés, pas de multi-comptage) ; pause/vitesses/stabilité (AC26h) ;
RELANCE complète de la QA CDP BL-11 sur l'état final (aucune injection).
Fin : revalidation finale PASS, 0 échec `node --test`, captures final.
Artefacts : sortie tests, script QA, captures. Suite reviewer (A-8).

**BL-19** Rapport final (NONMVP-7, AC31, EV-8).
Dépend : BL-18. Scope : rapport à la racine : interruptions, révisions
départ/fin, architecture finale, backlog + nombre réel de cartes terminées,
fonctionnalités validées, bugs reproduits/corrigés, commandes de test +
résultats, chemins des preuves (EV-1..7), bilan scénario prolongé +
sauvegarde/reprise, limites connues + exigences incomplètes, délégation
réelle + revues indépendantes. Honnêteté : un bilan honnête prime sur un
"complet" non démontré (AC31/AC37).
Fin : rapport complet avec chemins des preuves. Artefact : `RAPPORT_FINAL.md`.

NONMVP-9 (fret/correspondances) : EXCLUS explicitement (AC39, D4) — ni MVP
ni complétion obligatoire ; ne pas créer de carte.

## Matrice de couverture (tous les AC extraits sont couverts)
AC1/AC38 → BL-01 · AC2 → BL-02 (réseau) + BL-07 (organisation) · AC3 → BL-07 ·
AC4/AC20(cycle) → BL-06 · AC5/AC15 → BL-03 · AC6 → BL-15 · AC7/AC22/AC40 →
BL-13 · AC8 → BL-09 · AC9/AC23(profonde) → BL-15 · AC10/AC11/AC12/AC13 →
BL-08 · AC14 → BL-02 · AC16 → BL-04 · AC17/AC39 → BL-05 · AC18 → BL-06 ·
AC19 → BL-08 · AC21 → BL-12 · AC23(base) → BL-09 · AC24 → BL-16 · AC25/AC26/
AC33 → BL-10 · AC27/AC28 → BL-11 + BL-18 · AC29 → BL-17 · AC30/EV-7 → règle
partagée (PROGRESS.md) + BL-00 · AC31 → BL-19 · AC32 → règles partagées +
t_74be9707 · AC34 → règles partagées · AC35 → règles partagées (PROGRESS.md,
révision relevée au lancement) · AC36/AC37 → règles partagées + BL-11 (EV-5/6)
+ BL-19. EV-1 → BL-00 · EV-2/EV-9/EV-10 → BL-03..BL-10 · EV-3/EV-5/EV-6 →
BL-11, BL-18 · EV-4 → BL-17 · EV-7/AC30 → BL-00 + règles partagées · EV-8 →
BL-19.

## Instructions pour la carte de délégation (t_74be9707)
1. Créer ces 20 cartes (BL-00..BL-19) via `kanban_create` (assignee
   `default`, modèle local existant, workspace dir = repo) en reproduisant
   dépendances (`parents=[...]`), priorités (P0 < P1 < P2), corps autonome +
   décisions portées + critères de fin + artefacts.
2. Implémentations substantielles → subagents `delegate_task` à contexte
   frais ; cartes critiques (BL-03, BL-04, BL-08, BL-11, BL-18) suivies
   d'une carte reviewer (A-8).
3. Pas de carte colossale, pas de carte par ligne ; une carte = une
   responsabilité bornée exécutée en une unité.
