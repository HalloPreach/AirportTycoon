# Gameplay — les 3 paliers de progression (R21)

R21 livre la **spécification** des 3 paliers : pour chacun, l'opportunité, la
décision attendue, le goulot, l'investissement possible, le succès et l'échec
récupérable. La configuration vivante (données, pas de logique) :
`src/data/tiers.mjs`. L'implémentation des objectifs/récompenses viendra à R22
(`src/progression/objectives.mjs`) ; R21 ne branche rien dans la sim.

## Rappels d'ordre

- **Décision, pas compteur.** Chaque palier se valide par une décision vérifiable
  du joueur (une action choisie, mesurable dans l'état sim), jamais par « atteindre
  X passagers » : les seuils pax sont des déblocages de *contenu* (R23 les
  espacera), pas des objectifs de palier.
- **Le premier palier est jouable sur le réseau initial** (piste + taxiway +
  terminal 2 portes M fournis — `new-game.mjs`) : aucune construction obligatoire.
- **Pas d'ordre unique de bâtiments.** Chaque palier propose une *liste* d'options
  d'investissement ; « rien » est toujours un choix valable (les offres refusées
  restent gratuites — R24). La configuration ne force jamais une seule séquence.
- **Exigences de contenu vs cibles de durée.** Chaque palier porte les deux,
  séparément (voir `CONTENT_VS_DURATION` dans tiers.mjs) : les durées
  (« premier cycle en quelques minutes », « choix significatifs sur 20-30 min »)
  sont des cibles d'équilibrage de **R37**, pas des critères de palier.
- **Les chiffres cités viennent de la sim** : plafonds, coûts, montants — pas de
  seconde source de vérité.

## Palier 1 — Lancer l'aéroport

- **Ouverture (content).** Réseau initial : piste + taxiway + terminal minimal
  (2 portes M). Les offres de vols **medium** sont servables dès t=0 (une porte M
  + une piste ≥ 500 existent) ; elles sont visibles ~60 s avant l'arrivée
  (planning consultable, BL-07).
- **Décision (vérifiable).** Accepter une première offre ET choisir sa politique
  carburant : **construire la station (1 200 $) avant que le besoin se fasse
  sentir** — ou assumer les départs secs (billets moitiés, `PAX_REVENUE_DRY`).
  L'état qui prouve la décision : un vol complet avec plein
  (`ac._dryDeparture` absent au départ).
- **Goulot.** File d'arrivées au plafond `MAX_PENDING = 4` (A-5 : au-delà, plus
  d'arrivées — c'est le premier goulot du jeu, pas un bug) + départs secs tant
  qu'aucune station.
- **Investissement possible.** Station carburant (1 200 $, se débloque à
  100 pax — le déverrouille *avant* que l'activité ne le rende indispensable,
  critère R23) ; ou rien (départs secs acceptés — choix économique, pas une
  impasse).
- **Succès (mesurable).** Cycle de vol complet avec plein **ET** au moins une
  période financière close `net ≥ 0` (`sim.economy.periods`, R16).
- **Échec récupérable.** Départ sec (billets −50 %, le vol part quand même) ;
  offre refusée (gratuite, ne vient plus) ; vol bloqué annulé après 10 min
  (indemnité 500 $, comptée même en déficit — D5, le planning rouvre).

## Palier 2 — Résoudre une saturation

- **Ouverture (content).** La demande monte : pic de demande (cadence doublée,
  BL-14) et/ou croissance des offres (R26).
- **Décision (vérifiable).** Devant la file d'arrivées qui se remplit :
  **construire la 2e piste** (+ taxiway de reliure), ou décider d'absorber les
  retards. Le gain de la 2e piste est *mesurable* — le critère de compatibilité
  est centralisé (`runwayFor`, R05) : ce n'est pas la 1re piste qui limite les
  types d'avions.
- **Goulot.** Piste unique : alternance atterrissage/décollage → holding,
  retards (`ac.delayed` unique source de vérité, D7) ; vol non ponctuel quand
  le retard dépasse `NOMINAL_TURNOVER_S` (2 min 30 s de rotation nominale).
