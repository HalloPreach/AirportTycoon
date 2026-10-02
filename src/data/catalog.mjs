// Données de contenu : coûts, avions, compagnies, déblocages.
// Un seul fichier de chiffres : c'est l'équilibrage, pas de la logique.
// ponytail : tableaux simples pas une base ; le jeu a 5 bâtiments et 3 tailles d'avion.

export const BUILDINGS = Object.freeze({
  runway:   { name: 'Piste',   cost: 2500, w: 100, h: 1000, sellRefund: 0.5 },
  taxiway:  { name: 'Taxiway', cost: 400,  w: 200, h: 40,  sellRefund: 0.5 },
  terminal: { name: 'Terminal', cost: 3000, w: 200, h: 150, sellRefund: 0.5 },
  fuel:     { name: 'Station carburant', cost: 1200, w: 120, h: 80, sellRefund: 0.5 },
  hangar:   { name: 'Hangar maintenance', cost: 1500, w: 160, h: 120, sellRefund: 0.5 },
  catering: { name: 'Salle de restauration', cost: 1000, w: 100, h: 80, sellRefund: 0.5 },
  cleaning: { name: 'Équipe nettoyage', cost: 900, w: 100, h: 80, sellRefund: 0.5 },
  baggage:  { name: 'Salle bagages', cost: 900, w: 100, h: 80, sellRefund: 0.5 },
});

// Exploitation (A12 : l'argent diminue MÊME sans vol) + services construits.
// R15 : l'unité interne unique est la SECONDE DE JEU — OPEX_PER_SEC donne le
// débit en $ par seconde de JEU (source de vérité, pas de 2e unité). Un tick
// avance de `dt` secondes de jeu et débite OPEX_PER_SEC[type] * dt ; à vitesse
// x4 la sim consomme 4× de s de jeu par seconde réelle, donc 4× de débit.
// Le socle (piste + taxiway + terminal) fait 3,2 $/s ≈ 11 520 $/h
// (≈ 276 k$/jour, ≈ 553 k$/48 h — cf. la note « ~550 k$/48 h » de sim-state).
export const OPEX_PER_SEC = Object.freeze({
  runway: 1.2,     // piste : 72 $/min, 4 320 $/h
  taxiway: 0.2,    // 12 $/min, 720 $/h
  terminal: 1.8,   // 108 $/min, 6 480 $/h
  fuel: 4,         // 240 $/min, 14 400 $/h
  hangar: 2,       // 120 $/min, 7 200 $/h
  maintenance: 1.5,
  catering: 2.5,   // 150 $/min, 9 000 $/h
  cleaning: 2,     // 120 $/min, 7 200 $/h
  baggage: 2,      // 120 $/min, 7 200 $/h
});
// R15 : unités LISIBLES dérivées d'OPEX_PER_SEC (pas d'état parallèle) — le
// « coût affiché par minute » d'un bâtiment = opexPerMin(type) = le débit
// effectivement constaté sur 60 s de jeu (la sim débite opexPerMin sur 60 s).
// Les sondes (qa/probe-scenario.mjs) importent ces accès pour comparer
// affiché vs débit constaté. perMin = /s × 60, perH = /s × 3600.
export const opexPerMin = (type) => (OPEX_PER_SEC[type] ?? 0) * 60;
export const opexPerHour = (type) => (OPEX_PER_SEC[type] ?? 0) * 3600;

// Catégories d'avions : ce qui contraint l'infra (piste assez longue, porte de la bonne taille).
export const AIRCRAFT = Object.freeze({
  small:  { name: 'Cessna 208',   seats: 9,  minRunway: 300, gate: 'S', approach: 280, taxi: 50, revenuePerPax: 45,  refuel: 40 },
  medium: { name: 'Airbus A320',  seats: 160, minRunway: 500, gate: 'M', approach: 320, taxi: 40, revenuePerPax: 90,  refuel: 110 },
  large:  { name: 'Boeing 747',   seats: 350, minRunway: 800, gate: 'L', approach: 360, taxi: 30, revenuePerPax: 150, refuel: 320 },
});

