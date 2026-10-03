// R26 (t_62ffa6bc) — relier les offres à la progression et à la qualité.
// La « réputation » de l'aéroport vis-à-vis des offres = le taux de
// PUNCTUALITÉ mesuré (fenêtre bornée R17, aircraft.mjs) — on réutilise la
// statistique existante, PAS un compteur parallèle.
// Bornes + inertie (spec R26) :
//   - la valeur effective est bornée [Q_FLOOR, 1] : la réputation FAIBLE garde
//     une voie de reprise (le planificateur offre TOUJOURS au moins les
//     petits avions — aucune spirale punitive sans issue) ;
//   - la valeur ne bouge que par PAS BORNÉ par seconde de jeu (inertie :
//     pas de changement brutal, la montée est plus lente que la descente —
//     la qualité se gagne, elle se perd vite) ;
//   - le palier (mix de tailles que le planificateur est autorisé à proposer)
//     est une fonction PURE de la valeur : jamais de 2e règle de sim.
// L'état vit sur `sim.quality` (sérialisé avec la sim → la reprise est
// reproductible, EV-10), comme sim.punctuality / sim.contracts.
import { punctualityStats, ensurePunctuality } from '../sim/aircraft.mjs';

export const Q_FLOOR = 0.3;    // borne basse : la réputation ne tombe jamais sous
export const Q_DROP_PER_S = 0.002;   // la descente est bornée (0.3 en ~2.5 min sim si tout s'effondre)
export const Q_RISE_PER_S = 0.0005;  // la montée est bornée ET plus lente (40 min sim pour regagner 0.4)

// Paliers du mix d'offres (l'index dans le catalogue = la taille :
// small → medium → large, catalog.mjs) :
//   0 : petits seulement (la voie de reprise — les Cessna se posent à l'heure)
//   1 : petits + moyens (l'activité modeste de départ)
//   2 : toutes tailles (la progression — les 747 réapparaissent dans les offres)
export const Q_TIERS = Object.freeze([
  { name: 'petits', sizes: ['small'] },
  { name: 'petits + moyens', sizes: ['small', 'medium'] },
  { name: 'toutes tailles', sizes: ['small', 'medium', 'large'] },
]);

// Initialisation paresseuse (pattern sim.punctuality / sim.contracts) :
// une sauvegarde ancienne n'a pas le champ → le 1er tick le crée.
// Départ à 1.0 : la qualité se PRouve par les fins de vol, elle ne se
// présume pas — mais le mix de départ reste modeste (le palier 2 n'ouvre
// les offres large que si la mesure le justifie, le filtre « servable »
// de l'infra fait le reste).
export function ensureQuality(sim) {
  sim.quality = sim.quality || { q: 1 };
  if (typeof sim.quality.q !== 'number' || !isFinite(sim.quality.q)) sim.quality.q = 1;
  sim.quality.q = Math.min(1, Math.max(Q_FLOOR, sim.quality.q)); // borné (EV-10 : état corrompu réparé)
  return sim.quality;
}

// Le palier LU : fonction pure de la valeur effective — le planificateur
// et le panneau lisent LA même règle (jamais deux règles divergentes).
export function qualityTier(sim) {
  const q = ensureQuality(sim).q;
  return q < 0.4 ? 0 : q < 0.7 ? 1 : 2;
}

// Le battement qualité (appelé par tick.mjs APRÈS les avions : c'est le tour
// des avions qui alimente la fenêtre de ponctualité, logFlightEnd).
// La valeur effective CONVERGE vers la mesure bornée (inertie) :
//   - cible = le taux mesuré (fenêtre R17) ; aucune mesure → 1 (départ neuf,
//     pas de faux chiffre — la valeur reste ce qu'elle est déjà bornée) ;
//   - pas borné : descente ≤ Q_DROP_PER_S × dt, montée ≤ Q_RISE_PER_S × dt ;
//   - borne basse Q_FLOOR : la descente s'arrête là (la voie de reprise existe).
export function tickQuality(sim, dt) {
  const st = ensureQuality(sim);
  ensurePunctuality(sim);
  const rate = punctualityStats(sim).rate; // null = aucune fin de vol dans la fenêtre
  const target = rate == null ? 1 : rate;
  const delta = target - st.q;
  if (delta < 0) st.q = Math.max(Q_FLOOR, st.q - Math.min(-delta, Q_DROP_PER_S * dt));
  else if (delta > 0) st.q = Math.min(1, st.q + Math.min(delta, Q_RISE_PER_S * dt));
}

// LECTURE pour le panneau (UI fine, pattern contractView/objectiveView) :
// la valeur effective, le palier (mix offert) et la mesure sous-jacente
// (taux R17 sur la fenêtre bornée — null = pas encore de fins de vol).
export function qualityView(sim) {
  const st = ensureQuality(sim);
  const tier = qualityTier(sim);
  const stats = punctualityStats(sim);
  return {
    q: st.q,
    tier,
    tierName: Q_TIERS[tier].name,
    sizes: Q_TIERS[tier].sizes.slice(),
    measured: stats.rate,          // taux R17 (null si fenêtre vide)
    measuredTotal: stats.total,    // fins de vol comptées (borné, R17)
  };
}
