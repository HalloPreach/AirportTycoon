# Airport Tycoon

Jeu de gestion d'aéroport 2D — local, hors ligne, Canvas 2D vanilla, **0 dépendance npm**.

## Lancer

```bash
node serve.mjs        # http://127.0.0.1:8123
```

## Contrôles

- **N** nouvelle partie (au menu) · **P** / **Échap** pause · **Q** quitter (retour menu, auto-sauvegarde) · **F** vitesse x1/x2/x4
- **B** mode construction · **X** mode démolition · **1-8** type de bâtiment (piste, taxiway, terminal, carburant, hangar, restauration, nettoyage, bagages) · **Échap** annule l'outil
- **S** sauvegarder · **L** recharger la sauvegarde (en jeu) · **R** reprendre la dernière sauvegarde (au menu)
- Glisser (clic gauche) pour panser · molette pour zoomer (centré sur la souris) · flèches pour panser

## Progression

Les 3 paliers de progression (R21) : **Lancer** l'aéroport, **Résoudre une
saturation**, **Agrandir pour tenir un engagement** — configuration vivante
dans `src/data/tiers.mjs`, règles de déverrouillage dans `src/infra/unlocks.mjs`.

Les services ne se débloquent **pas** à un seuil de passagers : chacun se
débloque quand le *besoin* devient mesurable dans la sim (R23, conditions
affichées à l'avance, alertes lisibles en jeu) :
- **station carburant** — dès qu'une offre de vol est en vue (évite les
  départs secs : billets moitiés).
- **équipe nettoyage / hangar maintenance** — dès qu'une porte a usé ≥ 10.
- **salle bagages** — file check-in ≥ 90 pax *ou* 400 pax transportés.
- **salle de restauration** — 300 pax transportés.

Les bases (piste, taxiway, terminal) sont toujours constructibles.

## Vérifier

```bash
npm run test          # logique pure : machine à états, horloge, caméra, construction, sauvegarde, sim (317 tests)
npm run qa            # QA sans GUI : boot Edge headless (CDP) — 30 frames, pause, menu, boucle jouable
node qa/r40-cdp.mjs   # QA navigateur intégrée : 19 flux complets sur l'UI réelle (boutons, carte, incidents)
node qa/r42-cdp.mjs   # endurance navigateur : session prolongée + incidents + reprise sous charge (16 checks)
node qa/r42-node.mjs  # endurance Node multi-seeds (3 seeds × 24 h) : tick coût, fuite mémoire, sauvegardes, session complète
node qa/g6-integrated.mjs  # jalon G6 : matrice R36 + stratégies R37 + 3 défis R38 ensemble
```

## Structure

- `src/core/` — logique pure (état, horloge, évènements), testable Node, sans DOM
- `src/sim|flights|infra|economy|pathfinding/` — règles de jeu (pures, déterministes si rng semé)
- `src/data/` — équilibrage (coûts, avions, compagnies, seuils de débloquement)
- `src/persistence/` — sauvegarde/chargement (schéma versionné, rejet lisible des états invalides)
- `src/ui/` — rendu, caméra, entrées : UI fine, lit l'état, ne décide rien
- `serve.mjs` — mini serveur statique Node (aucune API, aucune sortie réseau au runtime)
- `tests/` — `node:test` · `qa/` — QA CDP headless · `evidence/` — captures du run QA

Voir `DESIGN.md` (contrat d'architecture) et `PROJECT_BRIEF.md` (résumé).

## Limites connues / pistes futures

- **Graphique** : sprites vectoriels simples (silhouettes + rectangles) — à
  remplacer par de vrais assets graphiques sans toucher la sim.
- **Équilibrage** : chiffres bruts dans `src/data/catalog.mjs`, ajustés à la
  main ; la validation est reproductible (matrice R36 : 12 seeds × 5 politiques,
  3 défis rejouables R38) mais il n'y a pas d'optimisation automatique.
  Finding documenté de la matrice R36 : l'« achat inadapté » (équipements
  d'équipe quand le goulot est les files) reste mesurable mais son effet est
  NEUTRE sur 24 h (l'argent dépensé ne convertit aucune file dans la fenêtre).

Vérifications et rapports de livraison : `RAPPORT_FINAL.md` (régénéré au commit
final) + `evidence/` (matrices, harnais navigateur CDP, captures datées).
