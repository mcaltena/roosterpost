-- Eenmalig uitvoeren in de Supabase SQL Editor, NA het deployen van de functie.
-- Vervang JOUW-PROJECT-REF en KIES-EEN-LANG-GEHEIM. Het geheim moet gelijk zijn aan
-- het secret CRON_SECRET van de Edge Function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://JOUW-PROJECT-REF.supabase.co/functions/v1/api/cron/tick', 'roosterpost_tick_url');
select vault.create_secret('KIES-EEN-LANG-GEHEIM', 'roosterpost_cron_secret');

-- Elk kwartier; de functie bepaalt zelf of het tijd is (Amsterdamse tijd, zomer/wintertijd).
select cron.schedule(
  'roosterpost-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'roosterpost_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'roosterpost_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Stoppen: select cron.unschedule('roosterpost-tick');
