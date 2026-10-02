# Synthèse des exigences Hermes — AirportTycoon
Consolidation des 5 documents `C:\Users\Lucas\Documents\Codex\2026-10-02\tu\outputs\`
(PROMPT_HERMES_KANBAN.txt, ROADMAP_AirportTycoon_Qwen.md, KANBAN_AirportTycoon_Hermes.md,
AUDIT_AirportTycoon.md, AUDIT_GAMEPLAY_AirportTycoon.md), vérifiée au checkout courant.
Carte kanban : t_131dafd9. Date : 2026-10-02. HEAD : `130144a`.

## 1. Mission et invariants

Mission : transformer le jeu existant (local, hors ligne, Canvas 2D, modules ES, sim pure
testable Node) en gestion fiable, compréhensible et intéressante pendant une première
session de 20-30 min. Chaîne cœur : recevoir une opportunité → comprendre sa charge →
choisir un engagement → observer un goulot → investir ou limiter le trafic → vérifier
le résultat. Trois paliers : lancer l'aéroport / résoudre une saturation / agrandir pour
tenir un engagement.

Invariants durs (à ne JAMAIS casser) :
- État métier sérialisable ; caches dérivés (sim._graph) reconstruits.
- Sim sans DOM, timers réels ni réseau.
- Commandes métier = règles ; l'UI n'envoie que des intentions.
- Pas d'IA/cloud pour jouer ; pas de nouvelle dépendance sans besoin concret.
- Ne PAS gonfler le budget initial pour masquer un défaut (déjà corrigé : START_FUNDS 12 000).
- Ne PAS retirer d'assertions pour faire passer les tests.
- Les rapports/captures d'anciens commits ne valident pas les changements courants.
- Un check navigateur impossible = « non vérifié », jamais PASS.
- Un seul worker codeur modifie le checkout à la fois (checkout partagé).
- Aucune publication, push ni déploiement. Extensions facultatives seulement après G7.

## 2. Référence vérifiée (R01 au checkout courant)

- HEAD `130144a` ; suite `node --test tests/*.test.mjs` = **110/110 PASS** (ré-exécutée aujourd'hui).
- 22 fichiers non suivis (probes qa/_*, evidence/) : protéger, ne pas commiter en force.
- Workstream BL-17..BL-24 terminé et commité : D1 (7c84ff4), D2 (48abf79),
  services au sol (c27468a), équilibrage sans capital artificiel (3f19d88),
  commande de tests + rapports (f5badde), confirmation racine (130144a).
- La QA navigateur de l'audit original (cible CDP Edge absente) est depuis remplacée :
  la preuve CDP 5 min existe (bl-17, 10/10) — la validation UI n'est plus un point aveugle.

## 3. État des 7 défauts d'audit sur le checkout courant

Statut vérifié dans le code (chemins:lignes) ; « ouvert » = à faire, « clos » = prouvé.

| Réf | Défaut | Statut | Preuve checkout |
|---|---|---|---|
| R03 | Chemins invalidés par mods d'infra | **Clos (à confirmer par les 4 scénarios d'audit : ajout/suppression segment éloigné, suppression segment du trajet, reprise mid-taxi)** | path.mjs : rebuildGraph à chaque buildGrid ; sim._graphDirty avant rebuild (infra.mjs:142-150) ; cache absent au 1er tick traité (infra.mjs:150) |
| R04 | Réservation des ressources implicite | **Partiel** | Portes exclusives via ac.gateId (aircraft.mjs:150-229) ; pistes implicites par phase ; les libérations au pushback / changement de route / démolition non auditées → formaliser le cycle acquisition/conservation/libération |
| R05 | 1re piste compatible toujours choisie | **OUVERT** | aircraft.mjs:416-421 `runwayFor` = piste compatible la plus courte, AUCUNE vérification d'occupation ; les 2 appels (73, 92) ne regardent pas la disponibilité |
| R06 | Case auto-accept ≠ préférence du state | **OUVERT (moitié)** | main.mjs:64-74 touche A = `state.planningAuto` + `planningPanel.setAuto` (deux voies sync) ; MAIS planning-panel.mjs:35-36 le change de case met SEUL `panel.auto` (le flag local du panneau) sans state ni autosave → case ON ne persiste pas, le comportement simulé ne suit que si tickAuto lit panel.auto. Réconcilier les deux sources |
| R07 | Inspection figée au changement d'identité | **Clos** | panels.mjs: makeSection refresh par signature (44-57) ; pick live, objet disparu affiché comme « parti/démoli » (84, 97) ; invalider pick au load/nouvelle partie reste à vérifier |
| R08 | Lance conservée après panne | **OUVERT** | aircraft.mjs:270-293 : branch `!lances \|\| fuelOut(sim)` (panne station) met `_dryDeparture` et passe à disembark SANS réinitialiser `ac._refueling` ; l'avion reste compté par `busy = filter(a => a._refueling)` (284) → lance occupée artificiellement |
| R09 | rngSeed ignoré | **Partiel** | rng.mjs : PRNG mulberry32 déterministe, état seed+compteur SÉRIALISÉ (save.mjs EV-10) ; MAIS sim-state.mjs:59 `rngSeed: 0` par défaut et JAMAIS régénéré à la création d'une partie (grep seed dans new-game.mjs : aucun) → parties entre elles encore identiques ; l'audit « seeds différentes » reste à faire |
| R10 | Validation incomplète des sauvegardes | **Partiel** | save.mjs : validateSim complet (types, id, phases, réf piste/porte, seed entier 32 bits) + rejet lisible + version de schéma stricte (`v? ≠ v2` rejet) ; MAIS politique des anciennes sauvegardes implicite (rejet dur, pas de migration explicite ni cas documentés) |
| R11 | Dépenses obligatoires conditionnées aux fonds | **OUVERT** | economy.mjs:20-24 `charge` retourne false si fonds insuffisants, le coût n'est PAS payé ; appel sans traitement (onGateDeparted:57, indemnité:65) → le scénario « annulation avec 100 $ → indemnité réellement débitée en déficit » échoue : le débit en déficit est absent (l'agrégat dettes/intérêts n'est que pour money < 0) |
| R12 | Intérêts absents du résultat net | **Clos (à nuancer)** | economy.mjs:91-93 intérêts 1 %/s (base capée BL-18) débités du solde ; periodStatement (104-131) : net = recettes − opex − carburant − invest − indemnités, intérêts signalés en cause ; le champ historique `debt` cumule les intérêts — ne pas le réinterpréter comme principal |
| R13 | Déploiement double-compté + plafond | **Clos (commit 115eb69)** | flights.mjs : `deployDue` vérifie le plafond sur `pendingCount` SEUL (l'avion poussé est déjà compté → plus de double comptage, 4 dus 4 places → 4, 2 places → 2, 0 acceptation → 0) ; déploiement des vols dus à CHAQUE tick (un vol accepté en retard ne patiente pas 1 min si capacité libre) ; reste de l'accumulateur conservé (fenêtres multiples sans duplication) ; offre jamais décidée expirée après 10 min (refus + alerte `flight-offer-expired`, place libérée) ; `MAX_PENDING` exporté (référence unique A-5). Preuve : tests/r13-deployment.test.mjs (5 tests) + suite 158/158 |

Ouvertures restantes de J1 : **R05, R08, R11** (+ R06 moitié, R09 moitié, R10 moitié).
Non couvert par l'audit : R14 (erreurs de promesses non observées, historique borné,
erreurs → pause explicite) — considéré ouvert à vérifier (grep des rejets/queues avant
de clôturer J1).

## 4. Les 43 cartes R01-R43 (résumé par jalon)

Dépendances : tableau complet dans KANBAN_AirportTycoon_Hermes.md (« Vue des dépendances »).
Chaque carte conserve : objectif, périmètre/fichiers, prérequis, travail, validation,
lignes à livrer (fichiers, preuve, commit éventuel, limitation restante).

- **J0 Référence** : R01 référence checkout (statut : à refaire à chaque reprise — cette
  note est la référence `130144a`), R02 outil de mesure de parties (seed/durée/pas/
  politique, export JSON + résumé lisible ; état : harnais mvp-gate/bl-17 existants =
  partiel, formaliser). **G0** : « référence reproductible + mesures rejouables ; seeds
  inefficaces tant que R09 ».
- **J1 Fiabilité** : R03 chemins (4 scénarios d'audit), R04 cycle de réservation
  explicite (pushback/annulation/changement de route/suppression autorisée ; blocage
  permanent → règle bornée, pas d'annulation abusive), R05 multi-pistes/portes (critères
  centralisés, ordre stable en égalités, sonde gain 2e piste), R06 auto-accept + reset
  unifiés, R07 inspection vivante (plusieurs phases sans reselection ; objet disparu ≠
  actif), R08 lances libérées sur TOUTE sortie de ravitaillement (panne, disparition
  service, annulation, fin normale, sauvegarde mid-plein), R09 PRNG + reprise (même
  seed/mêmes commandes → même suite ; seeds distinctes → suites distinctes ; reprise
  mid-suite → prochains tirages identiques ; fixtures de migration), R10 schéma explicite
  + migration (rejet lisible, reconstruction des dérivés, réservations des deux côtés ;
  politiques : ancien état minimal de menu, partie sans sim, cas non migrables
  documentés), R11 achats facultatifs vs coûts obligatoires (indemnité/carburant/opex
  comptés même en déficit ; pas de double facturation), R12 réconciliation
  solde/résultat/financement (rapprochement sur recette+construction+démolition+
  carburant+annulation+intérêts), R13 déploiement/échéances/plafond (4 dus 4 places → 4
  ; 2 places → 2 ; 0 acceptation → 0 ; vol en retard ne pas attendre 1 min si capacité
  libre ; pas de duplication par pas/arrondis), R14 erreurs/arrêts/événements (erreurs
  forcées → état explicite ; historique borné ; compteurs métier ≠ journal UI ;
  chargement/neuf ne rejouent pas des toasts).
  **G1** : « régressions corrigées avec preuves avant/après + partie intégrée :
  constructions/démolitions, 2 pistes, panne carburant, reprise ; limites UI consignées ».
- **J2 Compréhension** : R15 échelle de temps/unités lisibles (coût affiché/min = débit
  constaté sur 60 s ; pause ne débite rien ; x4 cohérent), R16 périodes financières +
  prévision simple (prévision indéterminée sans historique, jamais un faux chiffre),
  R17 retards/goulots par cause (attente piste/porte/segment/carburant/passagers ; un
  avion arrêté ne cumule pas 2x le même retard ; ponctualité à dénominateur clair
  incluant les annulations), R18 overlay réseau/capacités (taxiway coupé → rupture
  identifiable ; diagnostic = même graphe et mêmes règles que la sim), R19 planning
  outil de décision (offre impossible explique l'obstacle ; décision non doublée ;
  accepter/refuser par filtre), R20 premier cycle guidé (stockage vide, sans README ni
  touches ; tutoriel non récompensant d'actions invalides, progression reprise après
  sauvegarde). **G2** : « premier cycle observé au navigateur : commandes accessibles,
  unités correctes, inspection vivante, goulot compréhensible, planning utilisable ».
- **J3 Progression** : R21 spécifier les 3 paliers (docs/gameplay.md + config ; chaque
  palier = décision vérifiable, pas un compteur ; 1er palier possible sur le réseau
  initial), R22 objectifs/récompenses (payés UNE fois y compris après reprise ; compteur
  temporaire règle documentée ; refus optionnel ≠ blocage), R23 déblocages espacés
  (remplacer les seuils 100-300 pax ; carburant avant le besoin, nettoyage/maintenance
  quand l'usure compte, bagages quand le volume justifie ; pas de dépendance circulaire),
  R24 contrats courts (3 modèles ; cycle proposé→accepté→actif→réussi/échoué/annulé ;
  pénalités plafonnées comptées même en déficit ; règlements idempotents ; refus
  optionnel gratuit), R25 présentation contrats (délai/vols/capacités/revenus/pire
  pénalité ; progression et risque après départ et sauvegarde exacte), R26 offres liées
  à progression/qualité (contrat de croissance → vols proposés réels ; réputation faible
  = voie de reprise ; borne + inertie ; MAX_PENDING = 4 devient paramètre, pas plafond
  caché). **G3** : « offre de croissance + décision + goulot + investissement +
  bénéfice mesuré ; contrats et récompenses persistants sans double règlement ».
- **J4 Exploitation** : R27 services affectés aux terminaux (affectation déterministe
  modifiable ; clients desservis/capacité/coût ; migration expliquée ; pas de bonus
  implicite par simple existence de bâtiment), R28 carburant ressource locale (stations
  id/lances/file ; propriétaire du plein ; temps de service/déplacement simple ; panne A
  laisse B si joignable ; pas de propriétaire fantôme après reprise), R29 charge +
  priorité des équipes (nettoyage/maintenance débit limité ; priorité ou répartition
  équitable ; 2e équipe améliore le délai ; pas de porte affamée indéfiniment), R30
  parcours passagers isolés par terminal (files/capacités par terminal ; groupes liés
  aux vols ; retrait des pax d'un vol annulé ; comptage unique ; reprise mid-check-in/
  sécurité/embarquement ; découpage conseillé : modèle+migration → flux → branchement
  avion → UI), R31 améliorations de capacité ciblées (≤3 choix ; coût fixe + résultat
  attendu ; le mauvais achat reste compréhensible ; reprise restitue niveau+coût).
  **G4** : « 2 terminaux + services locaux cohérents ; capacités partagées vérifiées ;
  comparaison de plans = effet spatial explicable ».
- **J5 Risque** : R32 incidents attachés aux actifs (id/type/actif/durée/gravité/cause
  lisible ; fermeture = une piste, panne = une station ; début de partie exposé
  contrôlé), R33 deux réponses opérationnelles par incident (passive vs coûteuse/
  allègement ; conséquences affichées avant décision ; action non répétable ; 3e
  option seulement si arbitrage réel), R34 satisfaction/réputation liées aux résultats
  observés (pic absorbé → faible pénalité ; pic mal géré → effet mesurable ;
  récupération progressive ; pas de cumul contradictoire dans 2 modules), R35 déficit
  récupérable + faillite explicite (remplacer 1 %/s par taux paramétré sur période ;
  alerte trésorerie ; redressement borné : emprunt conditionné ou vente/réduction ;
  principal ≠ intérêts ≠ liquidités ; écran de faillite bilan/reprise/nouvelle partie).
  **G5** : « incident géré de 2 façons avec conséquences distinctes ; déficit
  récupérable dans un scénario annoncé ; sauvegarde et faillite cohérentes ».
- **J6 Équilibrage** : R36 matrice de scénarios reproductibles (≥10 seeds effectives,
  politiques prudent/expansion/acceptation excessive/refus temporaire/investissements
  inadaptés ; pas 0,1 s et 0,4 s avec tolérances documentées ; commandes publiques),
  R37 ajuster la 1re session + compromis (journal des modifications + raisons ; ≥2
  stratégies viables ; cibles : 1er cycle en quelques minutes, 1er besoin de capacité
  après découverte, choix significatifs sur 20-30 min, services avancés non tous
  débloqués à 2 min x4), R38 3 scénarios rejouables (démarrage guidé, défi saturation,
  défi redressement ; mêmes règles, config explicite, objectif annoncé ; ≥2 solutions au
  défi saturation si possible). **G6** : « matrice seeds réellement différentes,
  stratégies viables, rythme observé, défis rejouables ; paramètres sensibles et
  échecs expliqués (une partie solvable à 48 h ne démontre pas un jeu intéressant) ».
- **J7 Livraison** : R39 retour visuel utile (tailles/orientations/état portes et
  équipements/sélection ; retour achat/intervention/objectif réussi ; alertes groupées
  ; blocage ≠ couleur seule), R40 flux complets navigateur (stockage vide, nouvelle
  partie, 1re offre, auto-accept, construction, 2 pistes, contrat, incident, pause/
  vitesse, sauvegarde/fermeture/reprise, faillite, retour menu ; console/erreurs/rejets
  ; rapport par scénario + captures AU commit testé), R41 migrations entre
  fonctionnalités (fixtures initiales + intermédiaires ; cas combinés : contrat actif,
  incident, plein occupé, file terminal, upgrade, dette, objectif partiel ; migration
  appliquée une fois), R42 endurance/perf/cohérence (partie prolongée multi-seeds Node +
  session navigateur chargée ; coût tick, mémoire, fluidité ; journaux bornés ;
  sauvegardes encore utilisables ; optimiser uniquement les points mesurés), R43
  livraison avec preuves et limites (README + règles + contrôles + unités + limites ;
  anciens rapports archivés datés ; note de version ; défauts restants listés
  honnêtement ; si validation essentielle impossible → version candidate, pas livraison
  validée). **G7** : « tests complets + QA navigateur + migrations + endurance + docs
  validés au commit final ; 1re session observée ; toute limite essentielle empêche de
  fermer G7 comme réussite complète ».

## 5. Doublons potentiels identifiés

- **Avec le backlog existant (BL-17..24 déjà commités)** : D1 = R03/R04 partiellement
  couvert (conflit atterrissage/décollage corrigé 7c84ff4) ; D2 = R30 précurseur
  (embarquement après parcours, 48abf79) ; services au sol = R27/R28/R29 précurseurs
  (nettoyage+bagages+2 usures, c27468a) ; équilibrage = R37 précurseur (START_FUNDS
  12 000, 3f19d88). À référencer dans les cartes, PAS refaire.
- **R02 ↔ harnais QA existants** (qa/mvp-gate.mjs, bl17-sim48h.mjs, bl17-cdp.mjs,
  cdp-boot.mjs) : l'outil de mesure existe partiellement → R02 = formaliser
  (paramètres seed/durée/pas/politique + export JSON/summary lisible), pas réinventer.
- **R40 ↔ CDP 10/10 bl-17** : la QA navigateur existe déjà (Edge + Node CDP) → R40
  étend aux 13 flux de la liste ci-dessus.
- **R12 ↔ cap BL-18 des intérêts** (economy.mjs:83-93) : la cap est déjà posée ;
  R12/R35 conservent la cap ou la remplacent par le taux paramétré de R35 (D5).
- **R13 ↔ A-5 MAX_PENDING=4** : l'ancien « plafond 4 arrivées » est déjà le paramètre
  MAX_PENDING ; R13/R26 le transforment en paramètre cohérent, pas en plafond caché.
- **R04/R05 ↔ work D1/D2** : les conflits atterrissage/décollage (D1) et embarquement
  (D2) sont des sous-cas de R04/R05/R30 → les cartes doivent les citer comme prouves
  avant/après existantes.
- **Aucune carte R/G existante dans le Kanban** (205 cartes ; inventaire :
  qa/_kanban-scan.cjs en lecture seule) : le mapping ancien/nouvel identifiant sera
  1:1 ; le seul doublon potentiel est t_c7eb57ef (game initiale, done) → les R-cards
  sont des extensions, pas de reconstruction.

## 6. Décisions à trancher (à faire par les tâches suivantes)

- **D1 — R06 source unique de la préférence auto-accept** : `state.planningAuto`
  (sérialisée) ou le flag local du panneau (actuel : case ne met que panel.auto, touche
  A met les deux) → trancher : UNE source = state, case écrit dans state (via
  setPlanningAuto), et le comportement simulé (tickAuto) lit state.
- **D2 — R08 règle de libération en panne** : quand la station tombe en panne pendant
  un plein, l'avion doit-il continuer le plein restant ou passer en dry departure et
  libérer immédiatement la lance (`_refueling = false` dans le branch panne) ? →
  trancher la règle ; l'occupation compte UNIQUEMENT les pleins réellement actifs.
- **D3 — R09 génération du seed** : seed par partie = valeur explicite (défaut 0) ou
  aléatoire à la création (frontière new-game) ; et politique des sauvegardes sans seed
  (défaut 0 silencieux ou migration explicite + fixtures). → trancher.
- **D4 — R10 politique de migration** : le validateur rejette aujourd'hui toute
  version ≠ courante ; ajouter une migration explicite (anciennes sauvegardes) ou
  conserver le rejet dur + documentation des cas non migrables (état minimal de menu,
  partie sans sim). → trancher.
- **D5 — R11/R35 comptabilité du déficit** : coûts obligatoires (indemnités/carburant/
  opex) comptés même en déficit (solde négatif) + taux d'intérêt paramétré sur période
  (remplace le 1 %/s capé) OU conserver le cap actuel + dette historique. → trancher
  (impacte les fixtures de R12/R35).
- **D6 — R14 périmètre** : « erreurs de simulation non observées liées aux promesses »
  (audit) : vérifier s'il reste des .catch/reject non gérés avant de clôturer J1 ;
  définir le format de l'historique borné (taille) et le seuil de pause explicite.
- **D7 — R17 périmètre** : « un avion arrêté ne cumule pas 2x le même retard dans
  plusieurs modules » → définir le module unique de vérité pour les retards (aujourd'hui
  ac.delayed dans aircraft.mjs) et ce que R17 ajoute (causes par goulot, fenêtre
  bornée), sans dupliquer le compteur.

## 7. Consignes d'orchestration (PROMPT + ROADMAP §3)

- Tableau natif /kanban = source de vérité ; statuts conceptuels mappés sur les colonnes
  disponibles ; carte terminée = vérifications réussies ; ROADMAP_STATUS.md = export
  facultatif miroir, jamais contradictoire.
- Chaque carte : lire le code → reproduire le défaut/scénario observable → implémenter
  → exécuter tests + sim → UI : commander depuis le navigateur → mettre à jour la carte
  (commandes, résultats, limites réelles).
- Worker : sa carte + les invariants + les preuves des prérequis (jamais toute la
  roadmap). Reprise : lire le tableau, inspecter les workers actifs avant redispatch.
- Échec G : correction liée + G ouverte jusqu'à réussite (pas de cycle : la correction
  ne dépend pas de la validation qu'elle répare).
- Format de compte rendu par tâche : Tâche / Résultat / Fichiers / Preuve /
  Compatibilité / Limitation / Suite (ROADMAP §3).
- Tests : régression pour règles métier/ressources/migrations/transitions ; pas de
  tests qui vérifient uniquement le DOM ou qui recopient la formule ; changement
  purement graphique = vérification visuelle ; nouvelle règle → comportement + migration
  définis AVANT de coder.
