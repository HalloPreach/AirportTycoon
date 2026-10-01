# Airport Tycoon

Jeu de gestion d'aéroport 2D — local, hors ligne, Canvas 2D vanilla, **0 dépendance npm**.

## Lancer

```bash
node serve.mjs        # http://127.0.0.1:8123
```

## Contrôles (M1)

- **N** nouvelle partie (au menu) · **P** / **Échap** pause · **Q** quitter (retour menu) · **F** vitesse x1/x2/x4
- Glisser (clic gauche) pour panser · molette pour zoomer (centré sur la souris) · flèches pour panser

## Vérifier

```bash
node --test tests/game.test.mjs   # logique pure : machine à états, horloge, caméra
node qa/cdp-boot.mjs              # QA sans GUI : page bootée sous Edge headless, 30 frames, pause, menu
```

## Structure

- `src/core/` — logique pure (état, horloge, évènements), testable Node, sans DOM
- `src/ui/` — rendu, caméra, entrées : UI fine, lit l'état, ne décide rien
- `serve.mjs` — mini serveur statique Node (aucune API, aucune sortie réseau au runtime)
- `tests/` — `node:test` · `qa/` — QA CDP headless

Voir `DESIGN.md` (contrat d'architecture) et `PROJECT_BRIEF.md` (résumé).
