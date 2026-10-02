# R14 — journal d'alertes borné + erreurs de tick lisibles (pas de crash)

Carte : t_b54b757e (run 283) — checkout partagé AirportTycoon.

## Ce qui était posé

- `sim.alerts` (src/core/sim-state.mjs : `pushEvent`) grandissait SANS LIMITE
  pendant toute la partie : la partie de 48 h génère des milliers d'alertes,
  qui gonflaient le journal, la RAM ET la sauvegarde (serialize écrit l'état
  entier à chaque auto-save, beforeunload + périodique) sans limite.
- La boucle (src/core/loop.mjs:12) appelait `simTick` (asynchrone) SANS
  `.catch` : un tick qui lève (état corrompu, bug de règle) rejetait la
  promesse et plantait en `unhandledrejection` — le jeu crashe, aucun message.

## Correction (cause racine, pas symptôme)

1. **Borne à la racine** — `pushEvent` (src/core/sim-state.mjs) borne
   `sim.alerts` à `MAX_ALERTS = 500` (splice des plus anciennes). Tous les
   30 points d'émission (30 call sites, 9 modules : flights, aircraft,
   economy, passengers, incidents, infra…) passent PAR `pushEvent` → un seul
   point de contrôle, aucun caller à modifier. Le panneau « Alertes
   (historique) » (ui/panels.mjs) affichait déjà « les 50 plus récentes +
   compteur des plus anciennes » ; les toasts n'affichent que les 4
   dernières — au-delà de 500, le détail ancien n'a plus de destinataire. Le
   consommateur main.mjs pointe par INDICE (`state._alertSeen`) et consomme à
   chaque frame : les événements jamais lus restent dans la fenêtre de 500.
2. **Erreur de tick routée, pas perdue** — `simTick(state, played).catch(
   e => bus.emit('sim-error', e))` dans loop.mjs. L'UI (src/main.mjs)
   écoute `'sim-error'` et affiche un toast lisible, THROTTLÉ : la même
   erreur persistante ne s'affiche qu'une fois / 30 s (le tick peut rejeter
   à chaque frame — sans throttle, le spam écraserait l'écran). La boucle
   (horloge + rendu) continue → le jeu ne crashe plus.
3. **Test injectable** — `src/core/sim.mjs` exporte `tickFn` : si le test
   pose `globalThis.__simTick`, la boucle l'utilise au lieu du tick réel
   (essai d'un tick qui lève sans builder de faux modules). En jeu,
   l'absence du stub = zéro surcoût (une vérité).

## Preuve

- tests/r14-history.test.mjs — 2 tests (node:test, zéro DOM) :
  - `sim.alerts` borné à 500, les plus récentes restent (520 push → 500,
    les 20 plus anciennes sortent, la plus récente en bout) ;
  - un tick qui lève est ROUTÉ sur le bus (`sim-error`, pas
    unhandledrejection) et la boucle continue (2 frames d'erreur, les deux
    interceptées, les deux frames émisses).
- `npm run test` : **174/174, 0 fail** (la baseline de la carte était 158 ;
  elle a grossi depuis — R10/R12b/R13 ont ajouté 14 tests. Le total
  réel : 174. Le commit note le total réel.)
- Les tests existants (sim, incidents, r13-deployment, invariants…) qui
  lisent `sim.alerts` passent sans modification : le bornage ne change
  rien en dessous de 500 événements.

## Ce qui n'est PAS fait (scope R14)

- Pas d'historique persistant au-delà de la sauvegarde (la sauvegarde reste
  bornée à 500 via le même mécanisme — c'est le comportement voulu : pas
  d'explosion de localStorage).
- Pas de capture console d'erreurs globales (les erreurs UI non tick
  restent du domaine du navigateur ; la sim est le point de fiabilité qui
  compte pour le jeu).
- Le toast est throttle 30 s par texte d'erreur ; l'erreur persistante
  réapparaît donc périodiquement (pas de spam, pas de silence).
