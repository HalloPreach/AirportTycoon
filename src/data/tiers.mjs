// R21 : les 3 paliers de progression — CONFIGURATION (données, pas de logique).
// Mêmes conventions que catalog.mjs : un fichier de chiffres/textes, la logique
// d'implémentation vit ailleurs (R22 objectifs.mjs, R23 tickUnlocks, R24/R25
// contrats, R26 offres liées progression). La doc de référence : docs/gameplay.md.
//
// Champs par palier (les 3 premiers = EXIGENCES DE CONTENU, vérifiables ;
// durationTarget = SIMPLE CIBLE DE DURÉE, contrôlée à R37, pas un critère ici) :
//   opportunity : ce qui ouvre le palier (content)
//   decision    : la décision vérifiable du joueur — une ACTION choisie, jamais
//                 « attendre un compteur » ; c'est le critère de R21
//   bottleneck  : le goulot attendu (mesurable dans la sim)
//   invest      : les investissements POSSIBLES (liste de choix, pas un ordre
//                 unique : un choix « rien » est toujours disponible)
//   success     : la condition de succès, mesurable dans l'état sim (R22 la suivra)
//   failure     : l'échec RÉCUPÉRABLE (chemin de sortie explicite, pas de verrou)
//
// ponytail : tableaux littéraux, pas de schéma de config — le jeu a 3 paliers,
// le test (tests/r21-tiers.test.mjs) valide la forme.

export const TIERS = Object.freeze([
  {
    id: 1,
    name: 'Lancer l’aéroport',
    entry: 'réseau initial (piste + taxiway + terminal 2 portes M fournis) — aucune construction requise',
    opportunity: 'les premières offres de vols medium (servables dès t=0, visibles ~60 s avant l’arrivée)',
    decision: 'accepter une offre (décision joueur, pas un compteur) ET choisir : construire la station carburant AVANT que le besoin se fasse sentir, ou assumer les départs secs (billets moitiés)',
    bottleneck: 'file d’arrivées au plafond MAX_PENDING=4 + départs secs (billets −50 %) tant qu’il n’y a pas de station carburant',
    invest: [
      { what: 'station carburant (1 200 $)', before: 'le premier cycle complet — le carburant se débloque avant que l’activité ne le rende nécessaire' },
      { what: 'rien : départs secs acceptés', before: '—', optional: true },
    ],
    success: 'un cycle de vol complet avec plein (pas de _dryDeparture au départ) ET une période financière net ≥ 0 (sim.economy.periods)',
    failure: 'départ sec (billets moitiés mais le vol part quand même) ; offre refusée (gratuite, elle ne vient tout simplement pas) ; vol bloqué annulé après 10 min (indemnité 500 $, le planning rouvre) — tout est récupérable',
    durationTarget: 'premier cycle en quelques minutes de jeu (≤ 5 min) — cible d’équilibrage R37, pas une exigence de R21',
  },
  {
    id: 2,
    name: 'Résoudre une saturation',
    entry: 'la demande monte (pic de demande : cadence doublée, ou croissance des offres à R26)',
    opportunity: 'un pic de demande (2 vols par fenêtre) qui remplit la file d’arrivées',
    decision: 'choisir AVANT la file : construire la 2e piste (et la reliure taxiway), ou absorber les retards — le gain de la 2e piste est mesurable (critère compatibilité centralisé, pas la 1re piste seulement)',
    bottleneck: 'une piste seule : alternance atterrissage/décollage → holding, retards (ac.delayed dépasse NOMINAL_TURNOVER_S = vol non ponctuel)',
    invest: [
      { what: '2e piste (2 500 $) + taxiway de reliure (400 $)', before: 'le pic de demande' },
      { what: 'rien : absorber les retards (les vols attendent en holding, les retards sont lisibles)', before: '—', optional: true },
      { what: 'équipe nettoyage / hangar maintenance (900/1 500 $)', before: 'l’usure des portes commence à compter (R23 : les services se débloquent quand le besoin existe)' },
    ],
    success: 'le pic absorbé : ponctualité restaurée (retards ≤ NOMINAL_TURNOVER_S) ET une période net ≥ 0 après le pic',
    failure: 'vol bloqué 10 min annulé (indemnité 500 $) + baisse de satisfaction — la satisfaction remonte progressivement (pas de verrou permanent) ; le joueur peut repasser en petite activité',
    durationTarget: 'le premier besoin de capacité se fait sentir juste après la découverte, sans que le joueur sache déjà quoi acheter — cible d’équilibrage R37',
  },
  {
    id: 3,
    name: 'Agrandir pour tenir un engagement',
    entry: 'un contrat de croissance (R24 : 3 modèles — faible volume, volume régulier, qualité exigeante) ouvre la demande',
    opportunity: 'un contrat de croissance (volume/qualité exigeante) avec échéance annoncée',
    decision: 'tenir l’engagement : choisir le modèle de contrat ET construire la capacité requise (piste assez longue pour L, portes, services qualité) AVANT l’échéance — ou refuser gratuitement et rester sur la petite activité',
    bottleneck: 'longueur de piste (les gros avions exigent ≥ 800) et qualité (usure des portes → retards d’embarquement ; la satisfaction multiplie les recettes)',
    invest: [
      { what: 'piste longue (2 500 $) + portes', before: 'l’échéance du contrat' },
      { what: 'salle bagages (900 $)', before: 'les volumes justifient son débit (R23)' },
      { what: 'rien : refuser le contrat (gratuit, optionnel — R24)', before: '—', optional: true },
    ],
    success: 'contrat tenu (volume + ponctualité d’ici l’échéance, R24) ET une période net positive en incluant le contrat',
    failure: 'contrat manqué : pénalité plafonnée (R24, comptée même en déficit — D5) — et le refus d’un contrat reste gratuit : la petite activité continue, aucune spirale punitive',
    durationTarget: 'choix significatifs sur une session de 20-30 min (contrat visible avant son échéance, temps de construire) — cible d’équilibrage R37',
  },
]);

// Exigences de contenu vs cibles de durée (distinction imposée par la carte R21) :
// chaque palier porte les deux, séparément — les durées sont des cibles
// d’équilibrage (R37), JAMAIS des critères de validation de palier.
export const CONTENT_VS_DURATION = Object.freeze({
  content: 'opportunity / decision / bottleneck / invest / success / failure — exigence de contenu : une décision vérifiable, mesurable dans l’état sim',
  duration: 'durationTarget — simple cible de durée (R37) : jamais un compteur à atteindre pour valider un palier',
});
