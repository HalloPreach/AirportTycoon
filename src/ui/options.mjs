// R43 (t_62bd0be8) — Options PERSISTANTES : volume 0-100, mode daltonien,
// vitesse x1/x2/x4. Logique PURE (aucun DOM/localStorage) → testable dans
// Node ; les wrappers de stockage sont gardés par `typeof localStorage`
// (sans effet sous Node), MÊME PATRON que src/persistence/save.mjs.
//
// Stockage : une clé DÉDIÉE (OPTIONS_KEY), SÉPARÉE de la sauvegarde de jeu
// → les options survivent à une NOUVELLE PARTIE et à une suppression de la
// sauvegarde (c'est le but d'une page Options). `state.options` est le
// miroir VIVANT que le renderer lit (palette daltonienne) ; main.mjs en est
// le seul pont : il persiste ici et synchronise `state.speedIndex` (les
// vitesses EXISTANTES — SPEEDS de game-state.mjs, jamais réinventées).
//
// Politique corrompue : une options illisible/incompatible retombe aux
// DÉFAUTS (une préférence ne doit JAMAIS bloquer le jeu) — à la différence
// de la sauvegarde de jeu qui est préservée en copie diagnostic (A10).
import { SPEEDS } from '../core/game-state.mjs';

export const OPTIONS_KEY = 'airport-tycoon-options';
export const OPTIONS_VERSION = 1;
export const DEFAULT_OPTIONS = Object.freeze({ volume: 50, colorBlind: false, speedIndex: 0 });

// Normalisation PURE : aucune valeur corrompue ne sort des bornes.
//  - volume : entier 0-100 (arrondi ; hors borne/absent → défaut 50) ;
//  - colorBlind : booléen (tout non-booléen est coercé proprement) ;
//  - speedIndex : entier 0..SPEEDS.length-1 (les vitesses EXISTANTES x1/x2/x4 ;
//    hors borne/absent → défaut 0). Les bornes sont calculées depuis SPEEDS :
//    si de nouvelles vitesses sont ajoutées, la page et la validation suivent.
export function normalizeOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const volume = Number.isFinite(o.volume)
    ? Math.round(Math.min(100, Math.max(0, o.volume)))
    : DEFAULT_OPTIONS.volume;
  const colorBlind = !!o.colorBlind;
  const si = Number.isInteger(o.speedIndex) ? o.speedIndex : DEFAULT_OPTIONS.speedIndex;
  const speedIndex = Math.min(SPEEDS.length - 1, Math.max(0, si));
  return { volume, colorBlind, speedIndex };
}

// Sérialise (fonction PURE, A11) : normalise avant écriture → on ne persiste
// jamais une valeur hors bornes.
export function serializeOptions(options) {
  return JSON.stringify({ v: OPTIONS_VERSION, options: normalizeOptions(options) });
}

// Dé-sérialise + VALIDE : lève une erreur LISIBLE si corrompu/incompatible.
export function deserializeOptions(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Options illisibles (JSON corrompu)');
  }
  if (!raw || typeof raw !== 'object') throw new Error('Options vides');
  if (raw.v !== OPTIONS_VERSION) {
    throw new Error(`Options incompatibles (v${raw.v ?? '?'} ≠ v${OPTIONS_VERSION})`);
  }
  return normalizeOptions(raw.options);
}

// --- Stockage navigateur (localStorage) — sans effet sous Node. -------------
// `st` est injectable : les tests Node passent un objet factice avec la
// sémantique localStorage (getItem/setItem/removeItem).
function storage() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

// Enregistre ; true si succès (l'UI fait le toast), false sinon.
export function saveOptionsToStorage(options, st = storage()) {
  if (!st) return false;
  try {
    st.setItem(OPTIONS_KEY, serializeOptions(options));
    return true;
  } catch {
    return false; // stockage plein/indisponible : on signale, on ne plante pas
  }
}

