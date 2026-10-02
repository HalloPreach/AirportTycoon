// Panneau planning (BL-16, AC20) : liste consultable des vols + boutons
// accepter/refuser + case « auto-accept ». UI fine : la DÉCISION vit dans la
// sim (decideFlight, src/flights/flights.mjs) — ici uniquement DOM + clics.
// Réutilisé : le pattern de barre de build-tool (vrai DOM, CSS dans index.html)
// et le toast pour le feedback. La liste est SÉRIEUSE : elle n'est reconstruite
// que quand le planning change (signature id:status) — sinon les boutons
// disparaîtraient sous la souris à chaque frame et les clics ne partiraient pas.
// R06 (D1) : la préférence auto-accept a UNE seule source de vérité,
// state.planningAuto (sérialisée). La case n'est plus un state local : elle
// ÉMÉT la même commande que la touche A (onAutoChange, câblée par main.mjs)
// et n'est qu'un Miroir DOM de state.planningAuto (rendu via setAuto).
import { decideFlight } from '../flights/flights.mjs';
import { AIRCRAFT, AIRLINES } from '../data/catalog.mjs';

const STATUS = Object.freeze({
  planned: 'prévu', accepted: 'accepté', 'in-flight': 'en vol',
  delayed: 'retardé', cancelled: 'annulé',
});

export function makePlanningPanel({ state, toast, onAutoChange }) {
  const panel = {};

  // DOM fixe (créé UNE fois) : le titre, la case auto, la zone de lignes.
  // Seule la zone de lignes change — et seulement quand le planning change.
  const box = document.createElement('div');
  box.className = 'planning';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Planning des vols (accepter / refuser)');
  const title = document.createElement('h4');
  title.textContent = 'Vols';
  const rows = document.createElement('div');
  rows.className = 'planning-rows';
  const autoLabel = document.createElement('label');
  autoLabel.className = 'planning-auto';
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.checked = !!state.planningAuto; // miroir de l'état (source unique), pas un state
  autoCb.addEventListener('change', () => {
    // La case n'écrit PAS un flag local : elle émet l'intention vers l'état,
    // par la MÊME commande que la touche A (D1 — plus de source parallèle).
    onAutoChange?.(autoCb.checked);
  });
  autoLabel.append(autoCb, document.createTextNode(' auto-accepter les vols prévus'));
  box.append(title, rows, autoLabel);
  document.body.appendChild(box);

  // Synchronise le miroir DOM de la case sur l'état (touche A / rechargement /
  // nouvelle partie) sans re-déclencher d'événement (on change .checked, pas
  // .click()). C'est un miroir : la source reste state.planningAuto (D1).
  panel.setAuto = (on) => { autoCb.checked = !!on; };

  function airlineName(id) { return (AIRLINES.find((x) => x.id === id) || { name: id }).name; }
  // Horloge de la sim en heures:minutes:secondes (le planning est « consultable
  // avec les horaires prévus » — un timestamp lisible, pas un nombre brut).
  function fmtClock(t) {
    const s = Math.max(0, Math.floor(t));
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // Rendu (appelé à chaque frame par le bus, coût négligeable) : on reconstruit
  // les lignes UNIQUEMENT si la signature du planning a changé.
  let sig = null;
  panel.refresh = () => {
    const sim = state.sim;
    if (state.screen !== 'game' || !sim) {
      if (sig !== 'menu') { sig = 'menu'; rows.replaceChildren(); }
      return;
    }
    const list = sim.planning; // consultable : tous les états (la purge retire les finis)
    const s = list.map((e) => `${e.id}:${e.status}`).join('|');
    if (s === sig) return; // liste inchangée → DOM stable (clics/hover/focus intacts)
    sig = s;
    rows.replaceChildren();
    title.textContent = `Vols (${list.length})`;
    for (const e of list) {
      const row = document.createElement('div');
      row.className = 'planning-row';
      const ac = AIRCRAFT[e.acType];
      const info = document.createElement('span');
      info.textContent = `${airlineName(e.airline)} · ${ac ? ac.name : e.acType} · ${e.pax} pax · ${fmtClock(e.planned)} · ${STATUS[e.status] || e.status}` +
        (e.why ? ` (${e.why})` : '');
      row.appendChild(info);
      // « planned » = le SEUL état décisionnable (règle de la sim, decideFlight) ;
      // « accepted » = en attente de déploiement à son heure prévue (aucun bouton).
      if (e.status === 'planned') {
        const ok = document.createElement('button');
        ok.textContent = 'Accepter';
        ok.addEventListener('click', () => {
          if (decideFlight(sim, e.id, true)) toast(`Vol #${e.id} accepté`, 'ok');
          panel.refresh();
        });
        const no = document.createElement('button');
        no.textContent = 'Refuser';
        no.addEventListener('click', () => {
          if (decideFlight(sim, e.id, false)) toast(`Vol #${e.id} refusé — n'arrivera pas`, 'ok');
          panel.refresh();
        });
        row.append(ok, no);
      }
      rows.appendChild(row);
    }
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'planning-empty';
      p.textContent = 'Aucun vol planifié (un vol ~toutes les 60 s de sim)';
      rows.appendChild(p);
    }
  };

  // « Auto-accept » : politique JOUEUR (l'UI accepte pour lui), pas une règle de
  // sim : decideFlight reste la SEULE porte de décision, la sim ne déploie jamais
  // un vol qu'elle a elle-même accepté. La préférence survit à la sauvegarde
  // (elle est sur le state — le format entier est sérialisé, pas le sim seul).
  // D1 : la case lit state.planningAuto (source unique) — pas un flag local.
  // main.mjs ne l'appelle QUE si state.planningAuto est vrai (double garde :
  // la lecture ici est défensive, la porte reste l'état).
  panel.tickAuto = () => {
    if (!state.planningAuto) return;
    const sim = state.sim;
    if (state.screen !== 'game' || !sim) return;
    for (const e of sim.planning) {
      if (e.status === 'planned') decideFlight(sim, e.id, true);
    }
  };

  return panel;
}
