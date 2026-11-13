'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app'), dlg = $('#dlg');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = String((window.ROOSTERPOST || {}).api || '').replace(/\/+$/, '');
const TOKEN = (new URLSearchParams(location.search).get('p') || '').match(/^[0-9a-f]{32}$/)?.[0];
// Beheersessie: token in localStorage (de API staat op een ander domein, dus geen cookie).
const store = { get() { try { return localStorage.getItem('rp-sessie') || ''; } catch { return window.__rp || ''; } }, set(v) { try { v ? localStorage.setItem('rp-sessie', v) : localStorage.removeItem('rp-sessie'); } catch { window.__rp = v; } } };
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const fmtDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const tijd = (m) => (m.start ? m.start + (m.eind ? '–' + m.eind : '') : '');
const HOME = (location.origin + location.pathname.replace(/[^/]*$/, '')).replace(/\/+$/, '');
const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const dparts = (s) => { const d = new Date(s + 'T00:00:00Z'); return { wd: DAGEN[d.getUTCDay()], n: d.getUTCDate(), mon: MAAND[d.getUTCMonth()], dow: d.getUTCDay() }; };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MARK = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#2343c4"/><rect x="13" y="15" width="38" height="36" rx="7" fill="#fff"/><rect x="13" y="15" width="38" height="11" rx="5.5" fill="#f2b01e"/><rect x="13" y="21" width="38" height="5" fill="#f2b01e"/><circle cx="23" cy="34" r="3.4" fill="#2343c4"/><circle cx="32" cy="34" r="3.4" fill="#2343c4"/><circle cx="41" cy="34" r="3.4" fill="#2343c4"/><circle cx="23" cy="43" r="3.4" fill="#2343c4"/><circle cx="32" cy="43" r="2.6" fill="none" stroke="#f2b01e" stroke-width="1.6" stroke-dasharray="2.2 1.6"/></svg>';
const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  rooster: ico('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  mensen: ico('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/>'),
  versturen: ico('<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3z"/>'),
  instellingen: ico('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
};
let S = null; // beheerstatus van de server
let showPast = false;

async function api(method, url, body) {
  if (!API) throw new Error('config.js ontbreekt of heeft geen api-adres.');
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (!TOKEN && store.get()) headers.Authorization = 'Bearer ' + store.get();
  let r;
  try { r = await fetch(API + url.replace(/^\/api/, ''), { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Geen verbinding met de server. Controleer je internet en probeer het opnieuw.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Er ging iets mis. Probeer het opnieuw.'), { status: r.status });
  return j;
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500); }
async function run(btn, fn) { // knop blokkeren tijdens een actie en fouten tonen
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { if (e.status === 401 && !TOKEN) { store.set(''); return loginView(); } toast(e.message); } finally { if (btn) btn.disabled = false; }
}
function merge(j) { S = { ...S, ...j }; }

// ---------- datumblad, weekstrook, bijeenkomstkaart ----------
function dateLeaf(date, today) {
  const p = dparts(date); const diff = dayDiff(today, date);
  return `<header class="date"><span class="wd">${p.wd}</span><span class="num">${p.n}</span><span class="mon">${p.mon}</span>${diff === 0 ? '<span class="rel">vandaag</span>' : diff === 1 ? '<span class="rel">morgen</span>' : ''}</header>`;
}
// marks: datum → lijst van 'ok' | 'open' | 'other' (één stip per bijeenkomst)
function weekStrip(today, marks, legend) {
  let h = '<nav class="week" aria-label="Komende twee weken">';
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i); const p = dparts(d); const ms = marks[d] || [];
    const inner = `<span class="wd">${p.wd.slice(0, 2)}</span><span class="n">${p.n}</span><span class="dots">${ms.slice(0, 4).map((k) => `<i class="dot ${k}"></i>`).join('')}</span>`;
    const label = `${p.wd} ${p.n} ${p.mon}, ${ms.length === 1 ? '1 bijeenkomst' : ms.length + ' bijeenkomsten'}`;
    h += ms.length ? `<a href="#d-${d}" data-jump="${d}" class="${i === 0 ? 'now' : ''}" aria-label="${label}">${inner}</a>` : `<span class="rest ${i === 0 ? 'now' : ''}">${inner}</span>`;
  }
  return h + `</nav><p class="legend">${legend}</p>`;
}
function wireJumps(root) {
  root.addEventListener('click', (e) => { const a = e.target.closest('[data-jump]'); if (!a) return; e.preventDefault(); const t = document.getElementById('d-' + a.dataset.jump); if (t) t.scrollIntoView({ block: 'start' }); });
}
function fillHtml(rows) {
  const open = rows.reduce((n, r) => n + r.tekort, 0); const filled = rows.reduce((n, r) => n + r.mensen.length, 0);
  if (!rows.length) return '';
  const segs = filled + open <= 12 ? `<span class="segs">${'<i></i>'.repeat(filled)}${'<i class="o"></i>'.repeat(open)}</span>` : '';
  return `<div class="fill ${open ? 'warn' : 'ok'}">${open ? `${open} ${open === 1 ? 'plek' : 'plekken'} open` : 'Compleet'}${segs}</div>`;
}
function whenHtml(m) { return m.start ? `<div class="when">${esc(m.start)}${m.eind ? `<span>tot ${esc(m.eind)}</span>` : ''}</div>` : '<div class="when"></div>'; }

// ---------- rollen per bijeenkomst ----------
function rolesFor(m) {
  const names = S.settings.rollen.map((r) => r.naam);
  for (const i of m.inzet || []) if (!names.includes(i.rol)) names.push(i.rol);
  return names.map((naam) => {
    const nodig = (S.settings.rollen.find((r) => r.naam === naam) || {}).nodig || 0;
    const mensen = (m.inzet || []).filter((i) => i.rol === naam).map((i) => S.people.find((p) => p.id === i.persoonId)).filter(Boolean);
    return { rol: naam, nodig, mensen, tekort: Math.max(0, nodig - mensen.length) };
  }).filter((r) => r.nodig > 0 || r.mensen.length);
}
function rolesHtml(rows, meId, editId) {
  if (!rows.length) return '<p class="note">Nog geen rollen ingevuld.</p>';
  // Een open plek is in beheer een knop die de bijeenkomst opent; op de persoonlijke pagina alleen een aanduiding.
  const seat = editId ? `<button class="seat" data-act="edit" data-id="${editId}">open plek</button>` : '<span class="seat">open plek</span>';
  return '<dl class="roles">' + rows.map((r) => `<div><dt>${esc(r.rol)}</dt><dd>${r.mensen.map((p) => `<span class="chip${p.id === meId ? ' me' : ''}">${esc(p.naam)}</span>`).join('')}${seat.repeat(Math.min(r.tekort, 8))}</dd></div>`).join('') + '</dl>';
}

// ---------- beheer ----------
function loginView() {
  document.body.classList.remove('has-tabs');
  app.innerHTML = `<form class="login" id="login"><div class="panel">${MARK}<h1>Roosterpost</h1><p class="muted">Log in als coördinator. Heb je een persoonlijke link gekregen? Open dan die link.</p>
    <div class="field"><label for="pw">Beheerwachtwoord</label><input type="password" id="pw" autocomplete="current-password" required></div>
    <button class="btn primary" id="login-btn">Inloggen</button></div></form>`;
  $('#login').addEventListener('submit', (e) => { e.preventDefault(); run($('#login-btn'), async () => { const j = await api('POST', '/api/login', { password: $('#pw').value }); store.set(j.token); await boot(); }); });
}

const TABS = [['rooster', 'Rooster'], ['mensen', 'Mensen'], ['versturen', 'Versturen'], ['instellingen', 'Instellingen']];
function shell() {
  const tab = TABS.some((t) => '#' + t[0] === location.hash) ? location.hash.slice(1) : 'rooster';
  document.body.classList.add('has-tabs');
  app.innerHTML = `<header class="top"><div class="inner"><a class="brand" href="#rooster">${MARK}<span><b>Rooster</b>${S.settings.org ? ` <i>${esc(S.settings.org)}</i>` : ''}</span></a>
    <nav class="tabs" aria-label="Onderdelen">${TABS.map(([k, l]) => `<a href="#${k}" ${k === tab ? 'aria-current="page"' : ''}>${ICONS[k]}<span>${l}</span></a>`).join('')}</nav></div></header>
    <main class="wrap" id="view"></main>`;
  ({ rooster: viewRooster, mensen: viewMensen, versturen: viewVersturen, instellingen: viewInstellingen })[tab]();
}

function viewRooster() {
  const v = $('#view');
  const list = S.meetings.filter((m) => showPast || m.datum >= S.today).sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));
  const marks = {};
  for (const m of S.meetings) if (m.datum >= S.today) (marks[m.datum] = marks[m.datum] || []).push(rolesFor(m).some((r) => r.tekort) ? 'open' : 'ok');
  let html = weekStrip(S.today, marks, '<span><i class="dot"></i>compleet</span><span><i class="dot open"></i>nog plekken open</span>');
  html += `<div class="bar"><button class="btn primary" data-act="new">Nieuwe bijeenkomst</button><button class="btn" data-act="import">Importeren uit Excel</button>
    <label class="check small"><input type="checkbox" id="past" ${showPast ? 'checked' : ''}> Toon ook voorbije</label></div>`;
  if (!S.people.length) html += `<div class="callout">Begin bij <a href="#mensen">Mensen</a>: voeg de leiding, oppas en EHBO'ers toe. Daarna rooster je ze hier in.</div>`;
  if (!list.length) html += `<p class="empty">Er staan nog geen bijeenkomsten gepland. Maak de eerste met de knop hierboven.</p>`;
  let cur = '';
  for (const m of list) {
    if (m.datum !== cur) { if (cur) html += '</div></section>'; cur = m.datum; html += `<section class="day" id="d-${m.datum}">${dateLeaf(m.datum, S.today)}<div class="meets">`; }
    const rows = rolesFor(m);
    html += `<article class="card"><header>${whenHtml(m)}<div><h3>${esc(m.titel)}</h3>${m.locatie ? `<div class="where">${esc(m.locatie)}</div>` : ''}</div>${fillHtml(rows)}</header>
      ${rolesHtml(rows, null, m.id)}${m.notitie ? `<p class="note">Let op: ${esc(m.notitie)}</p>` : ''}
      <footer><button class="btn quiet" data-act="edit" data-id="${m.id}">Bewerken</button><button class="btn quiet" data-act="send" data-id="${m.id}">Mail dit dagrooster</button></footer></article>`;
  }
  if (cur) html += '</div></section>';
  v.innerHTML = html;
  wireJumps(v);
  $('#past').addEventListener('change', (e) => { showPast = e.target.checked; shell(); });
  v.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'new') return meetingDialog(null);
    if (b.dataset.act === 'import') return importDialog();
    const m = S.meetings.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === 'edit') return meetingDialog(m);
    if (b.dataset.act === 'send') {
      if (!confirm(`Het rooster van ${fmtDate(m.datum)} (${m.titel}) nu naar alle ingeroosterde mensen sturen?`)) return;
      run(b, async () => { const j = await api('POST', `/api/meetings/${m.id}/send`); merge(j); toast(resultText(j.result)); });
    }
  });
}
function resultText(r) {
  if (r.skipped) return 'Niets verstuurd: geen bijeenkomsten in deze periode.';
  return `${r.mails} mail${r.mails === 1 ? '' : 's'} en ${r.push} melding${r.push === 1 ? '' : 'en'} verstuurd` + (r.fouten.length ? `, ${r.fouten.length} probleem. Kijk bij Versturen.` : '.');
}

