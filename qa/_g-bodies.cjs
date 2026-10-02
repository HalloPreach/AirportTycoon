// Corps spec des cartes G0-G7 (les criteres de validation de chaque gate).
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\docs\\R_KANBAN_CREATION_SPEC.json', 'utf8'));
for (const l of ['G0','G1','G2','G3','G4','G5','G6','G7']) {
  console.log('===== ' + l + ' =====');
  console.log('titre : ' + spec.cards[l].title);
  console.log(spec.cards[l].body);
  console.log('');
}
