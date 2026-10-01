// Mini serveur statique Node, 0 dépendance (stdlib uniquement).
// Aucune API, aucun réseau sortant au runtime : il ne sert que les fichiers locaux.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ponytail: port fixe 8123 (modifiable via PORT) ; suffisant en local.
const port = Number(process.env.PORT || 8123);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (p === '') p = 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root)) { // anti path-traversal
      res.writeHead(403); return res.end('forbidden');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('404');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`AirportTycoon : http://127.0.0.1:${port}`);
});
