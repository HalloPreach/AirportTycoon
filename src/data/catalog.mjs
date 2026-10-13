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
  // T33 (t_88aee6d5) : 3 NOUVEAUX services au sol — la barre d'outils et le
  // clavier lisent CE TABLEAU (build-tool.mjs / main.mjs) : du contenu
  // ADDITIF ici ne demande AUCUNE ligne de code ailleurs (les 8 d'origine
  // gardent leurs touches 1-8 ; les nouveaux prennent 9+).
  // R27 : l'effet est AFFECTÉ au terminal (s.target) — une salle posée pour A
  // ne sert JAMAIS B (comme la salle bagages).
  security: { name: 'Salle de sécurité', cost: 1200, w: 100, h: 80, sellRefund: 0.5 },
  dutyfree: { name: 'Boutique libre-service', cost: 1000, w: 100, h: 80, sellRefund: 0.5 },
  lounge:   { name: 'Salon VIP', cost: 800, w: 80, h: 60, sellRefund: 0.5 },
});

// Exploitation (A12 : l'argent diminue MÊME sans vol) + services construits.
// R15 : l'unité interne unique est la SECONDE DE JEU — OPEX_PER_SEC donne le
// débit en $ par seconde de JEU (source de vérité, pas de 2e unité). Un tick
// avance de `dt` secondes de jeu et débite OPEX_PER_SEC[type] * dt ; à vitesse
// x4 la sim consomme 4× de s de jeu par seconde réelle, donc 4× de débit.
// Le socle (piste + taxiway + terminal) fait 3,2 $/s ≈ 11 520 $/h
// (≈ 276 k$/jour, ≈ 553 k$/48 h — cf. la note « ~550 k$/48 h » de sim-state).
// R27 : les services AU SOL — ceux qui se PLACENT sur le terrain et dont
// l'effet est AFFECTÉ à un terminal (mesures assignments.mjs) : le carburant
// sert les pleins des portes de son terminal, le nettoyage/hangar remette à
// zéro l'usure des portes de son terminal, bagages/cafétéria/maintenance
// servent les passagers qui ARRIVENT à son terminal.
export const GROUND_SERVICE_TYPES = Object.freeze(['fuel', 'hangar', 'cleaning', 'baggage', 'catering', 'maintenance', 'security', 'dutyfree', 'lounge']);

