# SYNTHÈSE — CONTINUATION_BRIEF.md + AUDIT_2026-10-01.md

Synthèse factuelle des deux documents de référence. Base : dépôt
`C:\Users\Lucas\Documents\AirportTycoon`, révision `80a90ab` (HEAD, identique à la
révision inspectée par l'audit). Les deux documents sont non suivis (untracked) ;
aucun code n'a bougé depuis l'audit.

Ce document est un point d'entrée : il ne remplace ni le brief ni l'audit. Cite
les sections ci-dessous ; ne les résume pas plus loin.

---

## 1. OBJECTIFS

### 1.1 Objectif global (Brief → § Mission)
Faire évoluer le jeu existant (gestion d'aéroport 2D local, hors ligne,
Canvas 2D vanilla, 0 dépendance npm) jusqu'au jeu COMPLET décrit par le brief,
en partant de `80a90ab`. Contrainte de méthode : **ne pas se contenter d'un plan**
— exécuter, préserver l'existant utile et les modifications utilisateur, ne pas
refondre la stack sans problème concret.

### 1.2 État constaté (Audit → § Verdict)
- Prototype **fonctionnel** : démarre, construit, anime des avions, crédite des
  revenus, sauvegarde. Structure modulaire et stack sans dépendances **conformes**.
- **Ne satisfait pas encore** le jeu complet. Plusieurs systèmes sont de simples
  compteurs/temporisations ; les règles de connectivité, d'exclusivité des
  ressources et de restauration ne sont pas robustes.
- La validation antérieure (13 critères / 36 tests + 17 contrôles QA) est jugée
  **trop large** par rapport aux preuves réellement obtenues (cf. § 3 Risques, A14).

### 1.3 Priorités (Audit → § Travail recommandé ; Brief → § Première priorité)
1. Verrouiller régressions + invariants, réparer **connectivité, réservations,
   modifications d'infrastructures** (les 5 exigences incontournables du brief).
2. Achever le **cycle spatial**, la **compatibilité** et le **planning**.
3. Donner un effet réel aux **services** et au **parcours passager**.
4. Construire une **économie** et une **interface** pilotables.
5. Valider **sauvegarde active, reprise, scénarios prolongés, parcours joueur
   complet** (entrées réelles, pas injection d'état).

> L'audit insiste : ces 5 axes sont des **priorités, pas des cartes Kanban
> prédéfinies** — c'est Hermes qui construit le backlog borné.

---

## 2. CONTRAINTES

### 2.1 Produit & technique (Brief → § Produit attendu et contraintes)
- **100 % local / hors ligne** : aucun LLM, API IA, serveur externe, CDN, cloud,
  compte **au runtime du jeu**. Le serveur statique local `127.0.0.1` est autorisé.
- Garder la structure **modulaire** ; chaque abstraction doit résoudre un problème
  concret.
- Ne **pas** privilégier une refonte esthétique aux mécanismes manquants.

### 2.2 Contenu de jeu (Brief → § Produit attendu / § Achever les mécaniques)
- Départ : petit terrain, une piste, un terminal **minimaux utilisables**
  (l'audit constate : nouvelle partie = terrain **vide**, pas de piste/terminal →
  écart, cf. table « Fonctions demandées », ligne « Nouvelle partie »).
- Construire : pistes, taxiways, portes, terminaux, services. Agrandissement par
  infrastructures suffit ; **pas** de système d'achat de terrain imposé.
- Catégories d'avions + compagnies doivent avoir un **effet cohérent** sur besoins
  et traitement (audit : compagnies surtout **cosmétiques**, catalogue peu utilisé).
- **Fret** et **correspondances : optionnels** (explicitement non obligatoires).
- Passagers : simulation **agrégée** acceptée ; un simple total transporté ne
  l'est **pas**.

### 2.3 Organisation & non-régression (Brief → § Organisation native Hermes)
- Backlog Kanban **construit par Hermes** à partir des dépendances techniques et
  des écarts constatés. **Interdits** : reproduire les 5 anciennes cartes
  gigantesques, ni une carte par ligne du brief.
- Chaque carte : responsabilité **bornée**, dépendances, résultat **vérifiable**,
  preuve d'acceptation. Décomposer toute carte « implémenter toute la sim / toute
  l'UI / tout le jeu ».
- Contexte principal = décomposition, décisions, coordination, synthèse.
  Implémentation substantielle / explorations longues / validations répétées →
  subagents `delegate_task` à **contexte frais**. Étapes critiques → reviewer
  **indépendant** de l'implémenteur.
- **Concurrence inchangée** (pas d'augmentation des workers ni de NInfer).
  **Interdits** : profil permanent, routeur, harness, daemon, framework agentique ;
  modification de Chat Qwen, SOUL, configs Hermes, modèle local/runtime/provider.
- Conserver un simple `PROGRESS.md` (état backlog, preuves, décision, problème
  ouvert, prochaine tâche) mis à jour après milestones et avant interruption.
  C'est un point de **reprise**, pas un nouveau système agentique.

### 2.4 Méthode de correction (Brief → § Première priorité)
- **Reproduire** d'abord les problèmes de l'audit avant de les corriger.
- Ajouter des **tests de régression métier** qui échouent pour la **bonne raison**
  sur le défaut, puis vérifier la correction.
- **Ne pas** garder une assertion trompeuse juste pour rester vert (cf. A14).

### 2.5 Limites environnement (Brief → § Continuité / § Validation)
- Respecter budgets et limites d'environnement. Une **limite d'itérations** ou un
  **crash ne vaut pas réussite** : conserver le diagnostic, réduire le périmètre,
  utiliser la reprise native. **Ne pas** boucler à l'identique.
- **Ne pas** modifier le pare-feu / la config réseau de la machine pour le test
  hors ligne.

---

## 3. DÉCISIONS (déjà prises dans les documents)

D1. **Base de départ = `80a90ab`** (Brief § Mission ; Audit § en-tête).
D2. **Pas de refonte** : stack Canvas 2D vanilla sans dépendances conservée
   (Audit § Verdict, table « Modules séparés »).
D3. **Passagers agrégés par groupes** (capacité, check-in, sécurité, attente,
   files) — acceptés ; simple total interdit (Brief § Passagers).
D4. **Fret/correspondances optionnels** (Brief § Produit attendu ; Audit table).
D5. **Pas d'achat de terrain** imposé (Brief § Produit attendu).
D6. **Reproduction avant correction** des 7 familles de défauts de l'audit
   (Brief § Première priorité ; Audit § Problèmes prioritaires).
D7. **Backlog borné auto-construit par Hermes**, subagents frais, revue
   indépendante, concurrence figée (Brief § Organisation native Hermes).
D8. `PROGRESS.md` = unique mécanisme de reprise léger, pas de framework (ibid.).
D9. **Interdiction de clôture au premier MVP / sur la base des 36+17 anciens
   tests** (Brief § Conditions de clôture ; Audit § Lecture des 13 critères).
D10. Validation finale = **parcours joueur réel** (clics, touches, commandes UI),
    **pas** injection d'état via `window.__game` (Brief § Validation).
D11. Sauvegarde : **préserver** la copie invalidée pour diagnostic ; annoncer
    clairement les incompatibilités sans charger un état qui plante au tick suivant
    (Brief § Persistance ; Audit A11/A10).
D12. Scénario **prolongé** (plusieurs journées simulées ou charge équivalente)
    + session de rendu réel assez longue ; **indiquer séparément** durées simulées
    et réelles (Brief § Validation).

---

## 4. RISQUES (défauts prouvés par l'audit — A1..A14)

Cinq familles « majeures/bloquantes », une de « validation », plus les
constatations économiques. Source : Audit § Problèmes prioritaires + table.

### R1. Connectivité physique fausse — MAJEUR (A1, A2 ; Brief exigence 1)
`src/pathfinding/path.mjs` relie les extrémités de segments à < 320 unités et
rattache chaque porte au nœud le plus proche, **sans liaison construite ni
distance max**. A1 : chemin trouvé avec **zéro taxiway** vers une porte à 374 u.
A2 : plan de test accepte une liaison malgré **150 u de vide** entre taxiway et
piste. → Le réseau peut autoriser des chemins qui n'existent pas ; couper un
taxiway n'a pas les conséquences fiables demandées. Le test pathfinding valide
un **faux réseau connecté**.

### R2. Réserves d'exclusivité absentes — MAJEUR (A3, A4, A5 ; Brief exigence 2)
`src/sim/aircraft.mjs` : occupation des segments calculée une seule fois au début
du tick ; porte non réservée à l'attribution ; pistes ignorent les avions en
`departure`. A3 : deux avions prennent le **même segment libre 30** au même tick.
A4 : `departure` et `landing` simultanés sur **une même piste**. A5 : deux avions
sortant reçoivent la **même porte 3-g0**. → Pas d'invariant de réservation, pas
de politique d'attente/libération.

### R3. Démolition pendant exploitation → état invalide + CRASH — BLOQUANT
(A6, A7 ; Brief exigence 3)
`src/infra/infra.mjs` + `src/sim/aircraft.mjs` : démolition du terminal ne
vérifie que la **première** porte ; suppression de taxiway sans protection
d'occupation ; itinéraires conservent des **indices** dans un graphe reconstruit.
A6 : 2e porte occupée, démolition réussit, avion `ground` avec `gateId: null`.
A7 : suppression d'un taxiway occupé → tick suivant
`Cannot read properties of undefined (reading 'seg')`.

### R4. Catégorie d'avions L structurellement intraitable — MAJEUR (A8, A13)
`infra.mjs:85` + `catalog.mjs:21` + `flights.mjs:18` : chaque terminal fournit
uniquement `S/M/M/S`, **aucun outil ne construit une porte L**, or les gros
avions `L` sont générés normalement. A13 (seed 42, 120 min) : 35/37 avions
**bloqués** (dont 35 gros), satisfaction **0 %**, trésorerie qui **croît** (27 885
→ 145 397). Le plafond d'arrivées ne compte pas `blocked` ; aucune annulation/
détournement ; la satisfaction à zéro n'empêche pas la croissance des recettes.
→ Combine un défaut de compatibilité ET des règles économiques trop faibles.

### R5. Téléportation / position non conservée — MAJEUR (A9 ; Brief exigence 5)
`aircraft.mjs:94,127,183,205` : avion passe de x=200 à x=800 **en un tick** à
l'atterrissage ; position déclarée « arrivée à la porte » reste à **51,5 u** du
centre ; pushback = réaffectation de route sans déplacement. → Pas de mouvement
progressif, portes non-véritables destinations.

### R6. Sauvegarde non validée — MAJEUR (A10, A11 ; Brief § Persistance)
`save.mjs` + `save-panel.mjs` : A10 `sim.infra.runways = null` accepté →
crash `reading 'length'` au 1er tick. A11 `serialize` **modifie la partie active**
(efface le graphe, la marque sale) malgré le contrat de fonction pure.
Structures/phases/ID/références/capacités **non validées**. Le chargement
**supprime** la sauvegarde en cas d'erreur sans copie récupérable.

### R7. Faux positifs de validation — MAJEUR pour la validation (A14 + listage)
`tests/sim.test.mjs` + `qa/cdp-boot.mjs` : A14 « 3 arrivées → 3 départs »
incrémente à chaque tick où un avion reste `departed` → `counter=3` avec **un seul
identifiant réellement parti** (les 2 autres encore en débarquement) ; assertion
finale seulement `>=2`. Autres : recettes positives sans dépenses d'exploitation ;
scénario « connecté » sur le graphe permissif ; aucun test négatif anti-douche ;
tests de construction qui **retournent silencieusement** si la sim manque ; QA qui
construit via `buildBuilding` + `tick` artificiel + `save/load` ; reprise vérifiée
sur `time > 0` seulement.

### R8. Faiblesse économique (A12 + table)
Aucun **coût d'exploitation** piste/taxiway/terminal en 1 h simulée (A12) ;
carburant enregistré comme **recette négative** pas comme **dépense** ; pas de
bilan joueur ; retards/satisfaction : double comptage possible + tout avion déjà
retardé continue de pénaler indéfiniment.

> R1-R7 sont les cibles directes des 5 exigences incontournables du brief
> (connectivité / réservations / infrastructures sûres / compatibilité /
> déplacement continu) + persistance.

---

## 5. CRITÈRES DE FIN

### 5.1 13 critères de clôture (Brief → § Conditions de clôture)
Le parcours complet doit permettre :
1. Démarrer une nouvelle partie avec un **petit aéroport utilisable**.
2. Construire et **connecter** des infrastructures supplémentaires.
3. Organiser / recevoir des **vols compatibles**.
4. Voir les avions approcher, atterrir, rejoindre **réellement** une porte puis
   repartir.
5. Gérer plusieurs vols et les **conflits de ressources sans double réservation**.
6. Produire des **retards explicables** (mauvaise conception) puis les réduire.
7. Transporter des passagers avec **capacités/files/services** significatifs.
8. Voir revenus et dépenses ; rendre rentable **ou** subir un déficit.
9. Agrandir et **débloquer** des améliorations utiles.
10. **Sauvegarder** pendant une activité réelle.
11. Quitter et fermer la page.
12. Réouvrir et **recharger** la sauvegarde.
13. Continuer **sans perdre** vols, réservations, files, services, finances.

### 5.2 Interdiction explicite de clôture précoce (Brief → § Conditions, dernière ligne)
**Ne pas conclure que le projet est terminé parce que les 36 tests + 17
contrôles passent.** Les exigences ci-dessus sont **obligatoires** ; les
extensions non demandées sont secondaires. Interdit d'inscrire les passagers,
services, conflits ou interfaces manquants dans « améliorations futures » pour
justifier une clôture.

### 5.3 Preuves de validation requises (Brief → § Validation)
- Méthode : inspecter → implémenter → **exécuter** → observer → tester →
  corriger → revalider. Jamais terminer une carte sur la seule lecture du code.
- Scénarios déterministes ; invariants **après chaque tick** ; tests qui
  **échouent** si la sim manque (pas de succès silencieux).
- Couverture minimum (liste du brief § Validation) : réseau connecté/déconnecté,
  coupe en cours de taxi, routes alternatives, suppression occupée, références
  réaffectées ; demandes simultanées piste/porte/segment, séquence
  arrivée-départ, libération après incident ; **plusieurs identifiants
  distincts** arrivés et partis (comptes conservés, pas de multi-comptage) ;
  catégories compatibles/incompatibles, absence piste/porte ; capacité terminal,
  files, saturation services, manque carburant, maintenance, retards ; coût
  d'exploitation **même sans vol**, construction/démolition, revenus,
  déficit/faillite, scénario rentable ; sauvegarde/reprise multi-phases actives
  (taxi, service occupé), fichiers malformés, types invalides, références
  absentes, versions incompatibles ; pause/vitesses/stabilité.
- **Lancer réellement le jeu** après chaque milestone. Validation finale =
  parcours via **entrées utilisateur réelles** (clics/touches/commandes UI), pas
  d'injection `window.__game`.
- Observer visuellement, collecter **erreurs de console**, vérifier **l'absence
  de requêtes vers l'extérieur** pendant le fonctionnement (sans toucher au
  pare-feu).
- Scénario **prolongé** automatisé (plusieurs journées simulées ou charge
  équivalente) : mesures débit vols, attentes, blocages, finances, population
  d'objets ; + session de rendu réel longue ; **durées simulées ≠ réelles**
  toujours séparées ; ne jamais présenter une boucle accélérée en mémoire comme
  des heures observées à l'écran.

### 5.4 Rapport final / d'interruption (Brief → § Rapport final)
Fournir : interruptions éventuelles ; révisions départ/fin ; architecture
finale ; backlog créé/révisé et **nombre réel de cartes terminées** ;
fonctionnalités validées ; bugs reproduits et corrigés ; commandes de test +
résultats ; scénarios visuels/exécutés avec **chemins des preuves** ; bilan du
scénario prolongé et de la sauvegarde/reprise ; limites connues + exigences encore
incomplètes ; ce qui a été réellement **délégué**, comment borné, revues
indépendantes, échecs/budgets de workers. **Ne pas fabriquer** nombre d'agents ni
preuve. Si non fini : laisser un état **exécutable** ou documenter le blocage
exact, mettre à jour `PROGRESS.md`, donner la prochaine carte bornée. **Un bilan
honnête vaut mieux qu'un « complet » non démontré.**

### 5.5 Limites connues de l'audit (Audit → § Limites)
- Aucun code/test/profil/SOUL/modèle/NInfer modifié ; aucune carte Kanban créée.
- `npm test` **échoue** dans l'environnement d'exécution : `npm-cli.js` introuvable
  sous `AppData\Roaming\npm` ; **`node --test` direct fonctionne**. C'est un défaut
  du lanceur npm de **cet environnement**, pas du jeu ; non corrigé pendant
  l'audit. → Utiliser `node --test tests/*.test.mjs` (commande validée, cf.
  package.json `npm run test`).
- Pas de longue session de rendu, pas de FPS/mémoire navigateur, pas de
  validation interactive souris/clavier complète **dans l'audit** — le brief les
  exige avant de conclure.

---

## 6. AMBIGUÏTÉS & POINTS À TRANCHE

A-1. **Niveau de preuve du « parcours joueur complet ».** Le brief exige un
parcours via entrées réelles, mais ne précise ni la durée d'observation ni le
seuil de FPS/stabilité « assez long ». À trancher lors de la conception du
scénario prolongé.

A-2. **« Petits aéroport utilisable » vs terrain vide.** L'audit constate que
nouvelle partie = terrain vide ; le brief exige « petit terrain, une piste et un
terminal minimal utilisables ». Ambiguïté : faut-il **séquencer** un aéroport de
départ (piste + terminal) dans la nouvelle partie, ou accepter que le joueur les
construise ? Le brief penche pour un aéroport de départ **fourni**.

A-3. **Grain des cartes Kanban.** « Responsabilité bornée » n'est pas chiffrée ;
le brief interdit à la fois les cartes colossales et une carte par ligne. Le
nombre de cartes est laissé à la discrétion d'Hermes (explicitement non imposé).

A-4. **Environnement npm.** L'audit signale `npm test` cassé (npm-cli.js absent)
mais `node --test` OK. Ambiguïté sur quel validateur retenir comme source de
vérité : `node --test` (fonctionnel) plutôt que le lanceur npm. À confirmer
avant de s'appuyer sur `npm run test`.

A-5. **État « blocked » des avions.** Le plafond d'arrivées ne compte pas les
avions `blocked` (A13) — il faut soit les annuler, soit les détourner, soit les
compter. Le brief exige « traiter les blocages persistants sans croissance
infinie » mais ne tranche pas entre annulation et détournement.

A-6. **Carburant : dépense ou recette négative.** L'audit (A12) dit que le
carburant est « enregistré comme recette négative, pas comme dépense » ; le brief
exige de « comptabiliser le carburant comme dépense ». La reformulation
comptable exacte (compte dédié vs recette négative) n'est pas spécifiée.

A-7. **Incidents.** Le brief demande « incidents opérationnels limités mais
réels » (perturbation + réaction + conséquences + récupération) mais **interdit**
d'en faire une collection de pannes avant d'avoir fiabilisé les règles de base.
Ordre d'apparition : incidents **après** fondations fiables.

A-8. **Revue indépendante.** « Les étapes critiques doivent être vérifiées par un
reviewer indépendant du subagent qui les a implémentées, via les capacités
natives disponibles. » Le mécanisme de revue (nouvelle carte reviewer vs
débat) n'est pas spécifié — à implémenter via `kanban_create`/subagents, sans
nuevo framework (D8).

A-9. **Durées simulées vs réelles.** Le brief est strict sur leur séparation
mais ne donne pas de conversion (ex. facteur x4, pas de temps). À documenter dans
chaque preuve.

---

## 7. EXIGENCES EXPLICITES vs IMPLICITES (relevé)

**ExPLICITES** (énoncées textuellement) : les 5 exigences incontournables
(connectivité, réserves exclusives, infrastructures sûres, compatibilité,
déplacement continu) ; 13 critères de clôture ; contraintes local/offline ;
backlog borné + subagents + revue indépendante + concurrence figée ; `PROGRESS.md` ;
validation par exécution + parcours réel + scénario prolongé ; rapport final.

**IMPLICITES** (dérivées, à ne pas oublier) :
- **Preservation** des modifications utilisateur et des parties utiles du code
  (Brief § Mission) — ne pas réécrire à blanc.
- **Continuité** : relever la révision au lancement, garder un point de reprise
  précis, ne pas fermer artificiellement les cartes restantes (Brief § Continuité).
- **Déterminisme** : reproductibilité des scénarios (seed), conservation de
  l'état du générateur aléatoire pour sauvegardes déterministes (Brief §
  Persistance/Validation).
- **Non-régression** : les 36+17 tests restent des **smoke tests** utiles mais ne
  suffisent plus à certifier (Audit § Lecture) — à conserver + étendre, pas à
  supprimer.
- **Diagnostic avant correction** : reproduire chaque A1..A14 (via `probes.mjs`
  du dossier d'audit `Codex\2026-09-14\...\audit-airport`) avant de corriger.
- **Honnêteté** : un bilan d'avancement honnête prime sur un « complet » non
  démontré ; ne jamais présenter la mémoire accélérée comme du temps réel.

---
*Sources : CONTINUATION_BRIEF.md (144 l.) et AUDIT_2026-10-01.md (169 l.),
révision de base 80a90ab. Dossier de preuves de l'audit :
`C:\Users\Lucas\Documents\Codex\2026-09-14\je-veux-changer-mon-mod-le\audit-airport`
(probes.mjs, probes-resultats.json, probe-test-multivols.mjs, qa-resultats.txt,
evidence/jeu-en-cours.png).*
