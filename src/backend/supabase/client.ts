import { SupabaseRepository } from './repository.js';

let instance: SupabaseRepository | null = null;

export function getSupabaseRepository(): SupabaseRepository {
  if (instance) return instance;

  const supabaseUrl =
    process.env.SUPABASE_URL || 'https://yljfzscbxhwdflpkcboy.supabase.co';
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsamZ6c2NieGh3ZGZscGtjYm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyNTE5OTQsImV4cCI6MjEwOTgyNzk5NH0.QrtmgJeTHiHSBzgxDNQkcU_UrMGBoFkgvUS-r-RPu2I';

  instance = new SupabaseRepository({ supabaseUrl, serviceKey });
  return instance;
}