// Charge + normalise. ABSENTE → DÉFAUTS (copie, jamais la constante gelée) ;
// CORROMPUE/INCOMPATIBLE → DÉFAUTS (une préférence ne bloque jamais le jeu).
export function loadOptions(st = storage()) {
  if (!st) return { ...DEFAULT_OPTIONS };
  let json = null;
  try {
    json = st.getItem(OPTIONS_KEY);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
  if (json == null) return { ...DEFAULT_OPTIONS };
  try {
    return deserializeOptions(json);
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

// Efface (retour aux défauts à la prochaine lecture).
export function clearOptions(st = storage()) {
  if (!st) return;
  try {
    st.removeItem(OPTIONS_KEY);
  } catch { /* indisponible : sans effet */ }
}

// --- Page Options (DOM) — navigateur seul (tests Node : DOM factice, -------
// --- même patron que intro.mjs/bankruptcy.mjs : les boutons pointent vers
// --- l'ON APPLY/BACK injectés, la page ne décide rien d'autre).
// La page édite l'objet `opts` PASSÉ (le miroir vivant de main.mjs) et émet
// onApply(options) après chaque COMMIT (slider volume, toggle daltonien,
// bouton vitesse). `refresh()` est appelé à chaque frame (bus 'frame') :
// affichage borné + repaint idempotent (signature, pattern panels.mjs).
export function makeOptionsPage(state, opts, { onApply, onBack, parent = document.body }) {
  const card = document.createElement('div');
  card.className = 'options';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Options — volume, mode daltonien, vitesse');

  const title = document.createElement('h4');
  title.textContent = 'Options';

  // Volume 0-100 : slider + affichage numérique (la valeur est lisible sans
  // regarder la position du curseur — critère R39 étendu aux options).
  const volRow = document.createElement('div');
  volRow.className = 'opt-row';
  const volLabel = document.createElement('label');
  volLabel.className = 'opt-label';
  const volName = document.createElement('span');
  volName.className = 'opt-name';
  volName.textContent = 'Volume';
  const volValue = document.createElement('span');
  volValue.className = 'opt-value';
  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.step = '1';
  volSlider.className = 'opt-volume';
  volLabel.append(volName, volValue, volSlider);
  volRow.append(volLabel);

  // Mode daltonien : un bouton bascule (pas de case à cocher : le label
  // affiche l'état, lisible au clavier comme à la souris).
  const cbBtn = document.createElement('button');
  cbBtn.className = 'tool';
  cbBtn.dataset.opt = 'colorBlind';

  // Vitesse : UN BOUTON par vitesse EXISTANTE (SPEEDS : x1/x2/x4) — la
  // sélection est marquée par aria-pressed (CSS .options [aria-pressed]).
  const speedRow = document.createElement('div');
  speedRow.className = 'opt-speeds';
  const speedBtns = SPEEDS.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.speedIndex = String(i);
    b.textContent = `Vitesse x${f}`;
    speedRow.appendChild(b);
    return b;
  });

  const back = document.createElement('button');
  back.className = 'tool';
  back.textContent = 'Retour au menu';

  card.append(title, volRow, cbBtn, speedRow, back);
  parent.appendChild(card);
  card.style.display = 'none';

  let open = false;
  let sig = '';

  // Commit : normalise l'objet vivant (bornes) puis émet onApply (main.mjs :
  // persistance + synchro state.speedIndex + toast). La page ne persiste
  // RIEN elle-même (UI fine : le stockage appartient au pont main.mjs).
  function commit() {
    const next = normalizeOptions(opts);
    Object.assign(opts, next);
    onApply?.(opts);
    refresh(); // repaint immédiat (la valeur normalisée est lisible)
  }

  volSlider.addEventListener('input', () => {
    opts.volume = Number(volSlider.value); // le slider ne peut pas sortir de 0-100
    commit();
  });
  // Repli sur 'change' (certains navigateurs n'émettent que 'change').
  volSlider.addEventListener('change', () => {
    opts.volume = Number(volSlider.value);
    commit();
  });
  cbBtn.addEventListener('click', () => {
    opts.colorBlind = !opts.colorBlind;
    commit();
  });
  for (const b of speedBtns) {
    b.addEventListener('click', () => {
      opts.speedIndex = Number(b.dataset.speedIndex);
      commit();
    });
  }
  back.addEventListener('click', () => {
    onBack?.(); // main.mjs : optionsPage.close() (revenir au menu)
  });

  // Peinture bornée : tout est dérivé de l'objet options (le renderer est en
  // lecture seule sur ce miroir, lui, via paletteOf).
  function paint() {
    volSlider.value = String(opts.volume);
    volValue.textContent = `${opts.volume} / 100`;
    cbBtn.textContent = `Mode daltonien : ${opts.colorBlind ? 'ON' : 'OFF'}`;
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === opts.speedIndex)));
  }
  // Déclaration (pas méthode du page) : hoistée → callable depuis commit()
  // (qui la repaint à chaque COMMIT), et la page l'expose telle quelle.
  function refresh() {
    card.style.display = open ? '' : 'none';
    const s = `${opts.volume}|${opts.colorBlind}|${opts.speedIndex}`;
    if (s !== sig) { sig = s; paint(); }
  }

  const page = {
    // Appelé à chaque frame (main.mjs, bus 'frame') : l'affichage suit l'objet
    // options SANS repaint intempestif (signature — même pattern que panels).
    refresh,
    open: () => { open = true; refresh(); },
    close: () => { open = false; refresh(); },
    toggle: () => { (open ? page.close : page.open)(); },
    isOpen: () => open,
  };
  page.refresh(); // état initial (masqué)
  return page;
}
