// Datumhulpjes en het opbouwen van het dagoverzicht + de mailtekst.
export const DEFAULT_TZ = 'Europe/Amsterdam';
export const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (s, n) => { const d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const weekdayOf = (s) => toUTC(s).getUTCDay();
export const fmtDate = (s) => { const d = toUTC(s); return `${DAGEN[d.getUTCDay()]} ${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]}`; };
export const fmtShort = (s) => { const d = toUTC(s); return `${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]}`; };

export function nowParts(d = new Date(), tz = DEFAULT_TZ) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: weekdayOf(date) };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const personLink = (base, token) => (base && token ? `${String(base).replace(/\/+$/, '')}/?p=${token}` : '');
const tijd = (m) => (m.start ? m.start + (m.eind ? '–' + m.eind : '') : '');

// Eén overzicht per dag van iedereen die is ingeroosterd, gegroepeerd per bijeenkomst en rol.
export function buildOverview(db, from, to, onlyMeetingId) {
  const byId = new Map(db.people.map((p) => [p.id, p]));
  const rollen = db.settings.rollen;
  const meetings = db.meetings
    .filter((m) => (onlyMeetingId ? m.id === onlyMeetingId : m.datum >= from && m.datum <= to))
    .sort((a, b) => (a.datum + (a.start || '')).localeCompare(b.datum + (b.start || '')));
  const days = [];
  for (const m of meetings) {
    const names = [...rollen.map((r) => r.naam)];
    for (const i of m.inzet || []) if (!names.includes(i.rol)) names.push(i.rol);
    const rows = names.map((naam) => {
      const nodig = (rollen.find((r) => r.naam === naam) || {}).nodig || 0;
      const mensen = (m.inzet || []).filter((i) => i.rol === naam && byId.has(i.persoonId))
        .map((i) => ({ id: i.persoonId, naam: byId.get(i.persoonId).naam }));
      return { rol: naam, nodig, mensen, tekort: Math.max(0, nodig - mensen.length) };
    }).filter((r) => r.nodig > 0 || r.mensen.length > 0);
    let day = days[days.length - 1];
    if (!day || day.date !== m.datum) { day = { date: m.datum, label: fmtDate(m.datum), meetings: [] }; days.push(day); }
    day.meetings.push({ id: m.id, titel: m.titel, start: m.start, eind: m.eind, tijd: tijd(m), locatie: m.locatie, notitie: m.notitie, rollen: rows });
  }
  return { from, to, days };
}

export function rosteredIds(ov) {
  const s = new Set();
  for (const d of ov.days) for (const m of d.meetings) for (const r of m.rollen) for (const p of r.mensen) s.add(p.id);
  return s;
}

export function mine(ov, personId) {
  const out = [];
  for (const d of ov.days) for (const m of d.meetings) {
    const rs = m.rollen.filter((r) => r.mensen.some((p) => p.id === personId)).map((r) => r.rol);
    if (rs.length) out.push({ date: d.date, label: d.label, tijd: m.tijd, titel: m.titel, locatie: m.locatie, rollen: rs });
  }
  return out;
}

function subjectFor(db, ov, single) {
  const org = db.settings.org ? `${db.settings.org}: ` : '';
  if (single && ov.days[0]) return `${org}rooster ${ov.days[0].label}`;
  return `${org}rooster ${fmtShort(ov.from)} t/m ${fmtShort(ov.to)}`;
}

