# Airport Tycoon — continuation autonome

## Mission

Poursuis le projet existant dans `C:\Users\Lucas\Documents\AirportTycoon` jusqu'à obtenir le jeu de gestion d'aéroport local et cohérent décrit ci-dessous.

Lis d'abord `AUDIT_2026-10-01.md`, `PROJECT_BRIEF.md`, `DESIGN.md`, `README.md`, le code et les tests pertinents. Le code audité part de la révision `80a90ab`. Vérifie l'état réel du dépôt et les changements survenus depuis ; ne prends ni les anciens statuts « done », ni la documentation, ni les résultats de l'audit pour une preuve de l'état actuel.

**Exécute le travail. Ne réponds pas seulement par un plan ou des recommandations.** Fais évoluer l'existant ; préserve les parties utiles et les éventuelles modifications utilisateur. Pas de réécriture intégrale ou de changement de stack sans problème concret qui les justifie.

## Continuité et fin de travail

Au lancement, relève la révision du dépôt. La fin du travail dépend des critères d'acceptation et des preuves obtenues.

- Continue de carte en carte après chaque résultat ; terminer un milestone ou obtenir des tests verts n'est pas terminer le projet.
- Avant de conclure, confirme tous les critères par une validation indépendante et un parcours joueur complet.
- Si une interruption survient, sécurise le changement en cours et conserve un point de reprise précis. Si des exigences restent incomplètes, indique **projet incomplet** ; ne ferme pas artificiellement les cartes restantes.
- Respecte les budgets et limites de l'environnement. Une limite d'itérations ou un crash ne vaut pas réussite : conserve le diagnostic, réduis le périmètre de la tâche et utilise les mécanismes natifs de reprise disponibles. Ne boucle pas à l'identique sur le même échec.
- Arrête-toi pour une demande utilisateur, un blocage réel qui empêche de progresser, une limite de ressources ou l'achèvement prouvé. Pendant un blocage partiel, avance sur les tâches indépendantes utiles.

## Organisation native Hermes

Construis toi-même le backlog Kanban de continuation à partir des dépendances techniques et des écarts constatés. Ne reproduis pas les cinq anciennes cartes gigantesques. Ne transforme pas non plus chaque ligne du brief en une carte. Aucun nombre de cartes, commits ou appels d'outils n'est imposé.

Chaque carte doit avoir une responsabilité bornée, des dépendances, un résultat vérifiable et une preuve d'acceptation. Une carte « implémenter toute la simulation », « construire toute l'UI » ou « terminer tout le jeu » doit être décomposée avant exécution. Si une tâche dépasse raisonnablement un run de worker, divise-la ; ne transmets pas cet objectif entier à un seul child.

Garde le contexte principal pour la décomposition, les décisions, la coordination, les suivis et la synthèse. Exécute l'implémentation substantielle, les explorations longues et les validations répétées dans des subagents natifs `delegate_task` à contexte frais. Donne à chacun une tâche limitée, les fichiers utiles, les contraintes et les critères de sortie. Utilise les skills officiels adaptés lorsqu'ils apportent une méthode utile. Les étapes critiques doivent être vérifiées par un reviewer indépendant du subagent qui les a implémentées, via les capacités natives disponibles.

Respecte la concurrence déjà configurée. Des tâches indépendantes peuvent avancer en parallèle si elles n'écrivent pas les mêmes fichiers ; séquence les travaux dépendants. N'augmente ni le nombre de workers ni la concurrence NInfer pour cette continuation. Ne crée aucun profil permanent, routeur, harness, daemon ou framework agentique ; ne modifie ni Chat Qwen, ni SOUL, ni les configs Hermes, ni le modèle local/runtime/provider.

Conserve un simple `PROGRESS.md` de projet : état du backlog, preuves obtenues, décision actuelle, problème ouvert et prochaine tâche bornée. Mets-le à jour après les milestones et avant une interruption ou un changement de contexte important. Ce document est un point de reprise, pas un nouveau système agentique.

## Produit attendu et contraintes

