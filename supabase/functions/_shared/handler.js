// De hele API van Roosterpost als één functie: (Request) => Response.
// Staat los van Supabase: opslag (store), omgeving (env), fetch en klok worden aangereikt.
// Daardoor draait dezelfde code in de Edge Function (Deno) en in de tests (Node).
import * as R from './rooster.js';
import * as push from './push.js';
import { sendEmails, validAddress, mailConfigured } from './resend.js';

const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(String(s))));
const sha256hex = async (s) => hex(await sha256(s));
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function safeEqual(a, b) { // vergelijkt hashes, zodat de duur niets verraadt over het wachtwoord
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isToken = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
const DAY = 864e5;

export const DEFAULT_SETTINGS = {
  org: '', baseUrl: '',
  rollen: [{ naam: 'Leiding', nodig: 2 }, { naam: 'Oppas', nodig: 1 }, { naam: 'EHBO', nodig: 1 }],
  actief: true, weekdag: 1, tijd: '07:00', ontvangers: 'ingeroosterd',
};

export function createHandler({ store, env, fetchFn = (...a) => fetch(...a), now = () => new Date() }) {
  const E = (k) => String(env(k) || '');
  const tz = () => E('TZ_NAME') || R.DEFAULT_TZ;
  const mailCfg = () => ({ apiKey: E('RESEND_API_KEY'), from: E('MAIL_FROM'), replyTo: E('MAIL_REPLY_TO') });
  const local = () => R.nowParts(now(), tz());

  async function loadSettings() {
    const s = { ...DEFAULT_SETTINGS, ...((await store.getKv('settings')) || {}) };
    if (!s.baseUrl) s.baseUrl = E('FRONTEND_URL').replace(/\/+$/, '');
    return s;
  }
  async function getVapid() {
    let v = await store.getKv('vapid');
    if (!v) { v = await push.generateVapid(); await store.setKv('vapid', v); }
    return v;
  }
  function vapidSubject() {
    const m = E('MAIL_FROM').match(/[^\s<>@]+@[^\s<>@]+/);
    return m ? `mailto:${m[0]}` : (E('FRONTEND_URL') || 'mailto:beheer@example.org');
  }
  async function logEntry(entry) { await store.addLog({ ts: now().toISOString(), ...entry }); }

  // ---------- versturen ----------
  async function sendOverview({ from, to, meetingId, type }) {
    const [settings, people] = await Promise.all([loadSettings(), store.listPeople()]);
    const meetings = meetingId ? [await store.getMeeting(meetingId)].filter(Boolean) : await store.listMeetings({ from, to });
    const db = { settings, people, meetings };
    const single = Boolean(meetingId);
    const ov = R.buildOverview(db, from, to, meetingId);
    if (!ov.days.length) { await logEntry({ type, onderwerp: 'Geen bijeenkomsten in deze periode', mails: 0, push: 0, ontvangers: 0, fouten: [] }); return { skipped: true }; }
    const rostered = R.rosteredIds(ov);
    const targets = people.filter((p) => (settings.ontvangers === 'iedereen' && !single) || rostered.has(p.id));
    const messages = []; const fouten = [];
    let subject = '';
    for (const p of targets) {
      const m = R.renderMail(db, ov, p, single); subject = m.subject;
      if (p.email) messages.push({ to: p.email, toName: p.naam, ...m });
      else if (!(p.push || []).length) fouten.push(`${p.naam}: geen e-mailadres en geen meldingen`);
    }
    let mails = 0;
    if (messages.length) {
      if (!mailConfigured(mailCfg())) fouten.push('E-mail is niet ingesteld (RESEND_API_KEY en MAIL_FROM); er zijn geen mails verstuurd.');
      else {
        const r = await sendEmails(fetchFn, mailCfg(), messages);
        mails = r.sent; for (const e of r.errors) fouten.push(`${e.to}: ${e.error}`);
      }
    }
    let pushed = 0;
    if (targets.some((p) => (p.push || []).length)) {
      const vapid = await getVapid();
      for (const p of targets) {
        if (!(p.push || []).length) continue;
        const url = R.personLink(settings.baseUrl, p.token);
        const payload = { ...R.pushText(ov, p, single), ...(url ? { url } : {}) };
        const keep = [];
        for (const s of p.push) { const r = await push.send(s, payload, vapid, vapidSubject(), fetchFn); if (r === 'ok') pushed++; if (r !== 'gone') keep.push(s); }
        if (keep.length !== p.push.length) await store.savePerson({ ...p, push: keep });
      }
    }
    if (!subject) subject = R.renderMail(db, ov, { id: '', naam: '' }, single).subject;
    await logEntry({ type, onderwerp: subject, mails, push: pushed, ontvangers: targets.length, fouten });
    return { mails, push: pushed, ontvangers: targets.length, fouten };
  }

  // Wordt elk kwartier aangeroepen door pg_cron. Verstuurt de wekelijkse mail precies één keer per dag.
  async function tick() {
    const n = now(); const settings = await loadSettings(); const lp = local();
    await store.setKv('lastTick', n.toISOString());
    await store.pruneSessions(n.getTime()); await store.pruneFails(n.getTime() - DAY);
    await store.pruneLog(new Date(n.getTime() - 90 * DAY).toISOString());
    if (!settings.actief) return { skipped: 'wekelijkse verzending staat uit' };
    if (lp.weekday !== settings.weekdag) return { skipped: 'vandaag is niet de verzenddag' };
    if (lp.time < settings.tijd) return { skipped: 'het verzendtijdstip is nog niet bereikt' };
    if (!(await store.claimWeekly(lp.date))) return { skipped: 'vandaag is al verzonden' };
    try { return await sendOverview({ from: lp.date, to: R.addDays(lp.date, 6), type: 'wekelijks' }); } catch (e) {
      await store.releaseWeekly(lp.date); // volgende kwartier opnieuw proberen
      await logEntry({ type: 'wekelijks', onderwerp: 'Verzending mislukt, nieuwe poging volgt', mails: 0, push: 0, ontvangers: 0, fouten: [e.message] });
      throw e;
    }
  }

  async function nextSend(settings) {
    if (!settings.actief) return null;
    const n = local();
    for (let i = 0; i < 8; i++) {
      const d = R.addDays(n.date, i);
      if (R.weekdayOf(d) !== settings.weekdag) continue;
      if (i === 0 && ((await store.hasWeekly(d)) || n.time >= settings.tijd)) continue;
      return `${R.fmtDate(d)} om ${settings.tijd}`;
    }
    return null;
  }

  async function adminState() {
    const today = local().date;
    const [settings, people, meetings, log, lastTick] = await Promise.all([
      loadSettings(), store.listPeople(), store.listMeetings({ from: R.addDays(today, -365) }), store.listLog(30), store.getKv('lastTick'),
    ]);
    await getVapid();
    const c = mailCfg();
    return {
      settings,
      people: people.map(({ push: subs, token, ...p }) => ({ ...p, token, pushCount: (subs || []).length })),
      meetings, log,
      mail: { configured: mailConfigured(c), from: c.from },
      health: { lastTick: lastTick || null }, today, tz: tz(), next: await nextSend(settings),
    };
  }

  // ---------- routes ----------
  async function route(req, p, url, reply) {
    const m = req.method;
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const body = async () => {
      if (!/^application\/json/i.test(req.headers.get('content-type') || '')) throw new HttpError(415, 'Verwacht JSON');
      const t = await req.text();
      if (t.length > 200000) throw new HttpError(413, 'Te groot');
      try { return JSON.parse(t || '{}'); } catch { throw new HttpError(400, 'Ongeldige JSON'); }
    };

    if (p === '/' && m === 'GET') return reply(200, { ok: true, naam: 'Roosterpost' });

    // geplande taak (pg_cron), beveiligd met een gedeeld geheim
    if (p === '/cron/tick' && m === 'POST') {
      const secret = E('CRON_SECRET');
      if (!secret) throw new HttpError(503, 'CRON_SECRET is niet ingesteld.');
      if (!(await safeEqual(req.headers.get('x-cron-secret') || '', secret))) throw new HttpError(401, 'Geen toegang.');
      return reply(200, { ok: true, ...(await tick()) });
    }

    if (p === '/login' && m === 'POST') {
      const b = await body();
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'onbekend';
      const since = now().getTime() - 10 * 60000;
      // Per adres en daarnaast een algemene rem, want een adres in de header is te vervalsen.
      if ((await store.countFails(ip, since)) >= 5 || (await store.countFails('*', since)) >= 30) throw new HttpError(429, 'Te veel pogingen. Probeer het over enkele minuten opnieuw.');
      const admin = E('ADMIN_PASSWORD');
      if (!admin) throw new HttpError(503, 'ADMIN_PASSWORD is niet ingesteld.');
      if (!(await safeEqual(b.password || '', admin))) {
        await store.addFail(ip, now().getTime()); await store.addFail('*', now().getTime());
        throw new HttpError(401, 'Wachtwoord klopt niet.');
      }
      await store.clearFails(ip);
      const token = randHex(24);
      await store.createSession(await sha256hex(token), now().getTime() + 30 * DAY);
      return reply(200, { ok: true, token });
    }

    // --- persoonlijke pagina (token in de link, geen wachtwoord) ---
    if (p === '/me' && m === 'GET') {
      const t = url.searchParams.get('t');
      const person = isToken(t) ? await store.getPersonByToken(t) : null;
      if (!person) throw new HttpError(404, 'Deze link is niet (meer) geldig. Vraag de coördinator om een nieuwe.');
      const today = local().date;
      const [settings, people, meetings, vapid] = await Promise.all([loadSettings(), store.listPeople(), store.listMeetings({ from: today, to: R.addDays(today, 90) }), getVapid()]);
      const ov = R.buildOverview({ settings, people, meetings }, today, R.addDays(today, 90));
      return reply(200, { naam: person.naam, id: person.id, org: settings.org, days: ov.days, mine: R.mine(ov, person.id), vapidKey: vapid.publicKey, pushCount: (person.push || []).length });
    }
    if (p === '/push/subscribe' && m === 'POST') {
      const b = await body(); const person = isToken(b.t) ? await store.getPersonByToken(b.t) : null;
      if (!person) throw new HttpError(404, 'Onbekende link.');
      const s = b.subscription;
      if (!s || !push.validSubscription(s)) throw new HttpError(400, 'Deze browser gaf geen bruikbaar meldingsabonnement.');
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
      person.push = [...(person.push || []).filter((x) => x.endpoint !== s.endpoint), sub].slice(-5);
      await store.savePerson(person);
      const settings = await loadSettings(); const url = R.personLink(settings.baseUrl, person.token);
      const test = await push.send(sub, { title: 'Meldingen staan aan', body: 'Je krijgt hier voortaan je rooster.', ...(url ? { url } : {}) }, await getVapid(), vapidSubject(), fetchFn);
      return reply(200, { ok: true, test });
    }
    if (p === '/push/unsubscribe' && m === 'POST') {
      const b = await body(); const person = isToken(b.t) ? await store.getPersonByToken(b.t) : null;
      if (!person) throw new HttpError(404, 'Onbekende link.');
      person.push = (person.push || []).filter((x) => x.endpoint !== b.endpoint);
      await store.savePerson(person);
      return reply(200, { ok: true });
    }

    // --- alles hieronder: alleen beheer ---
    if (!bearer || !(await store.sessionValid(await sha256hex(bearer), now().getTime()))) throw new HttpError(401, 'Niet ingelogd.');

    if (p === '/logout' && m === 'POST') { await store.deleteSession(await sha256hex(bearer)); return reply(200, { ok: true }); }
    if (p === '/state' && m === 'GET') return reply(200, await adminState());

    if (p === '/settings' && m === 'PUT') {
      const b = await body(); const s = await loadSettings();
      s.org = str(b.org, 80);
      const base = str(b.baseUrl, 200).replace(/\/+$/, '');
      if (base && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(base)) throw new HttpError(400, 'Het webadres moet beginnen met https://');
      s.baseUrl = base;
      if (Array.isArray(b.rollen)) {
        const seen = new Set();
        s.rollen = b.rollen.map((r) => ({ naam: str(r.naam, 40), nodig: Math.max(0, Math.min(50, Number(r.nodig) || 0)) }))
          .filter((r) => r.naam && !seen.has(r.naam.toLowerCase()) && seen.add(r.naam.toLowerCase())).slice(0, 20);
      }
      s.actief = Boolean(b.actief);
      if (Number.isInteger(b.weekdag) && b.weekdag >= 0 && b.weekdag <= 6) s.weekdag = b.weekdag;
      if (isTime(b.tijd)) s.tijd = b.tijd;
      s.ontvangers = b.ontvangers === 'iedereen' ? 'iedereen' : 'ingeroosterd';
      await store.setKv('settings', s);
      return reply(200, await adminState());
    }

    if (p === '/people' && m === 'POST') {
      const b = await body();
      const naam = str(b.naam, 80); const email = str(b.email, 254).toLowerCase();
      if (!naam) throw new HttpError(400, 'Vul een naam in.');
      if (email && !validAddress(email)) throw new HttpError(400, 'Dit e-mailadres klopt niet.');
      const rollen = Array.isArray(b.rollen) ? b.rollen.map((r) => str(r, 40)).filter(Boolean).slice(0, 20) : [];
      const people = await store.listPeople();
      const person = people.find((x) => x.id === b.id) || { id: randHex(8), token: randHex(16), push: [] };
      await store.savePerson({ ...person, naam, email, rollen });
      return reply(200, await adminState());
    }
    let mm;
    if ((mm = p.match(/^\/people\/(\w+)$/)) && m === 'DELETE') {
      const affected = (await store.listMeetings()).filter((x) => (x.inzet || []).some((i) => i.persoonId === mm[1]));
      await store.saveMeetings(affected.map((x) => ({ ...x, inzet: x.inzet.filter((i) => i.persoonId !== mm[1]) })));
      await store.deletePerson(mm[1]);
      return reply(200, await adminState());
    }
    if ((mm = p.match(/^\/people\/(\w+)\/newlink$/)) && m === 'POST') {
      const person = (await store.listPeople()).find((x) => x.id === mm[1]); if (!person) throw new HttpError(404, 'Onbekend.');
      await store.savePerson({ ...person, token: randHex(16), push: [] });
      return reply(200, await adminState());
    }
    if ((mm = p.match(/^\/people\/(\w+)\/invite$/)) && m === 'POST') {
      const person = (await store.listPeople()).find((x) => x.id === mm[1]); if (!person) throw new HttpError(404, 'Onbekend.');
      const settings = await loadSettings();
      if (!person.email) throw new HttpError(400, 'Deze persoon heeft geen e-mailadres.');
      if (!settings.baseUrl) throw new HttpError(400, 'Vul eerst het webadres in bij Instellingen.');
      if (!mailConfigured(mailCfg())) throw new HttpError(502, 'E-mail is niet ingesteld (RESEND_API_KEY en MAIL_FROM).');
      const link = R.personLink(settings.baseUrl, person.token); const org = settings.org || 'het rooster';
      const text = `Hoi ${person.naam},\n\nVia deze persoonlijke link zie je altijd het actuele rooster van ${org}:\n${link}\n\nTip: open de link op je telefoon, zet hem op je beginscherm en tik op 'Meldingen aanzetten'. Deel de link niet met anderen.\n`;
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#17231f"><p>Hoi ${R.esc(person.naam)},</p><p>Via deze persoonlijke link zie je altijd het actuele rooster van ${R.esc(org)}:</p><p><a href="${R.esc(link)}" style="color:#0f6b5c">${R.esc(link)}</a></p><p>Tip: open de link op je telefoon, zet hem op je beginscherm en tik op <em>Meldingen aanzetten</em>. Deel de link niet met anderen.</p></div>`;
      const r = await sendEmails(fetchFn, mailCfg(), [{ to: person.email, toName: person.naam, subject: `Je persoonlijke roosterlink${settings.org ? ' van ' + settings.org : ''}`, text, html }]);
      if (r.errors.length) throw new HttpError(502, r.errors[0].error);
      return reply(200, { ok: true });
    }

    if (p === '/meetings' && m === 'POST') {
      const b = await body();
      if (!isDate(b.datum)) throw new HttpError(400, 'Kies een datum.');
      const titel = str(b.titel, 120); if (!titel) throw new HttpError(400, 'Geef de bijeenkomst een naam.');
      const known = new Set((await store.listPeople()).map((x) => x.id)); const seen = new Set();
      const inzet = (Array.isArray(b.inzet) ? b.inzet : []).map((i) => ({ rol: str(i.rol, 40), persoonId: String(i.persoonId) }))
        .filter((i) => i.rol && known.has(i.persoonId) && !seen.has(i.rol + '|' + i.persoonId) && seen.add(i.rol + '|' + i.persoonId));
      const fields = { datum: b.datum, start: isTime(b.start) ? b.start : '', eind: isTime(b.eind) ? b.eind : '', titel, locatie: str(b.locatie, 120), notitie: str(b.notitie, 500) };
      const existing = b.id ? await store.getMeeting(String(b.id)) : null;
      if (existing) await store.saveMeetings([{ ...existing, ...fields, inzet }]);
      else {
        const list = [{ id: randHex(8), ...fields, inzet }];
        const extra = Math.max(0, Math.min(52, Number(b.herhaal) || 0)); // extra weken, zonder bezetting
        for (let i = 1; i <= extra; i++) list.push({ id: randHex(8), ...fields, datum: R.addDays(b.datum, 7 * i), inzet: [] });
        await store.saveMeetings(list);
      }
      return reply(200, await adminState());
    }
    if ((mm = p.match(/^\/meetings\/(\w+)$/)) && m === 'DELETE') { await store.deleteMeeting(mm[1]); return reply(200, await adminState()); }
    if ((mm = p.match(/^\/meetings\/(\w+)\/send$/)) && m === 'POST') {
      const mt = await store.getMeeting(mm[1]); if (!mt) throw new HttpError(404, 'Onbekend.');
      const result = await sendOverview({ from: mt.datum, to: mt.datum, meetingId: mt.id, type: 'dagrooster' });
      return reply(200, { result, ...(await adminState()) });
    }

    if (p === '/preview' && m === 'GET') {
      const today = local().date;
      const [settings, people, meetings] = await Promise.all([loadSettings(), store.listPeople(), store.listMeetings({ from: today, to: R.addDays(today, 6) })]);
      const db = { settings, people, meetings }; const ov = R.buildOverview(db, today, R.addDays(today, 6));
      const rostered = R.rosteredIds(ov);
      const targets = people.filter((x) => settings.ontvangers === 'iedereen' || rostered.has(x.id));
      const sample = targets[0] || { id: '', naam: '…', token: '' };
      return reply(200, { mail: ov.days.length ? R.renderMail(db, ov, sample) : null, voor: sample.naam, ontvangers: targets.map((x) => ({ naam: x.naam, email: Boolean(x.email), push: (x.push || []).length > 0 })) });
    }
    if (p === '/send-week' && m === 'POST') {
      const today = local().date;
      const result = await sendOverview({ from: today, to: R.addDays(today, 6), type: 'handmatig' });
      return reply(200, { result, ...(await adminState()) });
    }
    if (p === '/test-mail' && m === 'POST') {
      const b = await body(); const to = str(b.to, 254);
      if (!validAddress(to)) throw new HttpError(400, 'Dit e-mailadres klopt niet.');
      if (!mailConfigured(mailCfg())) throw new HttpError(502, 'E-mail is niet ingesteld (RESEND_API_KEY en MAIL_FROM).');
      const r = await sendEmails(fetchFn, mailCfg(), [{ to, subject: 'Testmail van Roosterpost', text: 'Het versturen van e-mail werkt.', html: '<p>Het versturen van e-mail werkt.</p>' }]);
      if (r.errors.length) throw new HttpError(502, r.errors[0].error);
      return reply(200, { ok: true });
    }
    if (p === '/export' && m === 'GET') {
      const [settings, people, meetings] = await Promise.all([loadSettings(), store.listPeople(), store.listMeetings()]);
      return reply(200, { exportedAt: now().toISOString(), settings, people: people.map(({ id, naam, email, rollen, token }) => ({ id, naam, email, rollen, token })), meetings });
    }
    throw new HttpError(404, 'Onbekend adres.');
  }

  function corsHeaders(req) {
    const allowed = [];
    try { if (E('FRONTEND_URL')) allowed.push(new URL(E('FRONTEND_URL')).origin); } catch { /* ongeldige waarde */ }
    for (const o of E('ALLOWED_ORIGINS').split(',').map((x) => x.trim()).filter(Boolean)) allowed.push(o);
    const origin = req.headers.get('origin') || '';
    const allow = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : '*';
    return {
      'Access-Control-Allow-Origin': allow, Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-cron-secret',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400',
    };
  }

  return async function handle(req) {
    const cors = corsHeaders(req);
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(req.url);
      // De functienaam hoort bij het pad: /functions/v1/api/state of /api/state → /state
      const p = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/api(?=\/|$)/, '') || '/';
      return await route(req, p, url, reply);
    } catch (e) {
      if (e instanceof HttpError) return reply(e.status, { error: e.message });
      console.error(e);
      return reply(500, { error: 'Er ging iets mis op de server.' });
    }
  };
}
