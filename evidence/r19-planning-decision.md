# R19 — Planning : outil de décision (t_f69dd9c9, commit 5b431da)

## Tâche
Faire du planning un outil de décision : afficher horaire, taille, pax, statut,
compatibilité, charge attendue et revenu estimé avec hypothèses ; séparer
offres à décider / opérations en cours ; accepter/refuser tous les éléments
d'un filtre utile, sans contourner les validations métier.

## Résultat
- **Règle sim (exportée)** : `planNote(sim, e)` dans `src/flights/flights.mjs`
  (pure lecture, l'UI la rend seulement) :
  - compatibilité = le MÊME critère unique `attributeFlight` (piste assez
    longue + porte de la bonne taille, infra.mjs) ; offre impossible →
    `obstacles` = la cause lisible (piste trop courte / porte absente /
    réseau coupé) — « une offre impossible explique son obstacle » ;
  - risque ≠ obstacle : `risks` (file d'arrivées saturée ≥ MAX_PENDING ;
    station carburant absente/panne → départ sec billets moitiés) — le risque
    est induit SANS promesse de rentabilité ;
  - revenu estimé (hypothèse, préfixe « estimé » à l'UI) : pax × PAX_REVENUE
    (ou moitiés PAX_REVENUE_DRY sans station) + LANDING_FEE + GATE_FEE
    − pax × FUEL_COST_PER_PAX — montants SORTIS d'economy.mjs (source unique,
    maintenant exportés), jamais copiés dans l'UI ; satisfaction (earn) reste
    un multiplicateur non inclus = hypothèse assumée ;
  - type inconnu → obstacle lisible, pas de crash.
- **UI** (`src/ui/planning-panel.mjs`) : sections « À décider (N) » (planned,
  boutons Accepter/Refuser + note) et « En cours (N) » (accepted + opérations
  en vol : statut + porte + cause de retard). Filtres `tous / piste / porte /
  carburant` + boutons « Accepter/Refuser le lot » : le lot = les entrées
  `planned` du filtre, décidées UNE PAR UNE via `decideFlight` (porte unique,
  validations métier intactes — aucun contournement). Décision non doublée :
  un vol « accepted » n'a plus de boutons (état non planned) ; le lot
  ré-appliqué sur du déjà décidé = zéro effet. DOM stable : re-rendu seulement
  si la signature (id:status + causes + notes planned) change ; la signature
  intègre les notes planned → l'obstacle/risque s'affiche dès qu'il apparaît.
- **CSS** (index.html) : classes `.planning-sec`, `.planning-note`,
  `.planning-filters`, `.planning-filter(.on)` (pattern existant du panneau).

## Fichiers
- src/flights/flights.mjs — import fuelOut + constantes economy ; `planNote`
- src/economy/economy.mjs — export PAX_REVENUE / PAX_REVENUE_DRY /
  LANDING_FEE / GATE_FEE / FUEL_COST_PER_PAX (constantes, pas de mutation)
- src/ui/planning-panel.mjs — panneau réécrit (sections + filtres + lot)
- index.html — 4 classes CSS R19
- tests/r19-planning-decision.test.mjs — 5 tests (Nouveau)

## Preuve
- `node --test tests/r19-planning-decision.test.mjs` → 5/5 PASS :
  servable (revenu 2450 $ = 100×25+200+100−100×0.5, seats 160) ; impossible
  (piste trop courte / pas de porte M, motif explicite) ; risquée (file 4/4,
  pas de station → « départ sec » + revenu plus bas, panne incident → risque)
  ; type inconnu (obstacle lisible, revenue 0).
- Suite complète : `npm run test` → 201/201 PASS (196 préexistants + 5 R19).
- Zéro DOM dans la règle : tests Node purs (le panneau garde son stub DOM
  existant, tests/planning-panel.test.mjs inchangé et vert).

## Compatibilité
- Pas de dépendance ajoutée ; pas d'état sérialisé nouveau (le filtre est
  local à l'UI ; planNote est pure) ; decideFlight = porte unique inchangée ;
  les montants exportés de economy.mjs ne changent aucun comportement
  (onGateArrived/onGateDeparted utilisent désormais les constantes).

## Limitation
- Le « revenu estimé » est une hypothèse (pas la satisfaction, pas le retard
  futur) — affiché comme tel (préfixe « estimé ») ; une offre risquée ne
  promet jamais une rentabilité certaine. Vérification navigateur (CDP) du
  panneau : non vérifiée ici (pas de navigateur dans ce run) — la règle et
  l'UI sont vérifiées tests DOM-stub + suite ; le check navigateur reste à
  faire au prochain cycle CDP (G2 « planning utilisable »).

## Suite
- G2 : exercer le premier cycle au navigateur (offre impossible → obstacle
  expliqué, décision non doublée) ; R20 : l'intro peut montrer le planning
  comme outil de décision.
