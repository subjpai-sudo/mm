import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-side config reader. Reads the editable values from app_settings
// (service role, bypasses RLS — never exposed to the browser), falling back to
// environment variables / Cloudflare secrets. Cached briefly to avoid a DB hit
// on every call.

async function getCfEnv(): Promise<Record<string, string>> {
  try {
    const modName = "cloudflare:workers";
    const m = await import(/* @vite-ignore */ modName);
    return (m.env as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

let _cache: { at: number; row: any } | null = null;

async function settingsRow(): Promise<any> {
  if (_cache && Date.now() - _cache.at < 10_000) return _cache.row;
  const { data } = await supabaseAdmin.from("app_settings").select("*").eq("id", 1).maybeSingle();
  _cache = { at: Date.now(), row: data ?? {} };
  return _cache.row;
}

/** Key lookup order: app_settings column → process.env → Cloudflare env. */
export async function getConfiguredKey(column: string, envName: string): Promise<string> {
  const row = await settingsRow();
  const fromDb = (row?.[column] ?? "").toString().trim();
  if (fromDb) return fromDb;
  const fromProc = (process.env[envName] ?? "").trim();
  if (fromProc) return fromProc;
  return ((await getCfEnv())[envName] ?? "").trim();
}

/** Which events should fire notifications (defaults true when unset). */
export async function getNotifyPrefs() {
  const row = await settingsRow();
  return {
    lowStock: row?.notify_low_stock !== false,
    outOfStock: row?.notify_out_of_stock !== false,
    newOrder: row?.notify_new_order !== false,
  };
}