Le jeu doit fonctionner entièrement localement et hors ligne. Aucun LLM, API IA, serveur externe, CDN, cloud ou compte ne doit être requis **par le jeu**. Le serveur statique local existant sur `127.0.0.1` est autorisé. Garde la structure modulaire ; chaque abstraction doit résoudre un problème concret. Ne privilégie pas une refonte esthétique aux mécanismes manquants.

Le joueur commence avec un petit terrain, une piste et un terminal minimal utilisables. Il construit ensuite pistes, taxiways, portes, terminaux et services, accueille des vols, transporte des passagers, gère des contraintes et développe une exploitation rentable. L'agrandissement par de nouvelles infrastructures suffit ; un système d'achat de terrain n'est pas imposé.

Les catégories d'avions et les compagnies doivent avoir un effet cohérent sur leurs besoins et leur traitement. Le fret et les correspondances ne sont pas obligatoires. La simulation de passagers agrégés est acceptée ; un simple total transporté ne l'est pas.

## Première priorité : fiabiliser les fondations

Reproduis les problèmes utiles de l'audit avant de les corriger. Ajoute des tests de régression métier qui échouent pour la bonne raison sur le défaut, puis vérifie la correction. Ne conserve pas une assertion trompeuse pour garder la suite verte.

Exigences incontournables :

1. **Connectivité physique.** Aucun chemin taxi n'emprunte le terrain vide ni un bâtiment. Une porte distante n'est pas reliée automatiquement. Le joueur peut construire un vrai réseau, avec les jonctions et orientations nécessaires. Une coupure réelle bloque les routes concernées. Les portes ont une destination et un accès explicites.
2. **Réservations exclusives.** Attribution atomique et libération sûre des pistes, portes et zones/segments réellement incompatibles. Deux demandes dans le même tick ne peuvent prendre la même ressource exclusive. Atterrissage et décollage ne partagent pas simultanément la même piste. Les attentes restent équitables et explicables ; traite les blocages persistants sans croissance infinie d'avions impossibles à servir.
3. **Changements d'infrastructure sûrs.** Construire, couper ou démolir pendant l'exploitation ne laisse aucun index de route périmé ni référence orpheline. Refuse proprement une démolition dangereuse ou gère explicitement sa réaffectation. Vérifie toutes les portes d'un terminal, pas seulement la première. Recalcule les routes quand c'est raisonnable ; si aucun chemin n'existe, explique le blocage sans crash.
4. **Compatibilité réalisable.** Chaque catégorie proposée au joueur peut être servie avec les infrastructures accessibles au bon stade. Permets des portes et pistes adaptées ou limite explicitement les vols/contrats acceptés. Aucun gros avion ne doit arriver indéfiniment sans porte constructible et sans issue opérationnelle.
5. **Déplacement continu.** Pas de changement instantané de position à l'alignement, au quai ou au pushback. Les avions se déplacent sur les surfaces prévues, arrivent effectivement à leur porte et reprennent depuis leur position réelle. Orientation et phase doivent être lisibles.

## Achever les mécaniques principales

### Vols et exploitation

Implémente une boucle cohérente : approche → attente si nécessaire → autorisation → atterrissage → sortie de piste → taxi → porte → débarquement → services → embarquement → pushback → taxi → attente si nécessaire → autorisation de décoller → décollage → départ.

Les vols doivent avoir un planning consultable : compagnie, appareil, passagers, horaires prévus/réels, état, retard et cause. Une modalité simple de sélection/acceptation ou d'organisation des vols doit donner au joueur une décision d'exploitation. L'attribution de ressources considère la compatibilité, la disponibilité et l'accessibilité, y compris les alternatives disponibles. Ne remplace pas le planning par un simple générateur aléatoire invisible.

Des incidents opérationnels limités mais réels doivent perturber l'exploitation et permettre une réaction cohérente, avec conséquences et récupération. Ne développe pas une collection de pannes avant d'avoir rendu fiables les règles de base.

### Services au sol

