// Prérequis spec des R de G1 (R03-R14) + des G, pour documenter les blocages.
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\docs\\R_KANBAN_CREATION_SPEC.json', 'utf8'));
for (const l of ['R03','R04','R05','R06','R07','R08','R09','R10','R11','R12','R13','R14','G1','G2','G3','G4','G5','G6','G7']) {
  const c = spec.cards[l];
  if (!c) { console.log(l, 'ABSENT'); continue; }
  console.log(l, '←', (c.prereqs||[]).join(', ') || '(aucun)', '| prio', c.priority);
}