// R37 (t_a4c636ab) : l'OPEX des SERVICES AU SOL est recalibré.
// Avant (R36) les 5 services coûtaient ~12,5 $/s (45 000 $/h) : construire
// TOUS les services (la stratégie « expansion ») coûtait PLUS que son gain
// (billets plein tarif + capacité) → l'expansion PERDAIT face au prudent
// (120 531 pax vs 147 388, money 864 k$ vs 1 023 k$ sur 24 h). Les services
// devaient être un INVESTISSEMENT rentable (le joueur choisit d'investir),
// pas une perte garantie.
// Deux familles, deux prix :
//  - BONNES améliorations (carburant/nettoyage/bagages) : OPEX baissé — leur
//    gain (billets plein tarif + usure « sale » nulle + capacité check-in)
//    dépasse désormais leur coût → l'expansion est rentable.
//  - PIÈGE « surdimensionné » (hangar/catering au-delà du besoin) : OPEX
//    INCHANGÉ (hangar 2 + catering 2,5 = 4,5 $/s) — quand les files sont
//    vides, leur utilité est marginale mais le coût reste → un aéroport
//    SURDIMENSIONNÉ reste DÉFICITAIRE (finance-bl15 : hangar+café sans
//    station carburant, déficit mesurable). L'achat inadapté COÛTE.
// La piste/le taxiway/le terminal (le SOCLE, non-choix) restent intacts.
export const OPEX_PER_SEC = Object.freeze({
  runway: 1.2,     // piste : 72 $/min, 4 320 $/h (socle, inchangé)
  taxiway: 0.2,    // 12 $/min, 720 $/h (socle, inchangé)
  terminal: 1.8,   // 108 $/min, 6 480 $/h (socle, inchangé)
  fuel: 1.5,       // R37 : 90 $/min, 5 400 $/h (était 14 400) — le plein est la
                   //       meilleure amélioration (billets plein tarif), OPEX < gain
  hangar: 2,       // PIÈGE : inchangé (7 200 $/h) — surdimensionné = déficit
  maintenance: 1.5,// PIÈGE : inchangé
  catering: 2.5,   // PIÈGE : inchangé (9 000 $/h) — surdimensionné = déficit
  cleaning: 1,     // R37 : 60 $/min, 3 600 $/h (était 7 200) — usure « sale »
  baggage: 1,      // R37 : 60 $/min, 3 600 $/h (était 7 200) — capacité check-in
  // T33 (t_88aee6d5) : les 3 nouveaux services — famille R37 :
  //   security/dutyfree = BONNES améliorations (OPEX < gain, comme R37 a
  //   recalibré cleaning/baggage) ; lounge = famille CONFORT (comme la
  //   restauration : un PIÈGE documenté — si l'aéroport est bien tenu
  //   (satisfaction 100), sa valeur marginale est nulle : son OPEX reste
  //   supérieur à son gain, le joueur doit le COMPRENDRE, pas le subir).
  security: 1,     // 60 $/min, 3 600 $/h — +4 pax/s au contrôle sécurité
  dutyfree: 1,     // 60 $/min, 3 600 $/h — 8 $/pax/boutique : rentable dès
                   //       ~450 pax/h (0,125 pax/s) — un vol medium toutes les ~3,3 min
  lounge: 2.5,     // PIÈGE (famille confort, calibrée comme la restauration : 9 000 $/h)
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
// T33 (t_88aee6d5) : 2 NOUVELLES compagnies — l'offre de vol pioche la
// compagnie PARMELLES (flights.mjs, déterministe par seed) : du contenu
// ADDITIF, AUCUNE règle ne change (les types opérés restent ceux du vol —
// la servabilité est contrainte par la taille, pas par le nom de la marque).
// Sauvegarde : un ID inconnu (ancienne sauvegarde sans ces lignes) retombe
// sur AIRLINES[0] (airlineOf) — aucune migration nécessaire.
export const AIRLINES = Object.freeze([
  { id: 'solaire', name: 'Solaire Air', color: '#f0a', types: ['small'] },
  { id: 'atlantique', name: 'Atlantique', color: '#1e88e5', types: ['medium'] },
  { id: 'pacific', name: 'PacificCargo', color: '#43a047', types: ['large'] },
  { id: 'boreal', name: 'Boréal Régions', color: '#ff7043', types: ['small', 'medium'] },
  { id: 'horizon', name: 'Horizon Express', color: '#7e57c2', types: ['medium', 'large'] },
]);

// R23 : les déblocages des services ne sont PLUS de simples seuils de pax.
// Les CONDITIONS mesurables vivent dans src/infra/unlocks.mjs (le module de
// règle, appelé par tickUnlocks) — ce fichier ne porte que les CHIFFRES et
// les TEXTES de chaque règle (équilibrage, pas de logique) :
//   fuel      : une offre de vol en vue (le carburant se débloque AVANT que
//               l'activité ne rende le plein nécessaire — tiers 1) ;
//   cleaning  : usure « sale » d'une porte ≥ wear (10 : l'usure a commencé à
//               compter, GATE_WEAR_PER_SEC = 0,5/s → ~20 s amarré) ;
//   hangar    : usure mécanique d'une porte ≥ wear (idem, GATE_MAINT_PER_SEC) ;
//   baggage   : file check-in ≥ queue (90 = 75 % de la capacité 120 : le
//               goulou de base se voit) OU carried pax transportés (400 :
//               les volumes justifient le débit) ;
//   catering  : carried pax transportés (300 : le confort de salle est
//               justifié par les volumes — tiers 2).
// T33 (t_88aee6d5) : 3 nouvelles règles (mêmes motifs « file visible /
// volumes justifiés » — aucune référence à un service verrouillé, pas de
// dépendance circulaire) :
//   security  : file sécurité ≥ queue (96 = 80 % de la capacité 120 : le
//               goulot sécurité se voit) OU carried pax transportés (600) ;
//   dutyfree  : carried pax transportés (400 : le commerce est justifié par
//               les volumes — tiers 2) ;
//   lounge    : carried pax transportés (500 : le confort haut de gamme est
//               justifié par les volumes — tiers 2).
// Aucune condition ne fait référence à un service verrouillé (pas de
// dépendance circulaire : on ne demande pas de maintenir un service pour le
// débloquer).
export const UNLOCK_RULES = Object.freeze({
  fuel: { name: 'Station carburant',
    benefit: 'pleins de carburant au décollage (pas de départ sec : billets moitiés)',
    why: 'une offre de vol en vue — l’activité va servir des vols' },
  cleaning: { name: 'Équipe nettoyage', wear: 10,
    benefit: 'remet l’usure « sale » des portes à zéro (embarquements rapides)',
    why: 'usure d’une porte ≥ 10 (la porte s’est usée pendant les vols)' },
  hangar: { name: 'Hangar maintenance', wear: 10,
    benefit: 'remet l’usure mécanique des portes à zéro (pleins rapides)',
    why: 'usure mécanique d’une porte ≥ 10 (les pleins usent la porte)' },
  baggage: { name: 'Salle bagages', queue: 90, carried: 400,
    benefit: '+8 pax/s au check-in par salle (le goulou dépôt bagages s’ouvre)',
    why: 'file check-in ≥ 90 pax (75 % de la capacité) ou 400 pax transportés' },
  catering: { name: 'Salle de restauration', carried: 300,
    benefit: 'confort de salle : la satisfaction remonte plus vite',
    why: '300 pax transportés (les volumes justifient le confort)' },
  // T33 (t_88aee6d5) : les 3 nouvelles règles (les CHIFFRES sont ici, la
  // condition mesurable dans src/infra/unlocks.mjs — CONDS).
  security: { name: 'Salle de sécurité', queue: 96, carried: 600,
    benefit: '+4 pax/s au contrôle sécurité de la salle AFFECTÉE (le goulot sécurité s’ouvre)',
    why: 'file sécurité ≥ 96 pax (80 % de la capacité) ou 600 pax transportés' },
  dutyfree: { name: 'Boutique libre-service', carried: 400,
    benefit: '8 $ de recette boutique par pax débarqué, par boutique AFFECTÉE (compte dédié)',
    why: '400 pax transportés (les volumes justifient le commerce)' },
  lounge: { name: 'Salon VIP', carried: 500,
    benefit: 'confort : la satisfaction remonte plus vite (+0,3 %/s)',
    why: '500 pax transportés (les volumes justifient le confort haut de gamme)' },
});

// R31 (t_7a512737) : 3 CHOIX D'AMÉLIORATION DE CAPACITÉ CIBLÉE, par terminal —
// coût FIXE par niveau (pas de %), résultat ATTENDU affiché AVANT achat (le
// joueur voit ce qu'il achète) :
//   terminal : +60 % de capacité check-in/sécurité DU terminal (files plus
//              longues → occupation/satisfaction au-delà de la capacité) ;
//   fueling  : −25 % de temps de plein PAR NIVEAU (le goulot avitaillement,
//              la SATURATION des lances ne change pas — c'est le débit) ;
//   teams    : ×2 du débit de nettoyage/remise à zéro par équipe DU terminal
//              (l'usure s'accumule moins vite RELATIVEMENT : moins de délai).
// T33 (t_88aee6d5) : 3 NOUVEAUX CHOIX (mêmes principes R31 : coût fixe,
// effet ATTENDU affiché, niveau vécu dans sim.upgrades) :
//   boarding : −25 % du temps des 3 OPS AU SOL de ce terminal par niveau
//              (démêlage/sol/embarquement — la porte se libère plus vite) ;
//   marketing: +10 % de recette billets (pleines ET sèches) par niveau de
//              CE terminal (le choix REVENUE — utile quand du pax passe) ;
//   comfort  : ×1,5 de la récupération de satisfaction PAR NIVEAU — GLOBAL
//              comme la famille confort (meilleur terminal équipé : les
//              aménagements servent tout l'aéroport).
// Le « mauvais achat » reste COMPRÉHENSIBLE : l'UI montre le goulot courant
// du terminal (src/infra/upgrades.mjs, bottleneckView) — acheter « terminal »
// quand le goulot est le PLEIN est inutile, et l'écran l'explique.
// Les niveaux vivent dans l'ÉTAT (sim.upgrades, sérialisé — la reprise
// restitue niveau ET le coût déjà payé : le niveau est la source, on ne
// re-débite JAMAIS au chargement).
export const UPGRADES = Object.freeze({
  terminal: { name: 'Terminal efficace', cost: 1500, maxLevel: 3, capMultPerLevel: 0.6,
    effect: '+60 % de capacité check-in/sécurité de ce terminal (file tolérée plus longue)' },
  fueling:  { name: 'Avitaillement rapide', cost: 1200, maxLevel: 3, timeMultPerLevel: 0.25,
    effect: '−25 % du temps de plein de ce terminal par niveau (la saturation des lances ne change pas)' },
  teams:    { name: 'Équipement d\'équipe', cost: 2000, maxLevel: 3, rateMultPerLevel: 1,
    effect: '×2 du débit nettoyage/remise à zéro par équipe de ce terminal par niveau' },
  // T33 (t_88aee6d5) : 3 nouveaux choix — même contrat R31 (coût FIXE par
  // niveau, niveau vécu dans sim.upgrades, multiplieurs purs — aucun coût
  // récurrent, AUCUN état supplémentaire : le niveau est la source).
  boarding: { name: 'Embarquement rapide', cost: 1800, maxLevel: 3, timeMultPerLevel: 0.25,
    effect: '−25 % du temps des 3 opérations au sol de ce terminal par niveau (démêlage, sol, embarquement)' },
  marketing: { name: 'Campagne marketing', cost: 2000, maxLevel: 3, revenueMultPerLevel: 0.1,
    effect: '+10 % de recette billets par niveau de ce terminal (billets pleins et secs)' },
  comfort: { name: 'Confort passagers', cost: 1600, maxLevel: 3, recoverMultPerLevel: 0.5,
    effect: '×1,5 de la récupération de satisfaction (files vides) par niveau — global, comme la famille confort' },
});

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
// R28 (t_bd681587) : le SERVICE de la lance inclut un temps de DÉPLACEMENT
// simple (la station se rend au poste) fondé sur la DISTANCE porte→station,
// SANS agents véhicules individuels (la sim reste sans entités mobiles — le
// déplacement est un simple retard proportionnel à la distance). La station
// éloignée sert plus lentement que la station proche : c'est la MESURE du
// « gain d'ajouter une station » (une 2e station plus proche réduit le temps
// de service). 20 s par 1 000 px (le plein medium de base = 55 s ; la marge
// des boucles de test — 60 s (r08) / 70 s (services) — reste saine pour une
// distance porte→station réaliste ~500 px = +10 s).
export const REFUEL_TRAVEL_S_PER_1000 = 20;
// R17 (t_fc0d1920, D7 tranchée) : durée de ROTATION nominale — le temps que
// prend le cycle au sol d'un avion AMARRÉ (gate → décollage : avitaillement
// si station, débarquement, sol, embarquement, poussée) SANS aucune attente :
// l'avion qui a posé à l'heure prévue ne devrait rouvrir le slot que
// NOMINAL_TURNOVER_S plus tard. C'est la base de la ponctualité (R17) :
// un vol est PUNCTUEL si son retard cumulé (ac.delayed, unique source de
// vérité — D7) ne dépasse pas cette rotation nominale. Constante (le cycle
// au sol a une durée fixe par construction, catalog.mjs:37 GATE_OPS_S) ;
// le RETARD des vols est mesuré dans les sim (aircraft.mjs / flights.mjs).
export const NOMINAL_TURNOVER_S = 150; // 2 min 30 s : 60 s d'ops au sol + marge
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
