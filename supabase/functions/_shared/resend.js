// E-mail versturen via de Resend-API (HTTPS). Draait in Deno en Node 20+.
const API = 'https://api.resend.com';

export const validAddress = (a) => typeof a === 'string' && a.length <= 254 && /^[^\s@<>,;:"()\[\]\\]+@[^\s@<>,;:"()\[\]\\]+\.[^\s@<>,;:"()\[\]\\]+$/.test(a);
export const mailbox = (name, email) => {
  const n = String(name || '').replace(/[\r\n"<>\\,;]+/g, ' ').trim();
  return n ? `${n} <${email}>` : email;
};
export const mailConfigured = (cfg) => Boolean(cfg.apiKey && cfg.from);

async function post(fetchFn, cfg, path, body) {
  try {
    const res = await fetchFn(API + path, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { message: e.name === 'TimeoutError' ? 'Resend reageert niet (time-out)' : `Geen verbinding met Resend: ${e.message}` } };
  }
}
const errText = (r) => (r.json && r.json.message) || `Resend gaf fout ${r.status}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// messages: [{to, toName, subject, text, html}] → {sent, errors: [{to, error}]}
export async function sendEmails(fetchFn, cfg, messages) {
  const result = { sent: 0, errors: [] };
  const ok = [];
  for (const m of messages) {
    if (!validAddress(m.to)) { result.errors.push({ to: m.to, error: 'ongeldig e-mailadres' }); continue; }
    const p = { from: cfg.from, to: [mailbox(m.toName, m.to)], subject: m.subject, html: m.html, text: m.text };
    if (cfg.replyTo && validAddress(cfg.replyTo)) p.reply_to = cfg.replyTo;
    ok.push({ to: m.to, payload: p });
  }
  for (let i = 0; i < ok.length; i += 100) { // de batch-API neemt er maximaal 100 per aanroep
    const chunk = ok.slice(i, i + 100);
    if (chunk.length > 1) {
      const r = await post(fetchFn, cfg, '/emails/batch', chunk.map((c) => c.payload));
      if (r.ok) { result.sent += chunk.length; continue; }
      // Eén fout laat de hele batch mislukken: stuur ze dan los, zodat je ziet wie het is.
    }
    for (const c of chunk) {
      const r = await post(fetchFn, cfg, '/emails', c.payload);
      if (r.ok) result.sent++; else result.errors.push({ to: c.to, error: errText(r) });
      if (chunk.length > 1) await sleep(150); // ruim onder de limiet van 10 aanroepen per seconde
    }
  }
  return result;
}
