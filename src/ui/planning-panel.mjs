// Panneau planning (BL-16, AC20 + R19) : liste consultable des vols,
// SÉPARÉE en « à décider » (offres planned) et « en cours » (opérations),
// + boutons accepter/refuser (+ par filtre) + case « auto-accept ».
// UI fine : la DÉCISION vit dans la sim (decideFlight, src/flights/flights.mjs)
// et la NOTE DE DÉCISION (obstacle/risque/revenu estimé) aussi (planNote) —
// ici uniquement DOM + clics. La liste est SÉRIEUSE : elle n'est reconstruite
// que quand la signature change (id:status) — sinon les boutons
// disparaîtraient sous la souris à chaque frame et les clics ne partiraient pas.
// R06 (D1) : la préférence auto-accept a UNE seule source de vérité,
// state.planningAuto (sérialisée). La case n'est qu'un miroir DOM de
// state.planningAuto : elle ÉMET la même commande que la touche A
// (onAutoChange, câblée par main.mjs) et se resynchronise via setAuto.
import { decideFlight, planNote } from '../flights/flights.mjs';
import { AIRCRAFT, AIRLINES } from '../data/catalog.mjs';

const STATUS = Object.freeze({
  planned: 'prévu', accepted: 'accepté', 'in-flight': 'en vol',
  delayed: 'retardé', cancelled: 'annulé',
});

