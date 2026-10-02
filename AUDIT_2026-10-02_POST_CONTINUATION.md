# Airport Tycoon — vérification après la continuation autonome

Révision inspectée : `f3799dbcb9ba1d7a265d7e0e18ad901fd3313ff6`.
Projet : `C:\Users\Lucas\Documents\AirportTycoon`.

## Verdict

La persistance agentique a fonctionné : le Kanban a poursuivi le travail, exécuté des cartes distinctes et des revues, puis ajouté du rework lorsque la première clôture omettait les panneaux de gestion. La tâche racine a été créée à 00:04 et clôturée à 07:58 le 2 octobre, soit environ 7 h 54 pour l'ensemble du workflow. Il y a 38 commits depuis la révision initialement auditée `80a90ab`.

Le code a réellement progressé : aéroport initial, connectivité, réservations, démolition, planning pilotable, groupes/files passagers, ravitaillement, incidents, finances, sauvegarde et panneaux de gestion. Ce n'est pas uniquement une production de documents.

**La déclaration de conformité complète reste prématurée.** Deux défauts métier importants subsistent malgré les suites vertes ; les services au sol ne couvrent pas entièrement la demande et l'équilibrage mérite une validation de gameplay.

## Vérifications exécutées par cet audit

| Vérification | Résultat |
|---|---|
| Suite complète `node --test tests/*.test.mjs` | 105 tests réussis, 0 échec, 0 ignoré |
| Scénario `qa/bl17-sim48h.mjs` | 8/8 ; deux passes reproductibles de 48 heures simulées |
| QA `qa/gestion-panel.mjs` avec Edge headless et entrées clavier/souris réelles | 15/15 ; 28 requêtes locales, aucune exception de page ni `console.error` |
| Scénarios supplémentaires D1 et D2 | Deux problèmes reproduits |

Pour les deux QA, des copies ont changé uniquement les chemins des imports/répertoire de travail et des preuves. Le code du jeu et les assertions de la QA sont conservés. Les sorties d'audit sont séparées des preuves de l'agent dans :
`C:\Users\Lucas\Documents\Codex\2026-09-14\je-veux-changer-mon-mod-le\audit-airport\post-run`.

Le scénario de 48 heures est une simulation accélérée en mémoire, pas 48 heures de jeu observées. La session de rendu de cinq minutes est documentée dans les preuves de l'agent ; elle n'a pas été relancée dans cet audit. La QA des panneaux a terminé ses 15 contrôles mais son processus Node restait actif après le résultat PASS ; ce processus temporaire a été arrêté par l'audit après sauvegarde des preuves.

## D1 — un avion peut décoller pendant un atterrissage sur la même piste

Source : `src/sim/aircraft.mjs:172`, particulièrement `:187`.

La protection de l'arrivée considère désormais les départs, mais le passage inverse du taxi sortant vers le décollage n'effectue pas une réservation/autorisation équivalente.

Reproduction contrôlée avec les vrais modules et le réseau de la nouvelle partie :

- Avion 1 déjà en `landing` sur la piste 1.
- Avion 2 en taxi sortant vers cette piste, depuis le dernier nœud de taxiway.
- Après 43 ticks de 0,1 seconde : avion 1 toujours en `landing`, position `(800, 859)` ; avion 2 en `departure`, position `(800, 1100)` ; tous deux utilisent la piste 1.

Ce sont des états de précondition injectés pour isoler l'arbitrage, pas une démonstration menée depuis l'interface. Le défaut est néanmoins dans la vraie fonction `tickAircraft` : la seconde demande de piste n'est pas empêchée.

Correction attendue : une même règle d'autorisation exclusive pour arrivées et départs, puis un test d'invariant qui couvre aussi l'avion sortant lorsqu'un atterrissage est déjà engagé.

## D2 — embarquement comptabilisé avant la fin du parcours passager

Sources : `src/sim/passengers.mjs:65`, `:122`, `:131` ; `src/sim/aircraft.mjs:297`, `:323`.

Les files sont globales, tandis que les groupes sont retirés et leurs effectifs intégralement ajoutés au total transporté à la fin d'une temporisation avion. Le système ne vérifie pas que les passagers de ce vol ont effectivement terminé check-in, sécurité et embarquement.

Scénario contrôlé : quatre gros vols de 350 passagers, chacun à une porte L distincte d'un terminal construit, lancés au début de leur traitement au sol. Après 60,3 secondes :

- `totalCarried = 1400` et les quatre avions passent en `pushback` ;
- aucun groupe passager ne reste associé à ces vols ;
- la file de check-in contient encore environ **676 passagers** et la file d'embarquement environ **121**.

Les mêmes personnes sont donc créditées transportées alors que leur parcours n'est pas terminé. Les files affichées ne sont pas une preuve suffisante de conservation/cohérence des passagers.

