# Airport Tycoon

Jeu de gestion d'aéroport 2D — local, hors ligne, Canvas 2D vanilla, **0 dépendance npm**.

## Lancer

```bash
node serve.mjs        # http://127.0.0.1:8123
```

## Contrôles

- **N** nouvelle partie (au menu) · **P** / **Échap** pause · **Q** quitter (retour menu, auto-sauvegarde) · **F** vitesse x1/x2/x4
- **B** mode construction · **X** mode démolition · **1-5** type de bâtiment (piste, taxiway, terminal, carburant, hangar) · **Échap** annule l'outil
- **S** sauvegarder · **L** recharger la sauvegarde (en jeu) · **R** reprendre la dernière sauvegarde (au menu)
- Glisser (clic gauche) pour panser · molette pour zoomer (centré sur la souris) · flèches pour panser

## Progression

Les services se débloquent au fil des passagers transportés : station carburant à
100 pax, hangar de maintenance à 300 pax (alertes lisibles en jeu). Les bases
(piste, taxiway, terminal) sont toujours constructibles.

## Vérifier

```bash
npm run test          # logique pure : machine à états, horloge, caméra, construction, sauvegarde, sim
npm run qa            # QA sans GUI : page bootée sous Edge headless (CDP) — 30 frames, pause, menu,
                      # puis boucle jouable (construire, vols complets, passagers, fonds, sauvegarde)
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

- **Graphique** : sprites vectoriels simples (silhouettes + rectangles) — à remplacer
  par de vrais assets graphiques sans toucher la sim.
- **Services construits** : station carburant et hangar coûtent de l'exploitation
  (opex) et soutiennent la satisfaction, mais n'ont pas encore d'effet gameplay
  distinct (ex. carburant plus rapide, maintenance qui réduit les pannes).
- **Multi-terminaux** : les portes d'un terminal sont alignées sur un bord ;
  plusieurs terminaux et un routage porte-par-porte raffiné restent à faire.
- **Équilibrage** : chiffres bruts dans `src/data/catalog.mjs`, sans simulation
  d'équilibrage automatique ; à ajuster en jouant.
