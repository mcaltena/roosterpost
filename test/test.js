import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createHandler } from '../supabase/functions/_shared/handler.js';
import * as push from '../supabase/functions/_shared/push.js';
import { sendEmails } from '../supabase/functions/_shared/resend.js';
import { createMemStore } from './memstore.js';

let ok = 0;
const test = async (name, fn) => { try { await fn(); ok++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n', e); process.exitCode = 1; } };

// --- nep-wereld: klok, Resend, push-dienst ---
let clock = new Date('2026-11-16T05:50:00Z'); // maandag 06:50 Amsterdam (wintertijd)
const sent = []; const pushes = []; let resendFail = false;
const ENV = { ADMIN_PASSWORD: 'geheim', CRON_SECRET: 'cron', RESEND_API_KEY: 're_x', MAIL_FROM: 'Rooster <rooster@voorbeeld.nl>', FRONTEND_URL: 'https://mcaltena.github.io/roosterpost', TZ_NAME: 'Europe/Amsterdam' };
async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url.startsWith('https://api.resend.com/emails/batch')) {
    if (resendFail) return new Response(JSON.stringify({ message: 'boem' }), { status: 500 });
    const list = JSON.parse(init.body); sent.push(...list); return new Response(JSON.stringify({ data: list.map(() => ({ id: 'x' })) }), { status: 200 });
  }
  if (url.startsWith('https://api.resend.com/emails')) { const b = JSON.parse(init.body); sent.push(b); return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); }
  if (url.startsWith('https://fcm.googleapis.com/')) { pushes.push({ url, init }); return new Response(null, { status: url.endsWith('gone') ? 410 : 201 }); }
  throw new Error('onverwachte fetch ' + url);
}
const store = createMemStore();
const handle = createHandler({ store, env: (k) => ENV[k] || '', fetchFn: fakeFetch, now: () => clock });
const B = 'https://x.supabase.co/functions/v1/api';
async function call(method, path, { body, token, headers = {} } = {}) {
  const h = { ...headers }; if (body) h['content-type'] = 'application/json'; if (token) h.authorization = 'Bearer ' + token;
  const r = await handle(new Request(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, json: r.status === 204 ? null : await r.json(), headers: r.headers };
}

console.log('Roosterpost-tests');

await test('RFC 8291: voorbeeldvector geeft exact de gepubliceerde versleuteling', async () => {
  const asPriv = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const asPub = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
  const uaPub = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const want = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const pub = push.fromB64u(asPub);
  const jwk = { kty: 'EC', crv: 'P-256', x: push.b64u(pub.slice(1, 33)), y: push.b64u(pub.slice(33, 65)), d: asPriv };
  const privateKey = await webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await webcrypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const out = await push.encrypt('When I grow up, I want to be a watermelon', uaPub, 'BTBZMqHH6r4Tts7J_aSIgg', { asKeyPair: { privateKey, publicKey }, salt: push.fromB64u('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.equal(push.b64u(out), want);
});

await test('CORS-preflight en padvoorvoegsels', async () => {
  const r = await handle(new Request(B + '/state', { method: 'OPTIONS', headers: { origin: 'https://mcaltena.github.io' } }));
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://mcaltena.github.io');
  const a = await handle(new Request('https://x.supabase.co/api/', { method: 'GET' })); assert.equal(a.status, 200);
  assert.equal((await call('GET', '/')).status, 200);
});

let tok;
await test('inloggen: fout wachtwoord, rem na 5 pogingen, goed wachtwoord', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/login', { body: { password: 'nee' }, headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 401);
  assert.equal((await call('POST', '/login', { body: { password: 'geheim' }, headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 429);
  const r = await call('POST', '/login', { body: { password: 'geheim' }, headers: { 'x-forwarded-for': '5.6.7.8' } });
  assert.equal(r.status, 200); tok = r.json.token; assert.match(tok, /^[0-9a-f]{48}$/);
});
await test('beheer vereist een sessie', async () => {
  assert.equal((await call('GET', '/state')).status, 401);
  assert.equal((await call('GET', '/state', { token: 'x'.repeat(48) })).status, 401);
  assert.equal((await call('GET', '/state', { token: tok })).status, 200);
});

let ids = {};
await test('mensen en bijeenkomsten aanmaken, ongeldige invoer geweigerd', async () => {
  assert.equal((await call('POST', '/people', { token: tok, body: { naam: 'X', email: 'geen-mail' } })).status, 400);
  for (const [naam, email, rollen] of [['Anna', 'anna@voorbeeld.nl', ['Leiding']], ['Bram', 'bram@voorbeeld.nl', ['Oppas']], ['Carla', '', ['EHBO']], ['Dirk', 'dirk@voorbeeld.nl', ['Leiding']]]) {
    const r = await call('POST', '/people', { token: tok, body: { naam, email, rollen } }); assert.equal(r.status, 200);
  }
  const st = (await call('GET', '/state', { token: tok })).json;
  for (const p of st.people) ids[p.naam] = p.id; assert.equal(st.people.length, 4);
  assert.equal((await call('POST', '/meetings', { token: tok, body: { datum: 'ongeldig', titel: 'x' } })).status, 400);
  // twee bijeenkomsten op dezelfde dag (maandag 16 nov) + één later in de week
  const mk = (datum, start, titel, inzet) => call('POST', '/meetings', { token: tok, body: { datum, start, eind: '', titel, locatie: 'Zaal', notitie: '', inzet } });
  await mk('2026-11-16', '19:30', 'Repetitie', [{ rol: 'Leiding', persoonId: ids.Anna }, { rol: 'Oppas', persoonId: ids.Bram }]);
  await mk('2026-11-16', '10:00', 'Kinderdienst', [{ rol: 'EHBO', persoonId: ids.Carla }, { rol: 'Leiding', persoonId: ids.Anna }, { rol: 'Leiding', persoonId: 'bestaatniet' }]);
  await mk('2026-11-19', '20:00', 'Vergadering', [{ rol: 'Leiding', persoonId: ids.Dirk }]);
  const m = (await call('GET', '/state', { token: tok })).json.meetings;
  assert.equal(m.length, 3); assert.equal(m.find((x) => x.titel === 'Kinderdienst').inzet.length, 2);
});

await test('wekelijkse verzending: niet te vroeg, één keer, daarna overgeslagen', async () => {
  const tick = () => call('POST', '/cron/tick', { headers: { 'x-cron-secret': 'cron' } });
  assert.equal((await call('POST', '/cron/tick', { headers: { 'x-cron-secret': 'fout' } })).status, 401);
  let r = await tick(); assert.match(r.json.skipped, /nog niet bereikt/); assert.equal(sent.length, 0);
  clock = new Date('2026-11-16T06:15:00Z'); // 07:15 lokaal
  r = await tick(); assert.equal(r.status, 200); assert.equal(r.json.mails, 3); // Anna, Bram, Dirk; Carla heeft geen mailadres
  assert.deepEqual(sent.map((m) => m.to[0]).sort(), ['Anna <anna@voorbeeld.nl>', 'Bram <bram@voorbeeld.nl>', 'Dirk <dirk@voorbeeld.nl>'].map((x) => x).sort().map((x) => x));
  const anna = sent.find((m) => m.to[0].includes('anna'));
  assert.match(anna.text, /Kinderdienst/); assert.match(anna.text, /Repetitie/); assert.match(anna.text, /\?p=[0-9a-f]{32}/);
  clock = new Date('2026-11-16T06:30:00Z'); sent.length = 0;
  r = await tick(); assert.match(r.json.skipped, /al verzonden/); assert.equal(sent.length, 0);
});
await test('zomertijd: 07:00 lokaal = 05:00 UTC', async () => {
  const s2 = createMemStore(); const h2 = createHandler({ store: s2, env: (k) => ENV[k] || '', fetchFn: fakeFetch, now: () => new Date('2026-07-06T04:50:00Z') });
  const t = async () => (await (await h2(new Request(B + '/cron/tick', { method: 'POST', headers: { 'x-cron-secret': 'cron' } }))).json());
  assert.match((await t()).skipped, /nog niet bereikt/);
});
await test('Resend-batch faalt: terugval op losse mails; fouten komen in het logboek', async () => {
  resendFail = true; sent.length = 0;
  const r = await sendEmails(fakeFetch, { apiKey: 'k', from: 'a@b.nl' }, [{ to: 'a@b.nl', subject: 's', text: 't', html: 'h' }, { to: 'kapot', subject: 's', text: 't', html: 'h' }]);
  resendFail = false; assert.equal(r.sent, 1); assert.equal(r.errors.length, 1); assert.equal(sent.length, 1);
});

await test('persoonlijke pagina en push-abonnement', async () => {
  const st = (await call('GET', '/state', { token: tok })).json; const anna = st.people.find((p) => p.naam === 'Anna');
  assert.equal((await call('GET', '/me?t=' + 'a'.repeat(32))).status, 404);
  const me = (await call('GET', '/me?t=' + anna.token)).json; assert.equal(me.naam, 'Anna'); assert.ok(me.vapidKey); assert.equal(me.mine.length, 2);
  // echt abonnement genereren zodat de versleuteling echt draait
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: raw, auth: Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString('base64url') } };
  assert.equal((await call('POST', '/push/subscribe', { body: { t: anna.token, subscription: { endpoint: 'http://evil.example/x', keys: sub.keys } } })).status, 400);
  const r = await call('POST', '/push/subscribe', { body: { t: anna.token, subscription: sub } }); assert.equal(r.json.test, 'ok');
  assert.match(pushes.at(-1).init.headers.Authorization, /^vapid t=.+, k=.+$/i);
  assert.equal((await call('GET', '/state', { token: tok })).json.people.find((p) => p.naam === 'Anna').pushCount, 1);
  assert.ok(!JSON.stringify((await call('GET', '/state', { token: tok })).json).includes('fcm.googleapis.com'), 'endpoints horen niet naar de beheerder');
});

await test('persoon verwijderen haalt inzet weg; nieuwe link; export zonder push', async () => {
  const st = (await call('GET', '/state', { token: tok })).json; const anna = st.people.find((p) => p.naam === 'Anna');
  const nl = (await call('POST', `/people/${anna.id}/newlink`, { token: tok })).json.people.find((p) => p.id === anna.id);
  assert.notEqual(nl.token, anna.token); assert.equal(nl.pushCount, 0);
  const after = (await call('DELETE', `/people/${anna.id}`, { token: tok })).json;
  assert.ok(after.meetings.every((m) => m.inzet.every((i) => i.persoonId !== anna.id)));
  const ex = (await call('GET', '/export', { token: tok })).json; assert.ok(ex.people.length === 3 && !('push' in ex.people[0]));
});
await test('uitloggen maakt sessie ongeldig', async () => {
  assert.equal((await call('POST', '/logout', { token: tok })).status, 200);
  assert.equal((await call('GET', '/state', { token: tok })).status, 401);
});

console.log(`\n${ok} tests geslaagd${process.exitCode ? ', met fouten' : ''}`);
