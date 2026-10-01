// Toasts : petits messages lisibles en bas à droite (feedback utilisateur).
// Pur DOM, zéro règle de jeu : afficher, auto-disparaître.
// ponytail: max 4 toasts empilés, 4 s ; c'est un feedback, pas un journal.
export function makeToasts(root) {
  const box = document.createElement('div');
  box.className = 'toasts';
  box.setAttribute('role', 'status'); // annoncé aux lecteurs d'écran
  root.appendChild(box);

  let timer = 0;
  function toast(msg, kind = 'info') {
    while (box.children.length >= 4) box.firstChild.remove(); // on garde les 4 derniers
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.textContent = msg;
    box.appendChild(el);
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const t of [...box.children]) t.classList.add('toast--out');
      setTimeout(() => box.replaceChildren(), 200);
    }, 4000);
  }
  return { toast, box };
}
