// R20 — Introduction courte et désactivable du PREMIER CYCLE de jeu :
// accepter un vol → observer sa porte → consulter les finances →
// comprendre un goulot → investir si utile.
// UI fine : elle ne fait que pointer vers les panneaux EXISTANTS (aucune
// règle de jeu, aucun objet de la sim). La progression vit sur `state.intro`
// (sérialisée avec l'état entier → la progression REPREND après sauvegarde).
// Désactivable : « Passer l'intro » (skipped) ou « Terminer » (done) — les deux
// états sont sur le state, donc ils survivent à la sauvegarde : un joueur qui
// a fini l'intro ne la revoit pas en rechargeant.
// ponytail : 5 étapes en dur (le brief demande une intro courte), pas de
// système de tutoriel paramétrable ; une étape ne « récompense » rien (pas de
// récompense, pas de condition de succès — le panneau guide, la sim décide).
const STEPS = Object.freeze([
  {
    title: '1/5 · Recevoir un vol',
    text: 'À droite, le panneau « Vols » liste les offres à décider. Cliquez sur Accepter : le vol arrivera à son horaire, atterrira et amarrera à une porte du terminal.',
  },
  {
    title: '2/5 · Observer sa porte',
    text: 'Quand l’avion arrive, cliquez dessus sur la carte : le panneau Inspection (en bas à droite) montre sa phase, sa porte, et la cause de tout retard.',
  },
  {
    title: '3/5 · Consulter les finances',
    text: 'Le panneau Bilan financier affiche le solde, le résultat de la période et les causes du déficit (exploitation, carburant, indemnités, dette).',
  },
  {
    title: '4/5 · Comprendre un goulot',
    text: 'Vol annulé ou retardé ? La cause est lisible : Diagnostic réseau (porte coupée), file d’arrivées saturée, station carburant en panne — et une offre impossible dans « Vols » explique son obstacle.',
  },
  {
    title: '5/5 · Investir si utile',
    text: 'Barre en bas à gauche : choisissez un bâtiment (B ou 1-8), cliquez sur la carte pour le poser (coût débité). Piste plus longue → vols plus gros ; porte → plus de vols au sol ; station carburant → pas de départs secs.',
  },
]);

export function makeIntro(state, parent = document.body) {
  const intro = {};

  // Normalisation : une sauvegarde ANCIENNE (sans champ intro) ou une nouvelle
  // partie (makeGameState sans intro) repartent sur l'étape 1, non désactivée.
  // L'étape est bornée (0..4) : une sauvegarde corrompue ne fait jamais
  // sortir la peinture de la liste des étapes.
  function norm() {
    state.intro = state.intro ?? { step: 0, done: false, skipped: false };
    state.intro.step = Math.max(0, Math.min(STEPS.length - 1, state.intro.step | 0));
    return state.intro;
  }

  // Carte DOM (créée une fois, en bas à gauche sous la barre de commandes) —
  // <button> réels (souris + clavier), comme le reste de l'UI. Le parent est
  // injectable (test Node : conteneur factice ; produit : document.body).
  const card = document.createElement('div');
  card.className = 'intro';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Introduction — premier cycle de jeu');
  const title = document.createElement('h4');
  const text = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'intro-actions';
  const prev = document.createElement('button');
  prev.className = 'tool';
  prev.textContent = '← Précédent';
  const next = document.createElement('button');
  next.className = 'tool';
  next.textContent = 'Suivant →';
  const done = document.createElement('button');
  done.className = 'tool';
  done.textContent = 'Terminer l’intro';
  const skip = document.createElement('button');
  skip.className = 'tool tool--danger';
  skip.textContent = 'Passer l’intro';
  actions.append(prev, next, done);
  card.append(title, text, actions, skip);
  parent.appendChild(card);

  function paint(i) {
    const s = STEPS[i];
    title.textContent = s.title;
    text.textContent = s.text;
    prev.style.display = i > 0 ? '' : 'none';
    next.style.display = i < STEPS.length - 1 ? '' : 'none';
    done.style.display = i === STEPS.length - 1 ? '' : 'none';
  }
  prev.addEventListener('click', () => { const n = norm(); n.step = Math.max(0, n.step - 1); paint(n.step); });
  next.addEventListener('click', () => { const n = norm(); n.step = Math.min(STEPS.length - 1, n.step + 1); paint(n.step); });
  done.addEventListener('click', () => { const n = norm(); n.done = true; card.style.display = 'none'; });
  skip.addEventListener('click', () => { const n = norm(); n.skipped = true; card.style.display = 'none'; });

  // Appelé à chaque frame (bus 'frame') : normalise le champ (reprise /
  // nouvelle partie) et montre la carte uniquement EN JEU, tant que l'intro
  // n'est ni terminée ni passée. Peinture idempotente (textContent stable).
  intro.refresh = () => {
    const n = norm();
    const open = state.screen === 'game' && !n.done && !n.skipped;
    card.style.display = open ? '' : 'none';
    if (open) paint(n.step);
  };
  intro.refresh();

  return intro;
}
