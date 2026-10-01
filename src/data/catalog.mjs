// Données de contenu : coûts, avions, compagnies, déblocages.
// Un seul fichier de chiffres : c'est l'équilibrage, pas de la logique.
// ponytail : tableaux simples pas une base ; le jeu a 5 bâtiments et 3 tailles d'avion.

export const BUILDINGS = Object.freeze({
  runway:   { name: 'Piste',   cost: 2500, w: 100, h: 1000, sellRefund: 0.5 },
  taxiway:  { name: 'Taxiway', cost: 400,  w: 200, h: 40,  sellRefund: 0.5 },
  terminal: { name: 'Terminal', cost: 3000, w: 200, h: 150, sellRefund: 0.5 },
  fuel:     { name: 'Station carburant', cost: 1200, w: 120, h: 80, sellRefund: 0.5 },
  hangar:   { name: 'Hangar maintenance', cost: 1500, w: 160, h: 120, sellRefund: 0.5 },
});

export const AIRPORT_OPS_PER_DAY = 400; // coût d'exploitation de l'aéroport entier, par jour de jeu

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
export const UNLOCKS = Object.freeze([
  { at: 0,   service: 'base',  name: 'Aéroport de base' },
  { at: 100, service: 'fuel',  name: 'Station carburant' },
  { at: 300, service: 'hangar', name: 'Hangar maintenance' },
]);

// Décomposition du cycle avion (ordre d'exécution, l'état est la donnée).
export const PHASES = Object.freeze([
  'approach', 'holding', 'landing', 'exit', 'taxi', 'gate', 'disembark', 'ground', 'board', 'pushback', 'departure',
]);
