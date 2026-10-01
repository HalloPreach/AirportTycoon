# Airport Tycoon — cahier des charges

## But
Créer un jeu de gestion d'aéroport 2D complet, réellement jouable hors ligne et localement. Aucun LLM, API IA, serveur, cloud ou service externe requis en jeu. Projet modulaire, sans surarchitecture; pas de fichier géant. Le jeu doit dépasser le prototype/dashboard superficiel.

## Boucle de jeu et contenu
Le joueur commence avec un petit terrain, une piste et un terminal minimal, puis développe un aéroport rentable. Carte 2D permettant caméra déplaçable, zoom, sélection, construction/démolition, inspection, vols, finances, alertes, pause et réglage de vitesse.

Inclure pistes, taxiways, terminaux, portes compatibles, bâtiments/services d'exploitation, compagnies et catégories d'avions avec contraintes, planning de vols, passagers et capacité, check-in/sécurité/attente/embarquement/débarquement/bagages, carburant, nettoyage, maintenance, satisfaction, incidents, retards, finances (revenus/coûts/construction), statistiques, progression et déblocages.

## Simulation
Les avions sont visibles et se déplacent réellement, sans téléportation. Cycle cohérent entrant: approche, attente si nécessaire, autorisation, atterrissage, sortie de piste, taxi, porte, débarquement, opérations au sol, embarquement, pushback, taxi, attente, décollage et départ. Ressources partagées provoquent des conflits et conséquences (retards, coûts, satisfaction). Attribuer pistes/portes selon compatibilité/disponibilité.

Le pathfinding emprunte le réseau taxiway; traiter absence de chemin, segments occupés, conflits et rerouting raisonnable. Passagers agrégés autorisés si leurs files, temps d'attente, capacités et satisfaction ont un effet cohérent.

## Économie et sauvegarde
Budget initial réel, coûts de construction et d'exploitation, recettes vols/passagers, possibilité de déficit/faillite et croissance rentable. Sauvegarde manuelle et automatique raisonnable, restauration d'un état de jeu cohérent après redémarrage; gérer sauvegardes invalides ou incompatibles.

## Robustesse à couvrir
Aucune piste; aucune porte compatible; taxiway coupé; avion bloqué; suppression d'un bâtiment occupé; fonds insuffisants; demandes simultanées pour la même ressource; sauvegarde pendant simulation; reprise; données invalides/incompatibles. Définir des comportements lisibles et tester automatiquement les mécaniques importantes.

## Architecture et méthode
Séparer clairement état, simulation, pathfinding, économie, avions/vols, infrastructures, interface, persistance. Choisir technologies selon le repo/environnement existants après inspection. Construire un backlog Kanban selon dépendances réelles: ne pas transformer chaque exigence en carte et ne pas fusionner tout le travail dans quelques tâches géantes. Découper en tâches bornées et dépendantes; utiliser les workers Kanban natifs, profil `default` et modèle/provider local hérités. Ne créer aucun profil/routeur/harness permanent.

Après chaque milestone jouable (construction; premier avion porte-départ; conflits multi-avions; passagers/économie; boucle sauvegardable), lancer réellement le jeu, observer et corriger avant de poursuivre. Pour chaque fonction importante: inspecter, implémenter, exécuter, tester, corriger, valider avec preuves. Si bug: diagnostiquer, corriger, relancer les validations concernées. Ajouter des cartes de bug/dépendance lorsqu'utile. Aucun service cloud/LLM ne doit être requis au runtime du jeu.

## Critères de fin (tous requis)
1. Nouvelle partie; 2. construire un petit aéroport; 3. recevoir des vols; 4. voir les avions atterrir, rouler jusqu'à une porte et repartir; 5. gérer plusieurs vols simultanément; 6. subir des retards si l'aéroport est mal conçu; 7. transporter passagers; 8. recettes et dépenses effectives; 9. agrandir l'aéroport; 10. sauvegarder; 11. quitter; 12. recharger; 13. poursuivre normalement.

Ne pas conclure au premier MVP technique. À la fin, fournir: architecture; backlog réalisé et nombre de cartes terminées; fonctionnalités; tests et preuves d'exécution; bugs/corrections; éléments incomplets; limites connues; pistes futures. Priorité: jeu cohérent et jouable, pas le nombre de fonctionnalités.