Carburant, nettoyage, bagages et maintenance doivent être des ressources opérationnelles : disponibilité, capacité/temps de traitement, coût et effet sur le vol. L'absence, la saturation ou une panne d'un service nécessaire doit causer une attente expliquée ou une issue gérée. Un bâtiment qui coûte seulement de l'argent sans servir à rien n'est pas une mécanique terminée.

Relie les besoins à la taille de l'avion et à son état. Le départ ne peut pas ignorer les travaux nécessaires. Permets au joueur de construire/renforcer les services et de comprendre leur charge. Les déblocages doivent permettre une progression jouable ; ne verrouille pas un service indispensable au premier vol derrière des passagers impossibles à transporter.

### Passagers

Modélise, même par groupes : capacité du terminal, arrivée/check-in, sécurité, attente, débarquement, embarquement et bagages. Les capacités et temps d'attente doivent influer sur les vols et la satisfaction. Associe les groupes à un vol et à un terminal ; évite de compter deux fois les passagers transportés. Montre les files ou leur occupation de façon compréhensible.

La saturation doit avoir un effet mesurable. Après résolution d'un problème, la satisfaction doit pouvoir évoluer de manière justifiée ; un retard ancien ne doit pas condamner indéfiniment toute l'exploitation.

### Économie et progression

Sépare recettes, dépenses, investissements et remboursements. Fais payer l'exploitation réelle des infrastructures et services ; comptabilise le carburant comme dépense. Le joueur doit comprendre les revenus/coûts par période et les causes du déficit.

Prouve qu'un aéroport correctement équipé peut être rentable et qu'un aéroport surdimensionné, sous-équipé ou trop chargé peut perdre de l'argent. Les retards, incidents, satisfaction et capacités doivent avoir des conséquences cohérentes. Ne rends pas rentable toute configuration simplement parce que des vols spawnent.

L'amélioration du réseau, des portes, des terminaux et des services doit augmenter la capacité ou réduire une contrainte visible. Des déblocages utiles doivent soutenir plusieurs étapes de développement.

### Interface réellement pilotable

Conserve caméra, zoom, construction, démolition, pause et vitesse. Complète la sélection/inspection d'un avion et d'un bâtiment, le planning/liste de vols, un bilan financier, les statistiques utiles et un historique d'alertes avec causes/action possible. Les capacités et ressources occupées doivent être visibles. Le joueur doit pouvoir diagnostiquer un réseau coupé et un service saturé depuis l'interface.

Valide que cliquer/glisser pour la caméra ne construit pas involontairement, que les raccourcis ne gênent pas les formulaires et que les panneaux ne rendent pas le jeu inutilisable. Une esthétique simple est acceptable si les informations et déplacements sont lisibles.

### Persistance

Sauvegarde manuelle et automatique raisonnable, puis reprise après fermeture et réouverture de la page sur la même origine locale. Sérialiser ne doit pas modifier la partie en cours. Valide réellement le schéma, les types, nombres, identifiants et références ; reconstruis les caches dérivés.

La sauvegarde contient les avions en déplacement, les réservations, les vols, les files passagers, les travaux de services, les finances, déblocages et incidents nécessaires à une reprise cohérente. Si un générateur aléatoire reproductible est utilisé, conserve son état pour les scénarios déterministes. Préserve une sauvegarde invalidée pour diagnostic/récupération ; annonce les incompatibilités clairement, sans charger un état qui plante au tick suivant.

## Validation à produire, pas seulement à annoncer

Pour chaque fonction importante : inspecter → implémenter → exécuter → observer → tester → corriger → revalider. Ajoute une carte distincte lorsqu'un bug ou une dépendance révèle un travail réellement séparé. Ne termine pas une carte sur la seule lecture du code.

La suite doit notamment couvrir :