// BL-05 (A8, décision) : les portes L EXISTENT — chaque terminal en construit
// une (ci-dessous). Les gros avions (L, minRunway 800) servent les terminaux
// sur les pistes fournies (1000, A-2) : aucun vol L bloqué indéfiniment.
// On ne limite pas le catalogue des vols L : la compatibilité reste réalisable.
export const TERMINAL_GATE_SIZES = Object.freeze(['S', 'M', 'M', 'L']);

// Compagnies : une couleur + la taille d'avion qu'elles opèrent (les contraintes viennent de la catégorie).
export const AIRLINES = Object.freeze([
  { id: 'solaire', name: 'Solaire Air', color: '#f0a', types: ['small'] },
  { id: 'atlantique', name: 'Atlantique', color: '#1e88e5', types: ['medium'] },
  { id: 'pacific', name: 'PacificCargo', color: '#43a047', types: ['large'] },
]);

// Progression : à partir de quel total de passagers transportés un service se débloque.
// BL-12 : catering (200 pax) — le confort de salle devient CONSTRUCTIBLE :
// la branche « comfortCatering » de tickPassengers cesse d'être morte.
export const UNLOCKS = Object.freeze([
  { at: 0,   service: 'base',  name: 'Aéroport de base' },
  { at: 100, service: 'fuel',  name: 'Station carburant' },
  { at: 200, service: 'catering', name: 'Salle de restauration' },
  { at: 200, service: 'cleaning', name: 'Équipe nettoyage' },
  { at: 250, service: 'baggage', name: 'Salle bagages' },
  { at: 300, service: 'hangar', name: 'Hangar maintenance' },
]);

// Décomposition du cycle avion (ordre d'exécution, l'état est la donnée).
// AC18 (A9) : « docking » = amarrage physique du nœud de porte au centre de la
// porte (taxi → docking → gate).
// BL-12 : « refuel » entre gate et disembark (remise à niveau, si station).
export const PHASES = Object.freeze([
  'approach', 'holding', 'landing', 'exit', 'taxi', 'docking', 'gate', 'refuel', 'disembark', 'ground', 'board', 'pushback', 'departure',
]);

// BL-12 : temps de remplissage d'un avion de cette taille = spec.refuel * REFUEL_TIME_S
// (le catalogue donne le niveau de carburant : 40/110/320) — un gros plein (747)
// prend plus qu'un petit (Cessna).
export const REFUEL_TIME_S = 0.5;
// BL-12 : usure d'une porte occupée (par seconde de jeu) ; le hangar remet à zéro.
export const GATE_WEAR_PER_SEC = 0.5;
// t_2179387d : DEUX usures distinctes, deux services distincts.
//  - g.cleaning  (usure « sale ») croît, l'équipe NETTOYAGE la remet à 0.
//  - g.maintenance (usure « mécanique ») croît pendant le plein, le HANGAR la remet à 0.
// Les deux retardent l'embarquement (GATE_WEAR_DELAY_S par point) → deux services
// qui coûtent ET qui servent (critère de fin, non deux bâtiments décoratifs).
export const GATE_MAINT_PER_SEC = 0.3;
// BL-12 : délai d'opérations au sol (phase ground) par point d'usure de la porte
// (une porte sale → embarquement retardé ; le hangar nettoie).
export const GATE_WEAR_DELAY_S = 0.1;
// BL-12 : vitesse de nettoyage des portes par le hangar (maintenance) — par seconde.
export const HANGAR_CLEAN_PER_SEC = 1;
// t_2179387d : vitesse de nettoyage de l'usure « sale » (g.cleaning) par
// bâtiment « cleaning » — par seconde. Distinct du hangar (g.maintenance).
export const CLEANING_RATE_PER_SEC = 1;
