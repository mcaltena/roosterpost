// Edge Function "api": alle verzoeken van de roosterapp lopen hierlangs.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from '../_shared/handler.js';
import { createSupabaseStore } from '../_shared/store.js';

function secretKey(): string {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '')?.default;
    if (k) return k;
  } catch { /* oudere projecten hebben alleen de service-role-sleutel */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const handle = createHandler({ store: createSupabaseStore(sb), env: (k: string) => Deno.env.get(k) ?? '' });

Deno.serve(handle);
