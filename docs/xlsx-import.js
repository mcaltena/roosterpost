// Leest een .xlsx-bestand in de browser, zonder bibliotheek: een xlsx is een zip met XML-bestanden.
// Levert window.RoosterImport = { readXlsx, parseWorkbook }.
(function () {
  const td = new TextDecoder();
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Deze browser kan geen Excel-bestanden inlezen. Gebruik een recente versie van Chrome, Edge, Firefox of Safari.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf); const dv = new DataView(buf);
    const geen = 'Dit lijkt geen Excel-bestand (.xlsx). Sla het in Excel op als "Excel-werkmap (.xlsx)", zonder wachtwoord.';
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; // einde van de centrale inhoudsopgave
    if (e < 0) throw new Error(geen);
    const count = dv.getUint16(e + 10, true); let o = dv.getUint32(e + 16, true); const files = {};
    for (let i = 0; i < count && o + 46 <= u8.length; i++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break;
      const method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
      const nl = dv.getUint16(o + 28, true), el = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true);
      files[td.decode(u8.subarray(o + 46, o + 46 + nl))] = { method, csize, lo };
      o += 46 + nl + el + cl;
    }
    if (!files['xl/workbook.xml']) throw new Error(geen);
    return async function text(name) {
      const f = files[name]; if (!f) return null;
      const start = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true);
      const raw = u8.subarray(start, start + f.csize);
      if (f.method !== 0 && f.method !== 8) throw new Error('Dit Excel-bestand gebruikt een compressie die niet wordt ondersteund.');
      return td.decode(f.method === 0 ? raw : await inflate(raw));
    };
  }

  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const els = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
  const colIndex = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };

  // → [{ name, rows: [{ r: rijnummer, cells: [waarde per kolom] }] }]
  async function readXlsx(buf) {
    const text = await unzip(buf);
    const wb = xml(await text('xl/workbook.xml'));
    const relsText = await text('xl/_rels/workbook.xml.rels');
    const rel = {}; if (relsText) for (const r of els(xml(relsText), 'Relationship')) rel[r.getAttribute('Id')] = r.getAttribute('Target');
    const sstText = await text('xl/sharedStrings.xml');
    const strings = sstText ? els(xml(sstText), 'si').map((si) => els(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')) : [];
    const sheets = [];
    for (const s of els(wb, 'sheet')) {
      const target = rel[s.getAttributeNS(R_NS, 'id') || s.getAttribute('r:id')]; if (!target) continue;
      const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const body = await text(path); if (!body) continue;
      const rows = [];
      els(xml(body), 'row').forEach((row, ri) => {
        const cells = []; let next = 0;
        for (const c of els(row, 'c')) {
          const ref = c.getAttribute('r'); const col = ref ? colIndex(ref) : next; next = col + 1;
          const t = c.getAttribute('t'); const vEl = els(c, 'v')[0]; const v = vEl ? vEl.textContent : null;
          let val = '';
          if (t === 's') val = strings[Number(v)] ?? '';
          else if (t === 'inlineStr') val = els(c, 't').map((x) => x.textContent).join('');
          else if (t === 'str') val = v ?? '';
          else if (t === 'b') val = v === '1' ? 'ja' : 'nee';
          else if (t === 'e') val = '';
          else if (v !== null && v !== '') val = Number(v);
          if (col >= 0 && col < 200) cells[col] = val;
        }
        rows.push({ r: Number(row.getAttribute('r')) || ri + 1, cells });
      });
      sheets.push({ name: s.getAttribute('name') || '', rows });
    }
    return sheets;
  }

  // ---------- van tabbladen naar mensen en bijeenkomsten ----------
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const names = (v) => String(v ?? '').split(/[,;\n\/]+/).map(txt).filter(Boolean);

  function parseDate(v) {
    let y, m, d;
    if (typeof v === 'number') { // Excel telt dagen vanaf 30-12-1899
      if (v < 20000 || v > 80000) return null;
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    } else {
      const s = txt(v); let k;
      if ((k = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +k[1]; m = +k[2]; d = +k[3]; }
      else if ((k = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))) { d = +k[1]; m = +k[2]; y = +k[3]; if (y < 100) y += 2000; }
      else return null;
    }
    const chk = new Date(Date.UTC(y, m - 1, d));
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d || y < 2000 || y > 2100) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  function parseTime(v) { // '' = geen tijd, null = niet te lezen
    if (v === '' || v === undefined || v === null) return '';
    if (typeof v === 'number') { const min = Math.round((v % 1) * 1440) % 1440; return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
    const s = txt(v).toLowerCase().replace(/\s*uur$/, ''); let k;
    if ((k = s.match(/^(\d{1,2})[:.u](\d{2})(:\d{2})?$/)) || (k = s.match(/^(\d{1,2})()$/))) { const h = +k[1], mi = +(k[2] || 0); if (h < 24 && mi < 60) return `${pad(h)}:${pad(mi)}`; }
    return null;
  }

  function table(sheet) {
    const rows = sheet.rows.filter((r) => r.cells.some((c) => txt(c) !== ''));
    if (!rows.length) return null;
    return { headers: Array.from(rows[0].cells, (c) => txt(c)), rows: rows.slice(1) };
  }
  const H = {
    datum: ['datum', 'dag'], start: ['begin', 'start', 'van', 'begintijd', 'tijd', 'aanvang'], eind: ['einde', 'eind', 'tot', 'eindtijd'],
    titel: ['bijeenkomst', 'titel', 'activiteit', 'naam', 'omschrijving', 'dienst'], locatie: ['locatie', 'plaats', 'waar'], notitie: ['opmerking', 'opmerkingen', 'notitie', 'letop'],
    naam: ['naam', 'persoon'], email: ['email', 'emailadres', 'mail', 'mailadres'], rollen: ['rollen', 'rol', 'inzetbaarals', 'taken', 'taak'],
  };
  function columns(headers, keys) {
    const map = {}; const used = new Set();
    for (const k of keys) { const i = headers.findIndex((h, idx) => !used.has(idx) && H[k].includes(norm(h))); if (i >= 0) { map[k] = i; used.add(i); } }
    return { map, used };
  }

  // → { mensen, rooster, fouten }; rolNaam(kop) geeft de schrijfwijze van een bestaande rol terug.
  function parseWorkbook(sheets, rolNaam = (x) => x) {
    const out = { mensen: [], rooster: [], fouten: [] };
    let sRooster = sheets.find((s) => norm(s.name) === 'rooster'); let sMensen = sheets.find((s) => norm(s.name) === 'mensen');
    for (const s of sheets) { // tabbladen met een andere naam herkennen aan hun kopregel
      if (s === sRooster || s === sMensen || norm(s.name) === 'uitleg') continue;
      const t = table(s); if (!t) continue; const hs = t.headers.map(norm);
      if (!sRooster && hs.some((h) => H.datum.includes(h))) sRooster = s;
      else if (!sMensen && hs.some((h) => H.email.includes(h))) sMensen = s;
    }
    if (!sRooster && !sMensen) { out.fouten.push('Geen tabblad "Rooster" of "Mensen" gevonden. Gebruik het sjabloon.'); return out; }

    if (sMensen) {
      const t = table(sMensen);
      if (t) {
        const { map } = columns(t.headers, ['naam', 'email', 'rollen']);
        if (map.naam === undefined) out.fouten.push('Tabblad Mensen: de kolom "Naam" ontbreekt.');
        else for (const row of t.rows) {
          const naam = txt(row.cells[map.naam]); if (!naam || norm(naam).startsWith('voorbeeld')) continue;
          const email = map.email === undefined ? '' : txt(row.cells[map.email]).toLowerCase();
          if (email && !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) { out.fouten.push(`Mensen, rij ${row.r}: e-mailadres "${email}" klopt niet. ${naam} is overgeslagen.`); continue; }
          out.mensen.push({ rij: row.r, naam: naam.slice(0, 80), email, rollen: map.rollen === undefined ? [] : [...new Set(names(row.cells[map.rollen]).map(rolNaam))] });
        }
      }
    }
    if (sRooster) {
      const t = table(sRooster);
      if (t) {
        const { map, used } = columns(t.headers, ['datum', 'start', 'eind', 'titel', 'locatie', 'notitie']);
        const rolCols = t.headers.map((h, i) => ({ h, i })).filter((x) => x.h && !used.has(x.i)).map((x) => ({ i: x.i, rol: rolNaam(x.h).slice(0, 40) }));
        if (map.datum === undefined || map.titel === undefined) out.fouten.push('Tabblad Rooster: de kolommen "Datum" en "Bijeenkomst" zijn verplicht.');
        else for (const row of t.rows) {
          const titel = txt(row.cells[map.titel]); const rawDate = row.cells[map.datum];
          if (norm(titel).startsWith('voorbeeld')) continue;
          if (!titel && txt(rawDate) === '') continue;
          const datum = parseDate(rawDate);
          if (!datum) { out.fouten.push(`Rooster, rij ${row.r}: datum "${txt(rawDate)}" is niet te lezen. Rij overgeslagen.`); continue; }
          if (!titel) { out.fouten.push(`Rooster, rij ${row.r}: de naam van de bijeenkomst ontbreekt. Rij overgeslagen.`); continue; }
          const tm = (k) => (map[k] === undefined ? '' : parseTime(row.cells[map[k]]));
          let start = tm('start'), eind = tm('eind');
          if (start === null) { out.fouten.push(`Rooster, rij ${row.r}: begintijd "${txt(row.cells[map.start])}" is niet te lezen en is weggelaten.`); start = ''; }
          if (eind === null) { out.fouten.push(`Rooster, rij ${row.r}: eindtijd "${txt(row.cells[map.eind])}" is niet te lezen en is weggelaten.`); eind = ''; }
          const inzet = [];
          for (const rc of rolCols) for (const naam of names(row.cells[rc.i])) if (!inzet.some((x) => x.rol === rc.rol && norm(x.naam) === norm(naam))) inzet.push({ rol: rc.rol, naam: naam.slice(0, 80) });
          out.rooster.push({ rij: row.r, datum, start, eind, titel: titel.slice(0, 120), locatie: map.locatie === undefined ? '' : txt(row.cells[map.locatie]).slice(0, 120), notitie: map.notitie === undefined ? '' : txt(row.cells[map.notitie]).slice(0, 500), inzet });
        }
      }
    }
    return out;
  }

  window.RoosterImport = { readXlsx, parseWorkbook, parseDate, parseTime };
})();
