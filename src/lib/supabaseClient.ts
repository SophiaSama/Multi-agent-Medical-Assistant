import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Frontend (browser) Supabase client.
// IMPORTANT: This uses the public ANON key only. Never put the service_role
// key in client code — it bypasses Row Level Security.
const url = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null;
