// Opslag in het geheugen met dezelfde methoden als store.js (voor tests en de lokale demo).
export function createMemStore() {
  const kv = new Map(), people = new Map(), meetings = new Map(), sessions = new Map(), claims = new Set();
  let log = [], fails = [];
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  return {
    async getKv(k) { return kv.has(k) ? clone(kv.get(k)) : null; },
    async setKv(k, v) { kv.set(k, clone(v)); },
    async listPeople() { return [...people.values()].map(clone).sort((a, b) => a.naam.localeCompare(b.naam)); },
    async getPersonByToken(t) { const p = [...people.values()].find((x) => x.token === t); return p ? clone(p) : null; },
    async savePerson(p) { people.set(p.id, clone(p)); },
    async deletePerson(id) { people.delete(id); },
    async listMeetings({ from, to } = {}) {
      return [...meetings.values()].filter((m) => (!from || m.datum >= from) && (!to || m.datum <= to)).map(clone)
        .sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));
    },
    async getMeeting(id) { return meetings.has(id) ? clone(meetings.get(id)) : null; },
    async saveMeetings(list) { for (const m of list) meetings.set(m.id, clone(m)); },
    async deleteMeeting(id) { meetings.delete(id); },
    async addLog(e) { log.push(clone(e)); },
    async listLog(n) { return log.slice(-n).reverse().map(clone); },
    async pruneLog(beforeIso) { log = log.filter((e) => e.ts >= beforeIso); },
    async createSession(h, exp) { sessions.set(h, exp); },
    async sessionValid(h, now) { return (sessions.get(h) || 0) > now; },
    async deleteSession(h) { sessions.delete(h); },
    async pruneSessions(now) { for (const [h, e] of sessions) if (e <= now) sessions.delete(h); },
    async addFail(ip, ts) { fails.push({ ip, ts }); },
    async countFails(ip, since) { return fails.filter((f) => f.ip === ip && f.ts >= since).length; },
    async clearFails(ip) { fails = fails.filter((f) => f.ip !== ip); },
    async pruneFails(before) { fails = fails.filter((f) => f.ts >= before); },
    async claimWeekly(d) { if (claims.has(d)) return false; claims.add(d); return true; },
    async releaseWeekly(d) { claims.delete(d); },
    async hasWeekly(d) { return claims.has(d); },
  };
}