function meetingDialog(m) {
  const d = m ? JSON.parse(JSON.stringify(m)) : { datum: S.today, start: '', eind: '', titel: '', locatie: '', notitie: '', inzet: [] };
  const names = () => { const n = S.settings.rollen.map((r) => r.naam); for (const i of d.inzet) if (!n.includes(i.rol)) n.push(i.rol); return n; };
  const inzetHtml = () => names().map((rol) => {
    const ids = d.inzet.filter((i) => i.rol === rol).map((i) => i.persoonId);
    const first = S.people.filter((p) => !ids.includes(p.id) && (p.rollen || []).includes(rol));
    const rest = S.people.filter((p) => !ids.includes(p.id) && !(p.rollen || []).includes(rol));
    const opt = (p) => `<option value="${p.id}">${esc(p.naam)}</option>`;
    return `<div class="field"><span class="label">${esc(rol)}</span><div style="display:flex;flex-wrap:wrap;gap:6px">${ids.map((pid) => { const p = S.people.find((x) => x.id === pid); return p ? `<span class="chip">${esc(p.naam)}<button type="button" aria-label="${esc(p.naam)} weghalen" data-rm="${esc(rol)}|${pid}">×</button></span>` : ''; }).join('')}</div>
      <select data-add="${esc(rol)}" aria-label="Iemand toevoegen als ${esc(rol)}"><option value="">Iemand toevoegen…</option>${first.map(opt).join('')}${rest.length ? `<optgroup label="Anderen">${rest.map(opt).join('')}</optgroup>` : ''}</select></div>`;
  }).join('');
  dlg.innerHTML = `<form class="body" id="mf"><h2>${m ? 'Bijeenkomst bewerken' : 'Nieuwe bijeenkomst'}</h2>
    <div class="field"><label for="m-titel">Naam</label><input type="text" id="m-titel" value="${esc(d.titel)}" placeholder="Bijv. Opkomst welpen" required maxlength="120"></div>
    <div class="field"><label for="m-datum">Datum</label><input type="date" id="m-datum" value="${esc(d.datum)}" required></div>
    <div class="grid2"><div class="field"><label for="m-start">Begin</label><input type="time" id="m-start" value="${esc(d.start)}"></div>
    <div class="field"><label for="m-eind">Einde</label><input type="time" id="m-eind" value="${esc(d.eind)}"></div></div>
    <div class="field"><label for="m-loc">Locatie</label><input type="text" id="m-loc" value="${esc(d.locatie)}" maxlength="120"></div>
    <div class="field"><label for="m-not">Opmerking voor iedereen</label><textarea id="m-not" maxlength="500">${esc(d.notitie)}</textarea></div>
    ${m ? '' : `<div class="field"><label for="m-herh">Wekelijks herhalen</label><select id="m-herh"><option value="0">Niet herhalen</option>${[4, 8, 12, 26, 52].map((n) => `<option value="${n - 1}">${n} weken achter elkaar</option>`).join('')}</select></div>`}
    <h2 class="sub">Wie is er ingeroosterd?</h2><div id="inzet">${inzetHtml()}</div>
    <div class="actions"><div>${m ? '<button type="button" class="btn danger" id="m-del">Verwijderen</button>' : ''}</div>
    <div style="display:flex;gap:8px"><button type="button" class="btn" id="m-cancel">Annuleren</button><button class="btn primary" id="m-save">Opslaan</button></div></div></form>`;
  const box = $('#inzet');
  box.addEventListener('change', (e) => { const rol = e.target.dataset.add; if (rol && e.target.value) { d.inzet.push({ rol, persoonId: e.target.value }); box.innerHTML = inzetHtml(); } });
  box.addEventListener('click', (e) => { const rm = e.target.dataset.rm; if (!rm) return; const [rol, pid] = rm.split('|'); d.inzet = d.inzet.filter((i) => !(i.rol === rol && i.persoonId === pid)); box.innerHTML = inzetHtml(); });
  $('#m-cancel').onclick = () => dlg.close();
  if (m) $('#m-del').onclick = (e) => { if (confirm('Deze bijeenkomst verwijderen?')) run(e.target, async () => { merge(await api('DELETE', `/api/meetings/${m.id}`)); dlg.close(); shell(); }); };
  $('#mf').addEventListener('submit', (e) => {
    e.preventDefault();
    run($('#m-save'), async () => {
      merge(await api('POST', '/api/meetings', { id: d.id, titel: $('#m-titel').value, datum: $('#m-datum').value, start: $('#m-start').value, eind: $('#m-eind').value, locatie: $('#m-loc').value, notitie: $('#m-not').value, inzet: d.inzet, herhaal: m ? 0 : Number($('#m-herh').value) }));
      dlg.close(); shell(); toast('Opgeslagen.');
    });
  });
  dlg.showModal();
}

