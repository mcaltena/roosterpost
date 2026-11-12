// Lokale demo: serveert docs/ en hangt de API (met opslag in het geheugen en nep-mail) op /functions/v1/api.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createHandler } from '../supabase/functions/_shared/handler.js';
import { createMemStore } from './memstore.js';

const PORT = Number(process.env.PORT || 8787);
const DOCS = new URL('../docs/', import.meta.url).pathname;
const ENV = { ADMIN_PASSWORD: 'demo', CRON_SECRET: 'cron', RESEND_API_KEY: 're_demo', MAIL_FROM: 'Rooster <rooster@voorbeeld.nl>', FRONTEND_URL: `http://localhost:${PORT}` };
const outbox = [];
const fakeFetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com')) { const b = JSON.parse(init.body); outbox.push(...[].concat(b)); console.log('[nep-Resend]', [].concat(b).map((m) => m.to).join(', ')); return new Response('{"data":[]}', { status: 200 }); }
  return new Response(null, { status: 201 });
};
const store = createMemStore();
const handle = createHandler({ store, env: (k) => ENV[k] || '', fetchFn: fakeFetch });
if (process.env.SEED !== '0') await (await import('./seed.js')).seed(store);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/functions/v1/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`window.ROOSTERPOST = { api: "http://localhost:${PORT}/functions/v1/api" };`); }
  const file = normalize(join(DOCS, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(DOCS)) { res.writeHead(403); return res.end(); }
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end('niet gevonden'); }
}).listen(PORT, () => console.log(`Roosterpost-demo op http://localhost:${PORT} (wachtwoord: demo)`));
