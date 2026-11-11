// Servidor local que imita Vercel: sirve los estáticos y ejecuta /api/*.js con la misma
// forma de req/res (req.query, req.body, res.status().json()). Solo para desarrollo.
// Uso: node dev-server.mjs   (lee .env.local si existe)  → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

// Variables de entorno desde .env.local (sin dependencias)
for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.ico': 'image/x-icon', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

function wrapRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj)); return res; };
  res.send = body => { if (typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body);
    res.end(body); return res; };
  return res;
}

async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) { try { return JSON.parse(raw); } catch { return raw; } }
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return raw;
}

http.createServer(async (req, res) => {
  wrapRes(res);
  let url = new URL(req.url, `http://${req.headers.host}`);
  // Misma reescritura que vercel.json
  const rw = url.pathname.match(/^\/api\/instinct\/(.+)$/);
  if (rw) { url.searchParams.set('route', rw[1]); url.pathname = '/api/instinct'; }

  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '');
      const file = path.join(ROOT, 'api', name + '.js');
      if (!/^[\w-]+$/.test(name) || !fs.existsSync(file)) return res.status(404).json({ error: 'ruta no encontrada' });
      req.query = Object.fromEntries(url.searchParams);
      req.body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const mod = await import(pathToFileURL(file).href + '?t=' + fs.statSync(file).mtimeMs);
      await mod.default(req, res);
      console.log(req.method, url.pathname, res.statusCode);
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return res.status(404).end('No encontrado');
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`Orbit en http://localhost:${PORT}`));
