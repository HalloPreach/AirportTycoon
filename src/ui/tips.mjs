// T4 (t_eb78478e) — ONBOARDING : 5 astuces NON-INTRUSIVES, affichées UNE
// seule fois chacune (persistance : state.tips.seen, sérialisé avec la
// sauvegarde → jamais de rediffusion après rechargement). LECTURE SEULE de la
// sim (les conditions n'apportent aucune règle — c'est de l'info joueur), le
// DOM est touché par le callback `toast` fourni par main.mjs (le module est
// pur et testable Node ; le toast existant R28/BL-01 est réutilisé tel quel).
//
// Astuce = une ligne courte (titre + texte), 9 s, coin bas-droite (zone des
// toasts — T51 : la zone est dédiée, aucun chevauchement avec le jeu).
import { weatherView } from '../sim/weather.mjs'; // lecture pure (jamais d'ensure)

// Table EXPLICITE des astuces (id stable, texte lisible — pas de magie).
export const TIPS = Object.freeze([
  {
    id: 'first-service',
    title: 'Première station',
    text: 'Vos stations (carburant, embarquement…) rapportent des frais par avion — suivez le flux dans le bilan financier (bouton Bilan).',
    // La baseline fournie n'a AUCUNE station → la 1re construite = le signal.
    when: (sim) => !!(sim.infra && sim.infra.services && sim.infra.services.length >= 1),
  },
  {
    id: 'first-flight',
    title: 'Premier vol',
    text: 'Un vol s’est posé : les offres de la planification s’acceptent en automatique (touche A). Le panneau Planning (haut-droite) affiche les vols à venir.',
    when: (sim) => !!(sim.economy && sim.economy.flightsLanded >= 1),
  },
  {
    id: 'treasury',
    title: 'Trésorerie',
    text: 'Fonds sous 4 000 $ : empruntez dans le Bilan financier (net 7 840 $ après intérêts). Solde négatif 60 s = faillite.',
    when: (sim, state) =>
      (state.lastAlert && state.lastAlert.kind === 'treasury-warn') ||
      (sim.economy && sim.economy.money < 4000),
  },
  {
    id: 'weather',
    title: 'Météo',
    text: 'La météo ralentit les arrivées (pluie) et les orages ferment une piste — l’état courant est affiché en haut à gauche (HUD).',
    // Le « clear » de départ ne compte pas : l'astuce part à la 1re météo
    // VRAIMENT différente (pluie/neige/orage, incident ou non).
    when: (sim) => weatherView(sim).state !== 'clear',
  },
  {
    id: 'objective',
    title: 'Objectif payé',
    text: 'Récompense encaissée : c’est elle qui finance l’extension. De nouveaux objectifs sont annoncés dans le menu (scénarios).',
    when: (sim) => !!(sim.events && Number(sim.events.seq || 0) >= 1),
  },
]);

// Normalisation défensive (pattern intro.mjs) : champ absent/corrompu →
// l'ASTUCES non vues = toutes, jamais de crash sur une sauvegarde étrange.
export function ensureTips(state) {
  const t = state && state.tips;
  const known = new Set(TIPS.map((x) => x.id));
  const seen = t && Array.isArray(t.seen) ? t.seen : [];
  state.tips = { seen: seen.filter((id) => known.has(id)) };
  return state.tips;
}

// Machine des astuces : refresh() est appelé à chaque frame (pattern intro) —
// au plus 5 toasts dans la vie du module, puis plus rien (seen est persisté).
export function makeTips(state, { toast } = {}) {
  const fired = new Set();
  return {
    refresh() {
      if (!state || !state.sim) return; // le menu n'a pas de sim
      ensureTips(state);
      for (const tip of TIPS) {
        if (state.tips.seen.includes(tip.id) || fired.has(tip.id)) continue;
        let ok = false;
        try { ok = tip.when(state.sim, state); } catch { ok = false; } // UI fine
        if (ok) {
          state.tips.seen.push(tip.id);
          fired.add(tip.id);
          if (toast) toast(`${tip.title} — ${tip.text}`, { kind: 'tip', title: tip.title, durationMs: 9000 });
        }
      }
    },
    // Lecture (tests/CDP) : les astuces déjà vues.
    seen: () => (state.tips ? [...state.tips.seen] : []),
  };
}
