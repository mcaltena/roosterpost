# Roosterpost

Roosters bijhouden voor HHGVeen: bijeenkomsten, wie er is ingeroosterd (leiding, oppas, EHBO, …) en een **wekelijkse mail en pushmelding met één overzicht per dag** naar iedereen die erbij betrokken is.

- **Frontend**: statische bestanden in `docs/` (GitHub Pages).
- **Backend**: Supabase Edge Function `api` + Postgres + `pg_cron` (elk kwartier een tik, de functie bepaalt zelf of het tijd is, in Amsterdamse tijd).
- **E-mail**: Resend. **Meldingen**: Web Push (VAPID), zonder extra dienst.
- Beheerders loggen in met één wachtwoord. Anderen krijgen een **persoonlijke link** (`…/?p=<token>`) voor hun eigen rooster en het aanzetten van meldingen.

## Installeren

1. **Supabase-project** (regio Europa). Installeer de [Supabase CLI](https://supabase.com/docs/guides/cli) en voer uit: `supabase link --project-ref <ref>` en `supabase db push` (maakt de tabellen uit `supabase/migrations`).
2. **Resend**: verifieer je eigen domein (afzender moet bij dat domein horen) en maak een API-sleutel. Gratis: 100 mails per dag, 3.000 per maand.
3. **Geheimen** instellen:
   ```
   supabase secrets set ADMIN_PASSWORD='kies-een-sterk-wachtwoord' \
     CRON_SECRET='lang-willekeurig-geheim' \
     RESEND_API_KEY='re_…' MAIL_FROM='Rooster HHGVeen <rooster@jouwdomein.nl>' \
     FRONTEND_URL='https://mcaltena.github.io/roosterpost'
   ```
   Optioneel: `MAIL_REPLY_TO`, `ALLOWED_ORIGINS` (komma-gescheiden), `TZ_NAME` (standaard Europe/Amsterdam).
4. **Functie uitrollen**: `supabase functions deploy api --no-verify-jwt`. (De functie controleert zelf wachtwoord, sessie of cron-geheim.)
5. **Planning**: open `supabase/cron.sql`, vul project-ref en hetzelfde `CRON_SECRET` in en voer het uit in de SQL Editor.
6. **Frontend**: zet in `docs/config.js` het adres `https://<ref>.supabase.co/functions/v1/api`. Zet in GitHub *Settings → Pages* de bron op branch `main`, map `/docs`.
7. Open de site, log in, vul bij *Instellingen* het webadres in, en stuur een testmail.

## Lokaal proberen

```
npm test       # tests (Node 20+, geen afhankelijkheden)
npm run dev    # demo op http://localhost:8787, wachtwoord "demo", gegevens in het geheugen, mails worden niet echt verstuurd
```

## Let op

- **Gratis Supabase pauzeert** een project na een week zonder activiteit en heeft **geen back-ups**. De kwartiertik houdt het project actief; op het tabblad *Versturen* staat wanneer de laatste tik was. Maak af en toe een export (`GET /export`).
- Persoonlijke links zijn geheimen: wie de link heeft, ziet dat rooster. *Nieuwe link* maakt de oude ongeldig.
- iPhone: meldingen werken alleen als de pagina op het beginscherm staat (iOS 16.4+).

## Wat is getest en wat niet

Getest (Node, geheugenopslag, nagemaakte Resend- en pushdienst): alle API-routes, de wekelijkse tik (niet te vroeg, één keer), CORS, inlogrem, Resend-terugval, push-versleuteling (RFC 8291 testvector) en de schermen in Chrome.
**Niet getest** omdat het hier niet kon: de echte Supabase-database (`store.js` via PostgREST), de Deno-runtime van de Edge Function, `pg_cron`/Vault, echte Resend-verzending, echte pushdiensten en installeren als app op iOS/Android. Verwacht dat je bij de eerste uitrol nog een kleine fout tegenkomt; de logs staan in het Supabase-dashboard onder *Edge Functions → api → Logs*.
