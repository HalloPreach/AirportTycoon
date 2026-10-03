// R35 (t_dabe90d7) — ÉCRAN de FAILLITE EXPLICITE : la sim est stoppée
// (economy.bankrupt, le tick rentre par l'entrée). L'écran affiche le BILAN
// (economy.periodStatement — lecture, zéro règle) et les 3 issues :
//   REPRENDRE : la sim continue depuis le bilan (resumeAfterBankruptcy lève
//     le flag — la sim décide, l'UI émet l'intention, UI FINE) ;
//   NOUVELLE PARTIE : retour menu (le wiring existe, main.mjs startNewGame) ;
//   (la sauvegarde de l'état est déjà automatique — l'UI ne la redécide pas).
// Pattern intro.mjs (R20) : DOM factice en test Node, les boutons réels
// (souris + clavier) pointent vers les COMMANDES de sim / le menu.
import { periodStatement, loanState, resumeAfterBankruptcy } from '../economy/economy.mjs';

const money = (n) => `${Math.round(n)} $`;

// Zone de contenu reconstruite seulement quand la signature change (pattern
// panels.mjs : les éléments ne disparaissent pas sous la souris).
export function makeBankruptcyScreen(state, parent = document.body, actions = {}) {
  const card = document.createElement('div');
  card.className = 'bankruptcy';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Faillite — bilan et décisions');
  const title = document.createElement('h4');
  title.textContent = 'FAILLITE — les caisses sont vides';
  const body = document.createElement('div');
  body.className = 'bankruptcy-statement';
  const btns = document.createElement('div');
  btns.className = 'bankruptcy-actions';
  const btnResume = document.createElement('button');
  btnResume.className = 'tool';
  btnResume.textContent = 'Reprendre la partie';
  const btnNew = document.createElement('button');
  btnNew.className = 'tool';
  btnNew.textContent = 'Nouvelle partie (retour au menu)';
  btns.append(btnResume, btnNew);
  card.append(title, body, btns);
  parent.appendChild(card);
  card.style.display = 'none';

  // Les ACTIONS sont injectables (test Node : on vérifie que la commande de sim
  // est émise ; produit : main.mjs branche le vrai startNewGame du menu).
  const onResume = actions.onResume || (() => {
    if (state.sim) resumeCommand(state.sim);
  });
  const onNewGame = actions.onNewGame || (() => { /* main.mjs : startNewGame */ });

  let sig = '';
  function paint() {
    const sim = state.sim;
    body.replaceChildren();
    if (!sim) return;
    const s = periodStatement(sim);
    const row = (label, value, cls = '') => {
      const d = document.createElement('div');
      d.className = 'kv' + (cls ? ` kv--${cls}` : '');
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      d.append(k, v);
      body.appendChild(d);
    };
    row('Solde', money(s.money), s.money < 0 ? 'bad' : '');
    row('Résultat (bilan)', money(s.net), s.net < 0 ? 'bad' : '');
    row('Recettes', money(s.revenue));
    row('Dépenses (explo + carburant + indemnités + investissements)',
      money(s.opex + s.fuel + s.compensation + s.invest), 'bad');
    if (s.debt > 0) row('Dette (intérêts)', money(s.debt), 'bad');
    const ls = loanState(sim);
    row('Emprunt disponible', ls.available
      ? `${money(ls.netLiquidity)} après intérêts (${money(ls.principal)} − ${money(ls.interest)})`
      : `obtenu (${ls.count}/${ls.max}) — borne atteinte`, ls.available ? '' : 'warn');
    if (s.causes.length) row('Causes du déficit', s.causes.join(' ; '), 'warn');
    const note = document.createElement('p');
    note.textContent = 'Reprendre : la simulation continue depuis ce bilan (le solde négatif continue de s\'aggraver sans redressement). Nouvelle partie : tout repart (le solde, la dette, l\'emprunt).';
    body.appendChild(note);
  }

  // Appelé à chaque frame (bus 'frame') : l'écran s'ouvre UNIQUEMENT quand la
  // sim est en faillite (le flag est l'état de la sim — l'UI ne le décide pas),
  // et se referme sur « Reprendre » (flag levé) ou « Nouvelle partie » (menu).
  const screen = {
    refresh: () => {
      const open = state.screen === 'game' && state.sim && state.sim.economy.bankrupt;
      card.style.display = open ? '' : 'none';
      if (open) {
        const sim = state.sim;
        const s = periodStatement(sim);
        const l = loanState(sim);
        const ns = JSON.stringify([s.net, s.money, s.debt, s.loan, s.causes, l.available]);
        if (ns !== sig) { sig = ns; paint(); }
      } else {
        sig = '';
      }
    },
  };
  btnResume.addEventListener('click', onResume);
  btnNew.addEventListener('click', onNewGame);
  screen.refresh();
  return screen;
}

// La COMMANDE de reprise (exposée pour le wiring de main.mjs : l'UI émet
// l'intention, la sim règle — UI FINE).
export { resumeAfterBankruptcy as resumeCommand };