// ---------- importeren uit Excel ----------
const nkey = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
// Vergelijkt het bestand met wat er al staat en bepaalt wat er nieuw is of wijzigt. Er wordt nooit iets verwijderd.
function importPlan(data) {
  const fouten = [...data.fouten]; const byName = new Map(S.people.map((p) => [nkey(p.naam), p]));
  const people = []; const inFile = new Map(); let zelfde = 0;
  for (const m of data.mensen) {
    const k = nkey(m.naam);
    if (inFile.has(k)) { fouten.push(`Mensen, rij ${m.rij}: ${m.naam} staat er twee keer in. De tweede is overgeslagen.`); continue; }
    const ex = byName.get(k); let item;
    if (!ex) item = { soort: 'nieuw', naam: m.naam, email: m.email, rollen: m.rollen };
    else {
      const email = m.email || ex.email || ''; const rollen = m.rollen.length ? m.rollen : (ex.rollen || []);
      if (email !== (ex.email || '') || rollen.join('|') !== (ex.rollen || []).join('|')) item = { soort: 'wijzig', id: ex.id, naam: ex.naam, email, rollen }; else zelfde++;
    }
    inFile.set(k, item || null); if (item) people.push(item);
  }
  const uitRooster = [];
  for (const mt of data.rooster) for (const i of mt.inzet) {
    const k = nkey(i.naam); if (byName.has(k)) continue;
    let item = inFile.get(k);
    if (item === undefined) { item = { soort: 'nieuw', naam: i.naam, email: '', rollen: [], uitRooster: true }; inFile.set(k, item); people.push(item); uitRooster.push(i.naam); }
    if (item && item.uitRooster && !item.rollen.includes(i.rol)) item.rollen.push(i.rol);
  }
  const meetings = []; const seen = new Set(); let zelfdeM = 0;
  for (const mt of data.rooster) {
    const k = `${mt.datum}|${mt.start}|${nkey(mt.titel)}`;
    if (seen.has(k)) { fouten.push(`Rooster, rij ${mt.rij}: ${mt.titel} op ${mt.datum} staat er twee keer in. De tweede is overgeslagen.`); continue; }
    seen.add(k);
    const ex = S.meetings.find((x) => x.datum === mt.datum && (x.start || '') === mt.start && nkey(x.titel) === nkey(mt.titel));
    if (ex) { // precies gelijk aan wat er al staat? Dan hoeft er niets te gebeuren.
      const sig = (list) => list.map((x) => nkey(x.rol) + '|' + x.n).sort().join(';');
      const cur = sig((ex.inzet || []).map((i) => ({ rol: i.rol, n: nkey((S.people.find((q) => q.id === i.persoonId) || {}).naam) })));
      if (cur === sig(mt.inzet.map((i) => ({ rol: i.rol, n: nkey(i.naam) }))) && (ex.eind || '') === mt.eind && (ex.locatie || '') === mt.locatie && (ex.notitie || '') === mt.notitie && ex.titel === mt.titel) { zelfdeM++; continue; }
    }
    meetings.push({ ...mt, id: ex ? ex.id : undefined, soort: ex ? 'wijzig' : 'nieuw' });
  }
  const bekend = S.settings.rollen.map((r) => nkey(r.naam));
  const nieuweRollen = [...new Set(data.rooster.flatMap((m) => m.inzet.map((i) => i.rol)))].filter((r) => !bekend.includes(nkey(r)));
  return { people, meetings, fouten, uitRooster, nieuweRollen, zelfde, zelfdeM };
}
function importDialog() {
  const cnt = (list, soort) => list.filter((x) => x.soort === soort).length;
  const start = () => {
    dlg.innerHTML = `<div class="body"><h2>Importeren uit Excel</h2>
      <p>Vul het sjabloon in met je bijeenkomsten en mensen en kies het bestand hieronder. Je ziet eerst wat er gaat gebeuren; pas daarna wordt er iets opgeslagen.</p>
      <p style="margin:14px 0"><a class="btn" href="rooster-sjabloon.xlsx" download>Sjabloon downloaden</a></p>
      <div class="field"><label for="imp-file">Ingevuld Excel-bestand (.xlsx)</label><input type="file" id="imp-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>
      <div id="imp-msg" role="status"></div>
      <div class="actions"><span></span><button type="button" class="btn" id="imp-cancel">Sluiten</button></div></div>`;
    $('#imp-cancel').onclick = () => dlg.close();
    $('#imp-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return; const msg = $('#imp-msg');
      try {
        if (f.size > 5e6) throw new Error('Dit bestand is groter dan 5 MB. Gebruik het sjabloon met alleen het rooster.');
        const rolNaam = (h) => { const r = S.settings.rollen.find((x) => nkey(x.naam) === nkey(h)); return r ? r.naam : String(h).trim(); };
        const data = RoosterImport.parseWorkbook(await RoosterImport.readXlsx(await f.arrayBuffer()), rolNaam);
        preview(importPlan(data), f.name);
      } catch (err) { msg.innerHTML = `<div class="callout warn">${esc(err.message)}</div>`; }
    });
  };
  const preview = (plan, fileName) => {
    const np = cnt(plan.people, 'nieuw'), wp = cnt(plan.people, 'wijzig'), nm = cnt(plan.meetings, 'nieuw'), wm = cnt(plan.meetings, 'wijzig');
    const total = plan.people.length + plan.meetings.length;
    const dates = plan.meetings.map((m) => m.datum).sort();
    dlg.innerHTML = `<div class="body"><h2>Controleer de import</h2><p class="muted small" style="margin-bottom:12px">${esc(fileName)}</p>
      ${total ? `<div class="panel"><p><strong>${nm} nieuwe ${nm === 1 ? 'bijeenkomst' : 'bijeenkomsten'}</strong>${wm ? `, ${wm} bestaande ${wm === 1 ? 'wordt' : 'worden'} bijgewerkt` : ''}${dates.length ? `<br><span class="muted small">van ${esc(fmtDate(dates[0]))} t/m ${esc(fmtDate(dates[dates.length - 1]))}</span>` : ''}${plan.zelfdeM ? `<br><span class="muted small">${plan.zelfdeM} ${plan.zelfdeM === 1 ? 'bijeenkomst staat' : 'bijeenkomsten staan'} er al precies zo in</span>` : ''}</p>
        <p style="margin-top:10px"><strong>${np} ${np === 1 ? 'nieuwe persoon' : 'nieuwe mensen'}</strong>${wp ? `, ${wp} bestaande ${wp === 1 ? 'wordt' : 'worden'} bijgewerkt` : ''}${plan.zelfde ? `<br><span class="muted small">${plan.zelfde} ${plan.zelfde === 1 ? 'persoon staat' : 'mensen staan'} er al precies zo in</span>` : ''}</p></div>` : `<div class="callout${plan.zelfde + plan.zelfdeM ? '' : ' warn'}">${plan.zelfde + plan.zelfdeM ? 'Alles uit dit bestand staat er al in. Er valt niets te importeren.' : 'Er staat niets in dit bestand om te importeren.'}</div>`}
      ${wm ? `<div class="callout">Bij een bestaande bijeenkomst vervangt de bezetting uit het bestand de huidige bezetting.</div>` : ''}
      ${plan.uitRooster.length ? `<div class="callout warn"><strong>Nieuw via het rooster, zonder e-mailadres:</strong> ${plan.uitRooster.map(esc).join(', ')}.<br><span class="small">Is dit een tikfout in een bestaande naam? Sluit dan, pas het bestand aan en kies het opnieuw.</span></div>` : ''}
      ${plan.nieuweRollen.length ? `<div class="callout">Deze rollen staan nog niet bij Instellingen: ${plan.nieuweRollen.map(esc).join(', ')}. Ze worden wel bij de bijeenkomst getoond.</div>` : ''}
      ${plan.fouten.length ? `<div class="callout warn"><strong>${plan.fouten.length} ${plan.fouten.length === 1 ? 'opmerking' : 'opmerkingen'}</strong><ul>${plan.fouten.slice(0, 12).map((f) => `<li>${esc(f)}</li>`).join('')}${plan.fouten.length > 12 ? `<li>en nog ${plan.fouten.length - 12} meer</li>` : ''}</ul></div>` : ''}
      <div id="imp-msg" role="status"></div>
      <div class="actions"><button type="button" class="btn" id="imp-back">Ander bestand</button><div style="display:flex;gap:8px"><button type="button" class="btn" id="imp-cancel">Annuleren</button><button type="button" class="btn primary" id="imp-go" ${total ? '' : 'disabled'}>Importeren</button></div></div></div>`;
    $('#imp-back').onclick = start; $('#imp-cancel').onclick = () => dlg.close();
    $('#imp-go').onclick = async () => {
      const msg = $('#imp-msg'); let done = 0; let bezig = '';
      for (const b of dlg.querySelectorAll('button')) b.disabled = true;
      const tick = () => { msg.innerHTML = `<div class="callout">Bezig met importeren: ${done} van ${total}…</div>`; };
      try {
        tick();
        for (const p of plan.people) { bezig = p.naam; merge(await api('POST', '/api/people', { id: p.id, naam: p.naam, email: p.email, rollen: p.rollen })); done++; tick(); }
        const ids = new Map(S.people.map((p) => [nkey(p.naam), p.id]));
        for (const m of plan.meetings) {
          bezig = `${m.titel} (${m.datum})`;
          const inzet = m.inzet.map((i) => ({ rol: i.rol, persoonId: ids.get(nkey(i.naam)) })).filter((i) => i.persoonId);
          merge(await api('POST', '/api/meetings', { id: m.id, titel: m.titel, datum: m.datum, start: m.start, eind: m.eind, locatie: m.locatie, notitie: m.notitie, inzet, herhaal: 0 }));
          done++; tick();
        }
        dlg.close(); shell(); toast(`Geïmporteerd: ${plan.meetings.length} ${plan.meetings.length === 1 ? 'bijeenkomst' : 'bijeenkomsten'} en ${plan.people.length} ${plan.people.length === 1 ? 'persoon' : 'mensen'}.`);
      } catch (err) {
        if (err.status === 401) { dlg.close(); store.set(''); return loginView(); }
        msg.innerHTML = `<div class="callout warn"><strong>Gestopt bij ${esc(bezig)}:</strong> ${esc(err.message)}<br>${done} van ${total} zijn wel opgeslagen. Je kunt hetzelfde bestand opnieuw importeren; wat er al staat wordt niet dubbel aangemaakt.</div>`;
        $('#imp-cancel').disabled = false; $('#imp-cancel').textContent = 'Sluiten'; $('#imp-cancel').onclick = () => { dlg.close(); shell(); };
      }
    };
  };
  start(); dlg.showModal();
}