- **Investissement possible.** 2e piste (2 500 $) + taxiway (400 $) ; services
  qualité (nettoyage 900 $ / hangar 1 500 $) *quand l'usure des portes commence
  à compter* (R23 : débloquer au bon moment, condition affichée à l'avance) ;
  ou rien (absorber — les retards restent lisibles).
- **Succès (mesurable).** Pic absorbé : ponctualité restaurée (retards ≤
  `NOMINAL_TURNOVER_S`) ET une période `net ≥ 0` après le pic.
- **Échec récupérable.** Annulation du vol bloqué (indemnité) + baisse de
  satisfaction qui **remonte progressivement** (pas de verrou) ; le joueur peut
  rester sur une petite activité (pas de spirale punitive — R26).

## Palier 3 — Agrandir pour tenir un engagement

- **Ouverture (content).** Un **contrat de croissance** (R24 : 3 modèles —
  faible volume, volume régulier, qualité exigeante) ouvre une demande
  augmentée annoncée.
- **Décision (vérifiable).** Tendre un engagement : choisir le modèle de
  contrat ET construire la capacité requise (piste ≥ 800 pour les gros avions,
  portes, services qualité) **avant l'échéance** — ou refuser (gratuit, R24)
  et rester sur la petite activité.
- **Goulot.** Longueur de piste (les gros avions exigent ≥ 800 — les terminaux
  du socle ont déjà des portes L, le goulot est la piste) et qualité (usure
  des portes → retards d'embarquement ; la satisfaction multiplie les recettes).
- **Investissement possible.** Piste longue (2 500 $) + portes ; salle bagages
  (900 $) quand les volumes justifient son débit (R23) ; ou rien (refus du
  contrat — optionnel, gratuit).
- **Succès (mesurable).** Contrat tenu (volume + ponctualité d'ici l'échéance,
  R24) ET une période `net` positive en incluant le contrat (R22 : récompense
  payée une fois, identifiant persistant, y compris après reprise).
- **Échec récupérable.** Contrat manqué : **pénalité plafonnée**, comptée même
  en déficit (D5), **une seule fois** (réglage idempotent — R24). Aucune
  spirale : une pénalité échouée ne verrouille rien.

## Ce que R21 ne fait pas (frontière des cartes suivantes)

- R22 : objectifs/récompenses *implémentés* (fenêtres explicites, récompense
  atomique, identifiant persistant, compteur temporaire documenté) : livré
  (`src/progression/objectives.mjs`) — O1 « premier cycle avec plein » (1 000 $)
  + O2 « pic absorbé » (1 500 $), payés UNE fois par la sim (`tickObjectives`),
  ids persistants survivent à la sauvegarde (reprise = jamais re-payable),
  panneau « Objectifs » (ui/panels.mjs).
- R23 : espacer les déblocages autour des besoins (remplacer les seuls seuils
  100-300 pax ; carburant avant le besoin, nettoyage/maintenance quand l'usure
  compte, bagages quand les volumes le justifient ; pas de dépendance circulaire).
- R24 : contrats courts de compagnie *implémentés* (3 modèles — faible volume,
  volume régulier, qualité exigeante ; prime/pénalité plafonnées réglées UNE
  fois sur une mesure de période) : livré (`src/flights/contracts.mjs`) —
  cycle proposé → accepté → actif → réussi/échoué/annulé, pénalité comptée
  même en déficit (D5, compte dédié `contract-penalty`), refus gratuit,
  état sérialisé avec la sim (reprise = jamais re-réglable), panneau
  « Contrats de compagnie » (ui/panels.mjs).
- R25 : présentation riche du contrat (délai/vols/capacités/revenus/pire
  pénalité) + progression et risque après départ et sauvegarde exacte
  *implémentée* : livrée (panneau Contrats, ui/panels.mjs, lit `contractView`
  enrichi + `contractCapable`/`contractOnTrack` de `src/flights/contracts.mjs`) —
  l'offre affiche l'appareil + sièges + SERVABILITÉ (critère du planificateur :
  piste ≥ min + porte de la taille, motif lisible sinon) ; le contrat actif
  affiche le risque après départ (vols/pax restants, « sur la bonne voie »,
  infra non servable) + pire pénalité plafonnée payée une fois ; le verdict
  onTrack est LA règle unique du règlement (lue par le panneau, jamais
  ré-imposée) ; AUCUN champ d'état nouveau → la sauvegarde R24 reste exacte.
- R26 : offres liées progression/quality (contrat de croissance → vols proposés
  réels ; réputation faible = voie de reprise ; `MAX_PENDING` devient paramètre,
  pas plafond caché).
