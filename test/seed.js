// Demo-gegevens voor de lokale server.
export async function seed(store) {
  const id = (n) => n.padEnd(16, '0');
  const people = [['anna', 'Anna de Vries', 'anna@voorbeeld.nl', ['Leiding']], ['bram', 'Bram Jansen', 'bram@voorbeeld.nl', ['Oppas']], ['carla', 'Carla Smit', 'carla@voorbeeld.nl', ['EHBO']], ['dirk', 'Dirk Bakker', 'dirk@voorbeeld.nl', ['Leiding', 'Oppas']]];
  for (const [k, naam, email, rollen] of people) await store.savePerson({ id: id(k), naam, email, rollen, token: k.padEnd(32, 'a').replace(/[^0-9a-f]/g, 'a'), push: [] });
  const d = new Date(); const iso = (n) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
  await store.setKv('settings', { org: 'HHG Veen', baseUrl: '', rollen: [{ naam: 'Leiding', nodig: 2 }, { naam: 'Oppas', nodig: 1 }, { naam: 'EHBO', nodig: 1 }], actief: true, weekdag: 1, tijd: '07:00', ontvangers: 'ingeroosterd' });
  await store.saveMeetings([
    { id: 'm1'.padEnd(16, '0'), datum: iso(1), start: '10:00', eind: '11:30', titel: 'Kinderdienst', locatie: 'Kerkzaal', notitie: '', inzet: [{ rol: 'Leiding', persoonId: id('anna') }, { rol: 'Oppas', persoonId: id('bram') }, { rol: 'EHBO', persoonId: id('carla') }] },
    { id: 'm2'.padEnd(16, '0'), datum: iso(1), start: '19:30', eind: '', titel: 'Repetitie', locatie: 'Gemeentehuis', notitie: 'Sleutel ophalen bij de koster', inzet: [{ rol: 'Leiding', persoonId: id('dirk') }] },
    { id: 'm3'.padEnd(16, '0'), datum: iso(4), start: '20:00', eind: '', titel: 'Vergadering', locatie: '', notitie: '', inzet: [{ rol: 'Leiding', persoonId: id('anna') }, { rol: 'Leiding', persoonId: id('dirk') }] },
  ]);
}
