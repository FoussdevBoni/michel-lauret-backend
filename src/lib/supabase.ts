import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../utils/HttpError';

let cached: { url: string; key: string; client: SupabaseClient } | undefined;
export function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new HttpError(
      503,
      'Le stockage des images doit être configuré sur le serveur.',
    );
  if (!cached || cached.url !== url || cached.key !== key) {
    cached = {
      url,
      key,
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, options) =>
            fetch(input, {
              ...options,
              signal: options?.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
                : AbortSignal.timeout(20000),
            }),
        },
      }),
    };
  }
  return cached.client;
}