function viewMensen() {
  const v = $('#view');
  v.innerHTML = `<div class="bar"><button class="btn primary" id="p-new">Persoon toevoegen</button><span class="muted small">${S.people.length} ${S.people.length === 1 ? 'persoon' : 'mensen'}</span></div>` +
    (S.people.length ? `<div class="list">${S.people.map((p) => `<button class="row" data-id="${p.id}"><span class="avatar" aria-hidden="true">${esc((p.naam.trim()[0] || '?').toUpperCase())}</span><span><strong>${esc(p.naam)}</strong><br><span class="small ${p.email ? 'muted' : 'open'}">${esc(p.email || 'geen e-mailadres')}</span></span>
      <span class="tags">${(p.rollen || []).map((r) => `<span class="tag">${esc(r)}</span>`).join('')}${p.pushCount ? '<span class="tag on">meldingen aan</span>' : ''}</span></button>`).join('')}</div>`
      : `<p class="empty">Nog niemand toegevoegd. Iedereen krijgt een eigen link naar het rooster; een account of wachtwoord is niet nodig.</p>`);
  $('#p-new').onclick = () => personDialog(null);
  v.addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) personDialog(S.people.find((p) => p.id === r.dataset.id)); });
}
function personDialog(p) {
  const d = p || { naam: '', email: '', rollen: [] };
  const link = p ? `${(S.settings.baseUrl || HOME).replace(/\/+$/, '')}/?p=${p.token}` : '';
  dlg.innerHTML = `<form class="body" id="pf"><h2>${p ? esc(p.naam) : 'Persoon toevoegen'}</h2>
    <div class="field"><label for="p-naam">Naam</label><input type="text" id="p-naam" value="${esc(d.naam)}" required maxlength="80" autocomplete="off"></div>
    <div class="field"><label for="p-email">E-mailadres</label><input type="email" id="p-email" value="${esc(d.email)}" maxlength="254" autocomplete="off"></div>
    <div class="field"><span class="label">Kan worden ingezet als</span>${S.settings.rollen.map((r, i) => `<label class="check"><input type="checkbox" id="p-rol-${i}" value="${esc(r.naam)}" ${d.rollen.includes(r.naam) ? 'checked' : ''}> ${esc(r.naam)}</label>`).join('')}</div>
    ${p ? `<div class="panel"><span class="label">Persoonlijke link</span><p class="small" style="word-break:break-all;margin:4px 0 8px">${esc(link)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="p-copy">Link kopiëren</button><button type="button" class="btn" id="p-invite">Link mailen</button><button type="button" class="btn" id="p-newlink">Nieuwe link maken</button></div></div>` : ''}
    <div class="actions"><div>${p ? '<button type="button" class="btn danger" id="p-del">Verwijderen</button>' : ''}</div>
    <div style="display:flex;gap:8px"><button type="button" class="btn" id="p-cancel">Annuleren</button><button class="btn primary" id="p-save">Opslaan</button></div></div></form>`;
  $('#p-cancel').onclick = () => dlg.close();
  if (p) {
    $('#p-copy').onclick = () => navigator.clipboard.writeText(link).then(() => toast('Link gekopieerd.'), () => toast('Kopiëren lukt niet. Selecteer de link met de hand.'));
    $('#p-invite').onclick = (e) => run(e.target, async () => { await api('POST', `/api/people/${p.id}/invite`); toast(`Link gemaild naar ${p.email}.`); });
    $('#p-newlink').onclick = (e) => { if (confirm('De oude link werkt daarna niet meer en meldingen moeten opnieuw worden aangezet. Doorgaan?')) run(e.target, async () => { merge(await api('POST', `/api/people/${p.id}/newlink`)); dlg.close(); shell(); toast('Nieuwe link gemaakt.'); }); };
    $('#p-del').onclick = (e) => { if (confirm(`${p.naam} verwijderen? Ook de inroosteringen vervallen.`)) run(e.target, async () => { merge(await api('DELETE', `/api/people/${p.id}`)); dlg.close(); shell(); }); };
  }
  $('#pf').addEventListener('submit', (e) => {
    e.preventDefault();
    run($('#p-save'), async () => {
      const rollen = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      merge(await api('POST', '/api/people', { id: d.id, naam: $('#p-naam').value, email: $('#p-email').value, rollen }));
      dlg.close(); shell(); toast('Opgeslagen.');
    });
  });
  dlg.showModal();
}

async function viewVersturen() {
  const v = $('#view'); const s = S.settings;
  v.innerHTML = `${S.mail.configured ? '' : `<div class="callout warn"><strong>E-mail is nog niet ingesteld.</strong> Zet RESEND_API_KEY en MAIL_FROM bij de secrets van de functie in Supabase. Tot die tijd gaan alleen pushmeldingen de deur uit.</div>`}
    ${(() => { const t = S.health && S.health.lastTick ? Date.parse(S.health.lastTick) : 0; const oud = !t || Date.now() - t > 45 * 60000;
      return `<div class="callout${oud ? ' warn' : ''}">${oud ? '<strong>Let op:</strong> de planner heeft zich ' + (t ? 'al meer dan 45 minuten' : 'nog niet') + ' gemeld. Controleer of het Supabase-project niet is gepauzeerd en of cron.sql is uitgevoerd.' : 'Planner actief, laatste controle ' + new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + '.'}</div>`; })()}
    <div class="callout">${S.next ? `Volgende automatische verzending: <strong>${esc(S.next)}</strong>.` : 'De wekelijkse verzending staat <strong>uit</strong>.'}
      <br><span class="small">Elke ${DAGEN[s.weekdag]} om ${esc(s.tijd)} krijgt ${s.ontvangers === 'iedereen' ? 'iedereen' : 'iedereen die is ingeroosterd'} het overzicht van de 7 dagen erna. <a href="#instellingen">Aanpassen</a></span></div>
    <div class="panel"><h2>Rooster komende 7 dagen</h2><div id="pv"><p class="muted">Voorbeeld laden…</p></div></div>
    <div class="panel"><h2>Laatste verzendingen</h2>${S.log.length ? `<ul class="log">${S.log.map((l) => `<li><strong>${new Date(l.ts).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}</strong> · ${esc(l.type)}<br>${esc(l.onderwerp)} · ${l.mails} mail${l.mails === 1 ? '' : 's'}, ${l.push} melding${l.push === 1 ? '' : 'en'}${(l.fouten || []).map((f) => `<div class="err">${esc(f)}</div>`).join('')}</li>`).join('')}</ul>` : '<p class="muted">Er is nog niets verstuurd.</p>'}</div>`;
  try {
    const j = await api('GET', '/api/preview'); const pv = $('#pv'); if (!pv) return;
    if (!j.mail) { pv.innerHTML = '<p class="muted">De komende 7 dagen staan er geen bijeenkomsten. Er wordt dan niets verstuurd.</p>'; return; }
    pv.innerHTML = `<p class="small muted">${j.ontvangers.length} ontvanger${j.ontvangers.length === 1 ? '' : 's'}: ${j.ontvangers.map((o) => esc(o.naam) + (o.email ? '' : ' (geen e-mail)')).join(', ') || 'niemand'}</p>
      <p class="small"><strong>Onderwerp:</strong> ${esc(j.mail.subject)} <span class="muted">· voorbeeld zoals ${esc(j.voor)} het krijgt</span></p>
      <iframe class="preview" sandbox="" title="Voorbeeld van de mail"></iframe>
      <div style="margin-top:10px"><button class="btn primary" id="send-now">Nu versturen</button></div>`;
    $('iframe', pv).srcdoc = `<!DOCTYPE html><meta charset="utf-8"><body style="margin:12px;background:#fff">${j.mail.html}`;
    $('#send-now').onclick = (e) => { if (confirm(`Het rooster nu naar ${j.ontvangers.length} mensen sturen?`)) run(e.target, async () => { const r = await api('POST', '/api/send-week'); merge(r); toast(resultText(r.result)); shell(); }); };
  } catch (e) { toast(e.message); }
}

function viewInstellingen() {
  const v = $('#view'); const s = S.settings; let rollen = s.rollen.map((r) => ({ ...r }));
  const rolHtml = () => rollen.map((r, i) => `<div class="rolerow"><input type="text" id="r-naam-${i}" data-i="${i}" data-k="naam" value="${esc(r.naam)}" aria-label="Naam van de rol" maxlength="40"><input type="number" id="r-nodig-${i}" data-i="${i}" data-k="nodig" value="${r.nodig}" min="0" max="50" aria-label="Aantal nodig per bijeenkomst"><button type="button" class="btn" data-del="${i}" aria-label="Rol ${esc(r.naam)} verwijderen">×</button></div>`).join('');
  v.innerHTML = `<form id="sf">
    <div class="panel"><h2>Organisatie</h2>
      <div class="field"><label for="s-org">Naam</label><input type="text" id="s-org" value="${esc(s.org)}" maxlength="80" placeholder="Bijv. Scouting De Markvallei"></div>
      <div class="field"><label for="s-base">Webadres van deze app</label><input type="url" id="s-base" value="${esc(s.baseUrl || HOME)}" placeholder="https://rooster.voorbeeld.nl"><span class="small muted">Komt in de mails te staan als link naar het persoonlijke rooster.</span></div></div>
    <div class="panel"><h2>Rollen</h2><p class="small muted">Naam en hoeveel mensen er per bijeenkomst nodig zijn. Bij 0 verschijnt de rol alleen als er iemand is ingevuld.</p>
      <div id="rollen">${rolHtml()}</div><button type="button" class="btn" id="r-add">Rol toevoegen</button></div>
    <div class="panel"><h2>Wekelijkse herinnering</h2>
      <label class="check"><input type="checkbox" id="s-actief" ${s.actief ? 'checked' : ''}> Elke week automatisch versturen</label>
      <div class="grid2"><div class="field"><label for="s-dag">Dag</label><select id="s-dag">${DAGEN.map((d, i) => `<option value="${i}" ${i === s.weekdag ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label for="s-tijd">Tijd</label><input type="time" id="s-tijd" value="${esc(s.tijd)}" required></div></div>
      <div class="field"><label for="s-ontv">Wie krijgt het overzicht?</label><select id="s-ontv"><option value="ingeroosterd" ${s.ontvangers !== 'iedereen' ? 'selected' : ''}>Alleen wie die week is ingeroosterd</option><option value="iedereen" ${s.ontvangers === 'iedereen' ? 'selected' : ''}>Iedereen op de lijst</option></select></div>
      <p class="small muted">Tijdzone ${esc(S.tz)}. Het overzicht loopt van de verzenddag tot en met zes dagen later.</p></div>
    <div class="actions"><button type="button" class="btn" id="logout">Uitloggen</button><button class="btn primary" id="s-save">Instellingen opslaan</button></div></form>
    <div class="panel" style="margin-top:14px"><h2>E-mail testen</h2><p class="small muted">${S.mail.configured ? `Verstuurt via Resend als ${esc(S.mail.from)}.` : 'E-mail is nog niet ingesteld: zet RESEND_API_KEY en MAIL_FROM bij de secrets van de functie in Supabase.'}</p>
      <form id="tf" class="grid2"><input type="email" id="t-to" placeholder="jouw@adres.nl" aria-label="E-mailadres voor de testmail" required><button class="btn" id="t-send">Testmail sturen</button></form></div>`;
  const box = $('#rollen');
  box.addEventListener('input', (e) => { const { i, k } = e.target.dataset; if (i !== undefined) rollen[i][k] = k === 'nodig' ? Number(e.target.value) : e.target.value; });
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { rollen.splice(Number(b.dataset.del), 1); box.innerHTML = rolHtml(); } });
  $('#r-add').onclick = () => { rollen.push({ naam: '', nodig: 1 }); box.innerHTML = rolHtml(); $(`#r-naam-${rollen.length - 1}`).focus(); };
  $('#sf').addEventListener('submit', (e) => {
    e.preventDefault();
    run($('#s-save'), async () => {
      merge(await api('PUT', '/api/settings', { org: $('#s-org').value, baseUrl: $('#s-base').value, rollen, actief: $('#s-actief').checked, weekdag: Number($('#s-dag').value), tijd: $('#s-tijd').value, ontvangers: $('#s-ontv').value }));
      shell(); toast('Instellingen opgeslagen.');
    });
  });
  $('#tf').addEventListener('submit', (e) => { e.preventDefault(); run($('#t-send'), async () => { await api('POST', '/api/test-mail', { to: $('#t-to').value }); toast('Testmail verstuurd. Kijk in je inbox.'); }); });
  $('#logout').onclick = (e) => run(e.target, async () => { try { await api('POST', '/api/logout'); } catch { /* sessie wordt hoe dan ook gewist */ } store.set(''); loginView(); });
}

// ---------- persoonlijke pagina ----------
async function personView() {
  let me;
  try { me = await api('GET', `/api/me?t=${TOKEN}`); } catch (e) { app.innerHTML = `<div class="wrap"><div class="callout warn">${esc(e.message)}</div></div>`; return; }
  document.title = `Rooster ${me.org || ''}`.trim();
  try { // eigen manifest, zodat de app vanaf het beginscherm direct op deze persoonlijke pagina opent
    const base = new URL('./', location.href).href;
    const mf = { name: `Rooster ${me.org || ''}`.trim(), short_name: 'Rooster', start_url: location.href, scope: base, display: 'standalone', background_color: '#f2f4fa', theme_color: '#f2f4fa', icons: [{ src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }] };
    document.querySelector('link[rel=manifest]').href = URL.createObjectURL(new Blob([JSON.stringify(mf)], { type: 'application/manifest+json' }));
  } catch { /* geen manifest is niet erg */ }
  const today = localToday(); const next = me.mine[0];
  const lower = (r) => (r === r.toUpperCase() ? r : r[0].toLowerCase() + r.slice(1));
  const andList = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1] : a[0]);
  const marks = {};
  for (const d of me.days) marks[d.date] = d.meetings.map((m) => (m.rollen.some((r) => r.mensen.some((p) => p.id === me.id)) ? 'ok' : 'other'));
  let html = `<header class="top"><div class="inner"><span class="brand">${MARK}<span><b>Rooster</b>${me.org ? ` <i>${esc(me.org)}</i>` : ''}</span></span><span class="muted">Hoi ${esc(me.naam.split(' ')[0])}</span></div></header><main class="wrap">`;
  if (next) {
    const diff = dayDiff(today, next.date); const p = dparts(next.date);
    const rel = diff <= 0 ? 'Vandaag' : diff === 1 ? 'Morgen' : diff < 7 ? `${p.wd[0].toUpperCase() + p.wd.slice(1)}` : `Over ${diff} dagen`;
    html += `<section class="hero"><h2>${rel} ben jij ${esc(andList(next.rollen.map(lower)))}</h2>
      <p class="what">${esc(next.titel)}</p><p class="meta">${p.wd} ${p.n} ${p.mon}${next.tijd ? ', ' + esc(next.tijd) : ''}${next.locatie ? ' · ' + esc(next.locatie) : ''}</p>
      ${me.mine.length > 1 ? `<ul class="later">${me.mine.slice(1, 6).map((x) => { const q = dparts(x.date); return `<li><b>${q.wd.slice(0, 2)} ${q.n} ${q.mon.slice(0, 3)}</b><span>${esc(x.rollen.join(', '))} bij ${esc(x.titel)}${x.tijd ? ', ' + esc(x.tijd.split('–')[0]) : ''}</span></li>`; }).join('')}</ul>` : ''}
      <button class="btn" id="ics">Zet ${me.mine.length === 1 ? 'deze beurt' : `mijn ${me.mine.length} beurten`} in mijn agenda</button></section>`;
  } else {
    html += `<section class="hero none"><h2>Je bent de komende tijd vrij</h2><p class="muted">Zodra je wordt ingeroosterd, zie je het hier en krijg je bericht.</p></section>`;
  }
  html += '<div id="push"></div><h2 class="section-title">Het hele rooster</h2>';
  if (!me.days.length) html += '<p class="empty">Er staan nog geen bijeenkomsten gepland.</p>';
  else html += weekStrip(today, marks, '<span><i class="dot"></i>jij bent ingeroosterd</span><span><i class="dot other"></i>bijeenkomst zonder jou</span>');
  for (const d of me.days) {
    html += `<section class="day" id="d-${d.date}">${dateLeaf(d.date, today)}<div class="meets">`;
    for (const m of d.meetings) {
      const mine = m.rollen.some((r) => r.mensen.some((p) => p.id === me.id));
      html += `<article class="card${mine ? ' mine' : ''}"><header>${whenHtml(m)}<div><h3>${esc(m.titel)}</h3>${m.locatie ? `<div class="where">${esc(m.locatie)}</div>` : ''}</div>${fillHtml(m.rollen)}</header>${rolesHtml(m.rollen, me.id)}${m.notitie ? `<p class="note">Let op: ${esc(m.notitie)}</p>` : ''}</article>`;
    }
    html += '</div></section>';
  }
  app.innerHTML = html + '</main>';
  wireJumps(app);
  if ($('#ics')) $('#ics').onclick = () => downloadIcs(me);
  pushBox(me);
}