export function renderMail(db, ov, person, single) {
  const base = db.settings.baseUrl || '';
  const link = personLink(base, person.token);
  const my = mine(ov, person.id);
  const subject = subjectFor(db, ov, single);
  const intro = single ? 'Hieronder het rooster voor deze dag.' : `Hieronder het rooster van ${fmtShort(ov.from)} t/m ${fmtShort(ov.to)}.`;

  // Platte tekst
  const t = [`Hoi ${person.naam},`, '', intro, ''];
  if (my.length) {
    t.push('Jij bent ingeroosterd:');
    for (const x of my) t.push(`- ${x.label}${x.tijd ? ', ' + x.tijd : ''} ${x.titel}: ${x.rollen.join(', ')}`);
    t.push('');
  }
  for (const d of ov.days) {
    t.push(d.label.toUpperCase());
    for (const m of d.meetings) {
      t.push(`${m.tijd ? m.tijd + ' ' : ''}${m.titel}${m.locatie ? ' (' + m.locatie + ')' : ''}`);
      for (const r of m.rollen) {
        const wie = r.mensen.map((p) => p.naam).join(', ') || 'nog niemand';
        t.push(`  ${r.rol}: ${wie}${r.tekort ? ` (nog ${r.tekort} nodig)` : ''}`);
      }
      if (m.notitie) t.push(`  Let op: ${m.notitie}`);
      t.push('');
    }
  }
  if (link) t.push(`Je persoonlijke rooster: ${link}`, '');
  t.push('Kun je niet? Laat het de coördinator zo snel mogelijk weten.');

  // HTML
  const h = [];
  h.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#17231f;max-width:600px">`);
  h.push(`<p>Hoi ${esc(person.naam)},</p><p>${esc(intro)}</p>`);
  if (my.length) {
    h.push(`<div style="background:#e6f2ef;border-left:4px solid #0f6b5c;padding:10px 14px;margin:0 0 18px"><strong>Jij bent ingeroosterd</strong><br>`);
    h.push(my.map((x) => `${esc(x.label)}${x.tijd ? ', ' + esc(x.tijd) : ''} · ${esc(x.titel)}: <strong>${esc(x.rollen.join(', '))}</strong>`).join('<br>'));
    h.push(`</div>`);
  }
  for (const d of ov.days) {
    h.push(`<h2 style="font-size:16px;margin:22px 0 6px;border-bottom:2px solid #17231f;padding-bottom:4px">${esc(d.label[0].toUpperCase() + d.label.slice(1))}</h2>`);
    for (const m of d.meetings) {
      h.push(`<p style="margin:10px 0 4px"><strong>${m.tijd ? esc(m.tijd) + ' · ' : ''}${esc(m.titel)}</strong>${m.locatie ? ` <span style="color:#5b6a65">· ${esc(m.locatie)}</span>` : ''}</p>`);
      h.push(`<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:15px">`);
      for (const r of m.rollen) {
        const wie = r.mensen.map((p) => (p.id === person.id ? `<strong>${esc(p.naam)}</strong>` : esc(p.naam))).join(', ') || '<span style="color:#b45309">nog niemand</span>';
        const tk = r.tekort ? ` <span style="color:#b45309">(nog ${r.tekort} nodig)</span>` : '';
        h.push(`<tr><td style="padding:4px 12px 4px 0;vertical-align:top;color:#5b6a65;width:110px;border-top:1px solid #dfe5e2">${esc(r.rol)}</td><td style="padding:4px 0;border-top:1px solid #dfe5e2">${wie}${tk}</td></tr>`);
      }
      h.push(`</table>`);
      if (m.notitie) h.push(`<p style="margin:6px 0 0;color:#5b6a65">Let op: ${esc(m.notitie)}</p>`);
    }
  }
  if (link) h.push(`<p style="margin-top:22px"><a href="${esc(link)}" style="color:#0f6b5c">Open je persoonlijke rooster</a></p>`);
  h.push(`<p style="color:#5b6a65">Kun je niet? Laat het de coördinator zo snel mogelijk weten.</p></div>`);
  return { subject, text: t.join('\n'), html: h.join('') };
}

export function pushText(ov, person, single) {
  const my = mine(ov, person.id);
  if (!my.length) return { title: single ? 'Rooster bijgewerkt' : 'Rooster komende week', body: 'Bekijk wie er is ingeroosterd.' };
  const body = my.slice(0, 3).map((x) => `${x.label.slice(0, 2)} ${fmtShort(x.date)}${x.tijd ? ' ' + x.tijd.split('–')[0] : ''} ${x.rollen.join('/')} · ${x.titel}`).join('\n') + (my.length > 3 ? `\n+${my.length - 3} meer` : '');
  return { title: my.length === 1 ? 'Je bent ingeroosterd' : `Je bent ${my.length}× ingeroosterd`, body };
}
