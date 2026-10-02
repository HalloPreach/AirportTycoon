// PRNG déterministe (mulberry32) — l'ÉTAT du générateur vit sur la sim
// (sim.rngSeed + sim.rngCounter) → il est CONSERVÉ dans la sauvegarde (EV-10) :
// la reprise après fermeture est reproductible (même état de générateur → même
// suite de vols). Les tests fournissent leur propre rng semé (déterminisme par
// scénario, ex. seed 42) ; en jeu, tick() utilise CE PRNG semé (plus de
// Math.random à l'état) → la partie est déterministe ET reproductible à la reprise.
//
// mulberry32 : un compteur 32 bits + un seed fixe donnent une séquence de [0,1).
// R09 : le seed est maintenant MÉLÉ dans le compteur (t0 = seed + 0x6D2B79F5)
// → des seeds différents donnent des SUITES différentes (le défaut G0/R02 :
// seed 42 et 99 jouaient la MÊME partie, le générateur ne consommant que
// rngCounter). ANCRE DE MIGRATION : t0 est CONSTANT (le même 0x6D2B79F5
// d'origine) → avec rngSeed 0 la suite est BIT-À-BIT IDENTIQUE à la suite
// pré-R09 (les fixtures de migration evidence/seed-42 et seed-99, state.json
// du G0, sont conservées pour prouver cette continuité).
// L'état (seed, compteur) est entier 32 bits → sérialise proprement en JSON.
export function makeSimRng(sim) {
  if (!Number.isInteger(sim.rngSeed)) sim.rngSeed = 0;
  if (!Number.isInteger(sim.rngCounter)) sim.rngCounter = 0;
  const t0 = (sim.rngSeed + 0x6D2B79F5) | 0; // le seed entre dans la suite (R09)
  return function rng() {
    sim.rngCounter = (sim.rngCounter + 1) | 0;
    let t = (sim.rngCounter + t0) | 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