Correction attendue : suivre l'avancement par groupe/vol, conserver les effectifs à chaque étape et n'autoriser le comptage/embarquement que pour les passagers réellement prêts. Tester la conservation de la population lors de saturation, annulation et reprise.

## Autres écarts constatés

1. **Services au sol incomplets.** Le carburant possède une durée et des lances partagées. En revanche, sans station ou pendant une panne, l'avion passe immédiatement au débarquement et est autorisé à repartir avec une simple pénalité sur les billets (`_dryDeparture`). Le nettoyage est un décrément global de l'usure des portes par les hangars. Les bagages sont assimilés au check-in ; le code conserve explicitement l'ajout d'un service bagages comme travail futur. Cela ne constitue pas encore quatre services opérationnels distincts — carburant, nettoyage, bagages, maintenance — avec les contraintes demandées.

> **Résolu (carte `t_2179387d`, 2026-10-02, post-audit).** Quatre services au sol opérationnels distincts, chacun coûte (OPEX) et sert (effet mesuré) : **carburant** (lances partagées, durées par taille — BL-12, inchangé), **nettoyage** (nouveau bâtiment `cleaning`, ramène l'usure « sale » `g.cleaning` à zéro), **bagages** (nouveau bâtiment `baggage`, booste le débit check-in — AC22), **maintenance** (hangar, ramène l'usure « mécanique » `g.maintenance` à zéro). Les deux usures de porte sont distinctes (`cleanGates` `src/infra/infra.mjs`), les seuils de déblocage 200/250 pax (`src/data/catalog.mjs`) et le retard d'opérations au sol est proportionnel à l'usure totale. Tests dédiés `tests/services.test.mjs` (a)/(b)/(c) : sans service l'usure sale est stable, hangar ≠ nettoyage (chacun touche sa seule usure), bagages = file check-in qui se vide plus vite. Suite `node --test tests/*.test.mjs` = **110/110**, scénario 48 h `qa/bl17-sim48h.mjs` = **8/8 PASS** (money=19340.61, carried=36608, seed 42 — l'écart avec le run précédent, 19641.74, vient des 4 $/s d'OPEX des deux nouveaux services + retours sol légèrement plus longs : écart économique légitime, aucun capital injecté). Le départ SÉC sans station est un mécanisme EXPLIQUÉ (événement `no-fuel` + billets moitiés), pas un contournement : le service carburant reste la seule source de plein.
2. **Équilibrage adapté au scénario de test.** Le capital initial est passé de 12 000 à **345 000**, soit ×28,75. Le commentaire de `src/core/sim-state.mjs:7` explique que cette somme a été choisie pour survivre au scénario de 48 heures. Le scénario relancé termine à 19 641,74, soit une baisse de 325 358,26 par rapport au capital initial. Il prouve la stabilité et la survie financière de ce scénario, pas la rentabilité ni une progression équilibrée. Il faut valider une amélioration rentable réellement réalisable par le joueur.
3. **Commande de test incomplète.** Le script `npm test` liste dix des quatorze fichiers. Il omet `incidents.test.mjs` (3 tests), `panels.test.mjs` (10), `persistence-valid.test.mjs` (10), `services.test.mjs` (3) : **26 tests exclus**. Le glob canonique exécuté par l'audit couvre bien les 105 tests.
4. **Documents de clôture périmés.** `RAPPORT_FINAL.md` et `VALIDATION_CLOTURE.md` parlent encore de 95 tests, de panneaux absents et d'une revue en cours ; les panneaux existent maintenant et la suite compte 105 tests. Le point de reprise et la synthèse de clôture sont plus récents, mais le rapport final devrait décrire le livrable final.
5. **Interface et hygiène du dépôt.** La capture fraîche montre une superposition du panneau planning et du HUD en haut à gauche. Plusieurs scripts de diagnostic, logs et dossiers temporaires de QA restent non suivis. Aucun nettoyage n'a été effectué par cet audit.

## Bilan sur l'autonomie

Le gate `t_0171b245` a réellement rejeté une clôture à laquelle manquait l'UI, créé les cartes de rework et maintenu la racine ouverte. C'est un signe concret de persistance et de vérification indépendante.

La limite observée porte surtout sur la qualité de validation : les tests couvrent beaucoup de cas ciblés, mais les variantes de concurrence et la conservation des passagers restent insuffisantes. Des tests verts et un long run ne certifient pas à eux seuls la cohérence du gameplay.

Priorité de continuation : D1 et D2, puis services au sol et équilibrage, avec leurs nouveaux tests de régression. Pas de refonte ou de changement de stack nécessaire sur la base de cette vérification.

Scripts des reproductions : `additional-probes.mjs` et `additional-probes-resultats.json` dans le dossier d'audit ci-dessus. Commande :

```powershell
node additional-probes.mjs
```

Aucun code du jeu, profil Hermes, paramètre NInfer ou statut Kanban n'a été modifié par cet audit. Seul ce rapport est ajouté au projet ; les vérifications et preuves nouvelles restent dans le dossier d'audit séparé.
