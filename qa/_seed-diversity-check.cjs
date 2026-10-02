// _seed-diversity-check.cjs — R09 : 2 seeds DONNENT-ILS la meme partie ?
// (tool de verification rapide — compare 2 snapshots, la normalisation ne
// masque QUE le champ rngSeed, dont la valeur est differente par construction)
const fs = require('fs');
const a = fs.readFileSync(process.argv[2], 'utf8');
const b = fs.readFileSync(process.argv[3], 'utf8');
const norm = (s) => s.replace(/"rngSeed":\s*\d+/g, '"rngSeed":X').replace(/"runId":\s*"[^"]*"/g, '"runId":"X"');
console.log('identiques a part rngSeed ?', norm(a) === norm(b));
const repA = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const repB = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));
console.log('money end', repA.money.end, 'vs', repB.money.end);
console.log('pax', repA.passengers.totalCarried, 'vs', repB.passengers.totalCarried);
if (norm(a) === norm(b)) {
  console.log('CONSTAT R09 : les seeds NE DIVERSIFIENT PAS encore les parties (attendu avant R09).');
}