export function makePlanningPanel({ state, toast, onAutoChange }) {
  const panel = {};

  // DOM fixe (créé UNE fois) : titres de section, ligne de filtres, zones de
  // lignes. Seules les zones de lignes changent — et seulement quand la
  // signature du planning change (R19 : sections « à décider » / « en cours »).
  const box = document.createElement('div');
  box.className = 'planning';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Planning des vols (accepter / refuser)');
  const title = document.createElement('h4');
  title.textContent = 'Vols';
  const decTitle = document.createElement('h5');
  decTitle.className = 'planning-sec';
  decTitle.textContent = 'À décider';
  const decRows = document.createElement('div');
  decRows.className = 'planning-rows';
  const opsTitle = document.createElement('h5');
  opsTitle.className = 'planning-sec';
  opsTitle.textContent = 'En cours';
  const opsRows = document.createElement('div');
  opsRows.className = 'planning-rows';
  // Filtre (R19 : accepter/refuser TOUTS les éléments d'un filtre utile) —
  // état LOCAL DE L'UI (il ne décide rien : la décision reste decideFlight,
  // la porte unique) : le filtre ne fait que choisir la cible du lot.
  const filterBar = document.createElement('div');
  filterBar.className = 'planning-filters';
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
  box.append(title, decTitle, decRows, filterBar, opsTitle, opsRows, autoLabel);
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

  // Note de DÉCISION d'une offre (planNote, flights.mjs — la règle sim) :
  // obstacle (offre impossible → motif lisible), risque (sans promesse de
  // rentabilité), revenu ESTIMÉ (hypothèse, préfixe explicite).
  function renderNote(sim, e, row) {
    const n = planNote(sim, e);
    const ac = n.spec;
    const bits = [];
    if (ac && ac.seats) bits.push(`charge ${e.pax}/${ac.seats}`);
    bits.push(`≈ ${Math.round(n.revenue)} $ (estimé)`);
    for (const r of n.risks) bits.push(`⚠ ${r}`);
    for (const o of n.obstacles) bits.push(`⛔ ${o}`);
    if (!bits.length) return;
    const note = document.createElement('span');
    note.className = 'planning-note';
    note.textContent = ' · ' + bits.join(' · ');
    row.appendChild(note);
  }

  // Une ligne du planning (les deux sections partagent le même rendu).
  // Les boutons « Accepter/Refuser » n'existent QUE sur les offres « planned »
  // (le SEUL état décisionnable — règle sim, decideFlight) : une décision ne
  // peut donc jamais s'appliquer à un vol déjà déployé (critère R19, la garde
  // vit dans decideFlight, pas ici).
  function renderRow(sim, e, host) {
    const row = document.createElement('div');
    row.className = 'planning-row';
    const ac = AIRCRAFT[e.acType];
    const info = document.createElement('span');
    info.textContent = `${airlineName(e.airline)} · ${ac ? ac.name : e.acType} · ${e.pax} pax · ${fmtClock(e.planned)} · ${STATUS[e.status] || e.status}` +
      (e.why ? ` (${e.why})` : '');
    row.appendChild(info);
    if (e.status === 'planned') {
      renderNote(sim, e, row); // R19 : obstacle/risque/revenu estimé AVANT la décision
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
    host.appendChild(row);
  }

  // Filtre utile (R19) : « tous / par compagnie / par taille » — les boutons de
  // masse ciblent les offres « planned » du filtre et passent par decideFlight
  // (la porte unique : pas de contournement des validations métier).
  // Le filtre est un état local d'affichage (closure) : il ne décide rien.
  let filter = 'tous';
  function matchFilter(e) {
    if (filter === 'tous') return true;
    if (filter.startsWith('comp:')) return e.airline === filter.slice(5);
    return e.acType === filter.slice(5); // 'taille:...'
  }
  function addFilterButtons() {
    filterBar.replaceChildren();
    const labels = [{ id: 'tous', name: 'tous' }];
    for (const a of AIRLINES) labels.push({ id: `comp:${a.id}`, name: a.name });
    for (const k of Object.keys(AIRCRAFT)) labels.push({ id: `taille:${k}`, name: k });
    for (const f of labels) {
      const b = document.createElement('button');
      b.textContent = f.name;
      b.className = 'planning-filter' + (f.id === filter ? ' on' : '');
      b.addEventListener('click', () => { filter = f.id; addFilterButtons(); });
      filterBar.appendChild(b);
    }
    const accAll = document.createElement('button');
    accAll.textContent = '✓ filtrés';
    accAll.addEventListener('click', () => bulkDecide(true));
    const refAll = document.createElement('button');
    refAll.textContent = '✗ filtrés';
    refAll.addEventListener('click', () => bulkDecide(false));
    filterBar.append(accAll, refAll);
  }
  function bulkDecide(accept) {
    const sim = state.sim;
    if (!sim) return;
    let n = 0;
    for (const e of sim.planning) {
      if (e.status !== 'planned' || !matchFilter(e)) continue;
      if (decideFlight(sim, e.id, accept)) n++; // porte unique : refait la garde « planned »
    }
    toast(`${n} vol(s) ${accept ? 'accepté' : 'refusé'} (${filter})`, 'ok');
    panel.refresh();
  }

  // Rendu (appelé à chaque frame par le bus, coût négligeable) : on reconstruit
  // les lignes UNIQUEMENT si la signature du planning a changé.
  let sig = null;
  panel.refresh = () => {
    const sim = state.sim;
    if (state.screen !== 'game' || !sim) {
      if (sig !== 'menu') {
        sig = 'menu';
        decRows.replaceChildren();
        opsRows.replaceChildren();
      }
      return;
    }
    const list = sim.planning; // consultable : tous les états (la purge retire les finis)
    const s = list.map((e) => `${e.id}:${e.status}`).join('|');
    if (s === sig) return; // liste inchangée → DOM stable (clics/hover/focus intacts)
    sig = s;
    const planned = list.filter((e) => e.status === 'planned');
    const running = list.filter((e) => e.status !== 'planned');
    title.textContent = `Vols (${list.length})`;
    decTitle.textContent = `À décider (${planned.length})`;
    opsTitle.textContent = `En cours (${running.length})`;
    decRows.replaceChildren();
    opsRows.replaceChildren();
    for (const e of planned) renderRow(sim, e, decRows);
    for (const e of running) renderRow(sim, e, opsRows);
    if (!planned.length) {
      const p = document.createElement('p');
      p.className = 'planning-empty';
      p.textContent = 'Aucune offre à décider (un vol ~toutes les 60 s de sim)';
      decRows.appendChild(p);
    }
    addFilterButtons(); // barre reconstruite avec la liste (boutons stables, 1/frame max)
  };

  // « Auto-accept » : politique JOUEUR (l'UI accepte pour lui), pas une règle de
  // sim : decideFlight reste la SEULE porte de décision, la sim ne déploie
  // jamais un vol qu'elle a elle-même accepté. La préférence survit à la
  // sauvegarde (elle est sur le state — le format entier est sérialisé).
  // D1 : la case lit state.planningAuto (source unique) — pas un flag local.
  // main.mjs ne l'appelle QUE si state.planningAuto est vrai (double garde).
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