- réseau physiquement connecté et réseau déconnecté ; coupe en cours de taxi ; routes alternatives ; suppression occupée ; références réaffectées ;
- demandes simultanées de piste/porte/segment ; séquence arrivée-départ ; occupations exclusives et libération après incident ;
- plusieurs **identifiants distincts** arrivés et partis, avec conservation des comptes, sans compter plusieurs ticks d'un même état final ;
- catégories compatibles/incompatibles, absence de piste ou porte, attente et issue gérée ;
- capacité terminal, files et embarquement, saturation des services, manque de carburant, maintenance, retards et récupération ;
- coût d'exploitation même sans vol, construction/démolition, revenus, déficit/faillite et scénario rentable ;
- sauvegarde/reprise à plusieurs phases actives, dont taxi et service occupé ; fichiers malformés, types invalides, références absentes et versions incompatibles ;
- pause, vitesses et stabilité des résultats pour des pas de temps appropriés ; comportement prolongé sans accumulation inexpliquée ni blocage permanent.

Utilise des scénarios déterministes pour diagnostiquer et reproduire. Vérifie des invariants après chaque tick dans les tests concernés. Les tests doivent échouer si la simulation manque, plutôt que réussir silencieusement. La capture et les compteurs internes complètent la preuve ; ils ne remplacent pas l'interaction joueur.

Après chaque milestone important, lance réellement le jeu. Pour la validation finale, fais au moins un parcours passant par les entrées utilisateur réelles — clics, touches, commandes de l'interface — sans construire l'aéroport en injectant uniquement l'état via `window.__game`.

Observe visuellement le résultat, collecte les erreurs de console et vérifie l'absence de requêtes vers des services externes pendant le fonctionnement du jeu. Ne modifie pas le pare-feu ou la configuration réseau de la machine pour ce test.

Prévois également un scénario prolongé automatisé représentant plusieurs journées de jeu ou une charge équivalente, avec mesures de débit de vols, attentes, blocages, finances et population d'objets. Complète-le par une session de rendu réel assez longue pour observer la stabilité et une reprise après réouverture. Indique séparément les durées simulées et réelles ; ne présente jamais une boucle accélérée en mémoire comme des heures de jeu observées à l'écran.

## Conditions de clôture

Le parcours complet doit permettre :

1. Démarrer une nouvelle partie avec un petit aéroport utilisable.
2. Construire et connecter des infrastructures supplémentaires.
3. Organiser/recevoir des vols compatibles.
4. Voir les avions approcher, atterrir, rejoindre réellement une porte puis repartir.
5. Gérer plusieurs vols et les conflits de ressources sans double réservation.
6. Produire des retards explicables avec une mauvaise conception, puis les réduire par une amélioration.
7. Transporter des passagers avec capacités/files/services significatifs.
8. Voir revenus et dépenses, rendre l'exploitation rentable ou subir un déficit.
9. Agrandir et débloquer des améliorations utiles.
10. Sauvegarder pendant une activité réelle.
11. Quitter et fermer la page.
12. Réouvrir et recharger la sauvegarde.
13. Continuer sans perdre les vols, réservations, files, services et finances.

**Ne conclus pas que le projet est terminé parce que l'ancien ensemble de 36 tests et 17 contrôles passe.** Les exigences ci-dessus sont obligatoires, les extensions non demandées sont secondaires. N'inscris pas les passagers, services, conflits ou interfaces manquants dans « améliorations futures » pour justifier une clôture.

## Rapport final ou rapport d'interruption

Fournis : interruptions éventuelles, révisions de départ/fin, architecture finale, backlog créé/révisé et nombre réel de cartes terminées, fonctionnalités validées, bugs reproduits et corrigés, commandes de test et résultats, scénarios visuels/exécutés avec chemins des preuves, bilan du scénario prolongé et de la sauvegarde/reprise, limites connues et exigences encore incomplètes.

Précise également ce qui a été réellement délégué, comment les tâches ont été bornées, les revues indépendantes effectuées et les éventuels échecs/budgets de workers rencontrés. Utilise les logs disponibles ; ne fabrique ni nombre d'agents, ni preuve.

Si tu n'as pas fini, laisse le projet dans un état exécutable ou documente le blocage exact, conserve le travail, mets à jour `PROGRESS.md` et donne la prochaine carte bornée à reprendre. Un bilan honnête d'avancement vaut mieux qu'un « complet » non démontré.
