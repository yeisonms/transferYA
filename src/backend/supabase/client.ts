import { SupabaseRepository } from './repository.js';

let instance: SupabaseRepository | null = null;

const DEFAULT_SUPABASE_URL = 'https://yljfzscbxhwdflpkcboy.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsamZ6c2NieGh3ZGZscGtjYm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyNTE5OTQsImV4cCI6MjEwOTgyNzk5NH0.QrtmgJeTHiHSBzgxDNQkcU_UrMGBoFkgvUS-r-RPu2I';

export function getSupabaseEnvConfig(): {
  supabaseUrl: string;
  anonKey: string;
  serviceOrFallbackKey: string;
} {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY;
  const serviceOrFallbackKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;

  return { supabaseUrl, anonKey, serviceOrFallbackKey };
}

export function getSupabaseRepository(): SupabaseRepository {
  if (instance) return instance;

  const { supabaseUrl, serviceOrFallbackKey } = getSupabaseEnvConfig();
  instance = new SupabaseRepository({
    supabaseUrl,
    serviceKey: serviceOrFallbackKey,
  });
  return instance;
}

/**
 * Crea un repositorio autenticado con el JWT del comerciante (aplica RLS estricto
 * `auth.uid() = owner_id` directamente en PostgREST).
 */
export function createUserScopedRepository(
  userAccessToken: string,
): SupabaseRepository {
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
  return new SupabaseRepository({
    supabaseUrl,
    serviceKey: anonKey,
    bearerToken: userAccessToken,
  });
}
