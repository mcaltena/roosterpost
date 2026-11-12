// Opslag in Supabase Postgres via supabase-js. De client wordt van buiten aangereikt (zie api/index.ts).
const unwrap = ({ data, error }) => {
  if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  return data;
};
const rowToPerson = (r) => ({ id: r.id, naam: r.naam, email: r.email || '', rollen: r.rollen || [], token: r.token, push: r.push || [] });
const personToRow = (p) => ({ id: p.id, naam: p.naam, email: p.email || '', rollen: p.rollen || [], token: p.token, push: p.push || [] });
const rowToMeeting = (r) => ({ id: r.id, datum: r.datum, start: r.start_tijd || '', eind: r.eind_tijd || '', titel: r.titel, locatie: r.locatie || '', notitie: r.notitie || '', inzet: r.inzet || [] });
const meetingToRow = (m) => ({ id: m.id, datum: m.datum, start_tijd: m.start || '', eind_tijd: m.eind || '', titel: m.titel, locatie: m.locatie || '', notitie: m.notitie || '', inzet: m.inzet || [] });

export function createSupabaseStore(sb) {
  return {
    async getKv(key) { const r = unwrap(await sb.from('kv').select('value').eq('key', key).maybeSingle()); return r ? r.value : null; },
    async setKv(key, value) { unwrap(await sb.from('kv').upsert({ key, value }, { onConflict: 'key' })); },

    async listPeople() { return unwrap(await sb.from('people').select('*').order('naam')).map(rowToPerson); },
    async getPersonByToken(token) { const r = unwrap(await sb.from('people').select('*').eq('token', token).maybeSingle()); return r ? rowToPerson(r) : null; },
    async savePerson(p) { unwrap(await sb.from('people').upsert(personToRow(p), { onConflict: 'id' })); },
    async deletePerson(id) { unwrap(await sb.from('people').delete().eq('id', id)); },

    async listMeetings({ from, to } = {}) {
      let q = sb.from('meetings').select('*').order('datum').order('start_tijd');
      if (from) q = q.gte('datum', from);
      if (to) q = q.lte('datum', to);
      return unwrap(await q).map(rowToMeeting);
    },
    async getMeeting(id) { const r = unwrap(await sb.from('meetings').select('*').eq('id', id).maybeSingle()); return r ? rowToMeeting(r) : null; },
    async saveMeetings(list) { if (list.length) unwrap(await sb.from('meetings').upsert(list.map(meetingToRow), { onConflict: 'id' })); },
    async deleteMeeting(id) { unwrap(await sb.from('meetings').delete().eq('id', id)); },

    async addLog(entry) { unwrap(await sb.from('log').insert({ entry })); },
    async listLog(n) { return unwrap(await sb.from('log').select('entry').order('ts', { ascending: false }).limit(n)).map((r) => r.entry); },
    async pruneLog(beforeIso) { unwrap(await sb.from('log').delete().lt('ts', beforeIso)); },

    async createSession(hash, expMs) { unwrap(await sb.from('sessions').insert({ hash, exp: new Date(expMs).toISOString() })); },
    async sessionValid(hash, nowMs) { const r = unwrap(await sb.from('sessions').select('exp').eq('hash', hash).maybeSingle()); return Boolean(r && Date.parse(r.exp) > nowMs); },
    async deleteSession(hash) { unwrap(await sb.from('sessions').delete().eq('hash', hash)); },
    async pruneSessions(nowMs) { unwrap(await sb.from('sessions').delete().lt('exp', new Date(nowMs).toISOString())); },

    async addFail(ip, nowMs) { unwrap(await sb.from('fails').insert({ ip, ts: new Date(nowMs).toISOString() })); },
    async countFails(ip, sinceMs) {
      const { count, error } = await sb.from('fails').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('ts', new Date(sinceMs).toISOString());
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async clearFails(ip) { unwrap(await sb.from('fails').delete().eq('ip', ip)); },
    async pruneFails(beforeMs) { unwrap(await sb.from('fails').delete().lt('ts', new Date(beforeMs).toISOString())); },

    // Atomisch: de primaire sleutel zorgt dat maar één aanroep de verzending van een dag binnenhaalt.
    async claimWeekly(datum) {
      const { error } = await sb.from('weekly_claims').insert({ datum });
      if (!error) return true;
      if (error.code === '23505') return false;
      throw new Error(error.message);
    },
    async releaseWeekly(datum) { unwrap(await sb.from('weekly_claims').delete().eq('datum', datum)); },
    async hasWeekly(datum) { return Boolean(unwrap(await sb.from('weekly_claims').select('datum').eq('datum', datum).maybeSingle())); },
  };
}
