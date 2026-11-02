// A local server for looking at the built site: `npm run serve`.
// Serves dist/ the way Cloudflare Pages will — a folder path gets index.html.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        // A folder without the slash still resolves, like Pages does.
        fs.readFile(path.join(file, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(d2);
        });
        return;
      }
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type }).end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`serving dist/ at http://127.0.0.1:${PORT}`);
  });