// Agendabestand (.ics) met de eigen beurten; tijden zonder tijdzone = lokale tijd van het toestel.
function downloadIcs(me) {
  const e = (t) => String(t || '').replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Roosterpost//NL', 'CALSCALE:GREGORIAN'];
  me.mine.forEach((x, i) => {
    const d = x.date.replace(/-/g, ''); const [a, b] = (x.tijd || '').split('–').map((t) => t.replace(':', ''));
    L.push('BEGIN:VEVENT', `UID:${d}-${i}-${me.id}@roosterpost`, `DTSTAMP:${stamp}`);
    if (a) { L.push(`DTSTART:${d}T${a}00`); L.push(b ? `DTEND:${d}T${b}00` : 'DURATION:PT1H'); } else L.push(`DTSTART;VALUE=DATE:${d}`);
    L.push(`SUMMARY:${e(x.rollen.join(', ') + ': ' + x.titel)}`); if (x.locatie) L.push(`LOCATION:${e(x.locatie)}`);
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' })); a.download = 'rooster.ics';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function pushBox(me) {
  const box = $('#push');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent); const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!supported) {
    box.innerHTML = ios && !standalone ? `<div class="panel small"><strong>Meldingen op je iPhone</strong><br>Tik in Safari op Deel en kies 'Zet op beginscherm'. Open het rooster daarna vanaf je beginscherm en zet de meldingen aan.</div>` : '';
    return;
  }
  const reg = await navigator.serviceWorker.register('./sw.js');
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    box.innerHTML = `<p class="small muted">Meldingen staan aan op dit apparaat. <button class="btn link" id="push-off">Uitzetten</button></p>`;
    $('#push-off').onclick = (e) => run(e.target, async () => { await api('POST', '/api/push/unsubscribe', { t: TOKEN, endpoint: sub.endpoint }); await sub.unsubscribe(); pushBox(me); });
    return;
  }
  if (Notification.permission === 'denied') { box.innerHTML = `<p class="small muted">Meldingen zijn in deze browser geblokkeerd. Je kunt dat aanpassen bij de site-instellingen.</p>`; return; }
  box.innerHTML = `<div class="panel"><strong>Herinnering op je telefoon?</strong><p class="small muted" style="margin:4px 0 10px">Je krijgt dan elke week een melding met je rooster.</p><button class="btn primary" id="push-on">Meldingen aanzetten</button></div>`;
  $('#push-on').onclick = (e) => run(e.target, async () => {
    if ((await Notification.requestPermission()) !== 'granted') return pushBox(me);
    const key = Uint8Array.from(atob(me.vapidKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('POST', '/api/push/subscribe', { t: TOKEN, subscription: s.toJSON() });
    toast('Meldingen staan aan.'); pushBox(me);
  });
}

// ---------- start ----------
async function boot() {
  if (TOKEN) return personView();
  try { S = await api('GET', '/api/state'); } catch (e) { if (e.status === 401) { store.set(''); return loginView(); } app.innerHTML = `<div class="wrap"><div class="callout warn">${esc(e.message)}</div></div>`; return; }
  shell();
}
window.addEventListener('hashchange', () => { if (S && !TOKEN) shell(); });
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
boot();
