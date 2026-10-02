// G0 re-verify : 2 rejeux identiques -> etats differents QUE par runId ?
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\evidence\\g0-recheck-a\\state-g0-recheck-a.json', 'utf8'));
const b = JSON.parse(fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\evidence\\g0-recheck-b\\state-g0-recheck-b.json', 'utf8'));
const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.runId; return JSON.stringify(c); };
const ra = fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\evidence\\g0-recheck-a\\rapport-g0-recheck-a.json', 'utf8');
const rb = fs.readFileSync('C:\\Users\\Lucas\\Documents\\AirportTycoon\\evidence\\g0-recheck-b\\rapport-g0-recheck-b.json', 'utf8');
const repA = JSON.parse(ra), repB = JSON.parse(rb);
delete repA.runId; delete repB.runId; delete repA.commit; delete repB.commit;
console.log('state differents QUE par runId ?', strip(a) === strip(b));
console.log('rapports identiques (sans runId/commit) ?', JSON.stringify(repA) === JSON.stringify(repB));
console.log('money end', repA.money.end, '| pax', repA.passengers.totalCarried, '| net', repA.net, '| debt', repA.money.debt);
