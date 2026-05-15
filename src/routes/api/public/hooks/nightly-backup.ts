import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLES = [
  "app_settings",
  "profiles",
  "user_roles",
  "categories",
  "products",
  "order_requests",
  "stock_movements",
  "audit_logs",
  "backup_log",
  "mirror_sync_log",
] as const;

function checkApiKey(request: Request): boolean {
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const got = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected) && got === expected;
}

async function runBackup(triggeredBy: string) {
  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabaseAdmin
    .from("backup_log")
    .insert({ status: "running", triggered_by: triggeredBy, started_at: startedAt })
    .select("id")
    .single();
  const logId = logRow?.id as string | undefined;

  try {
    const dump: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      const { data, error } = await supabaseAdmin.from(t as any).select("*");
      if (error) throw new Error(`${t}: ${error.message}`);
      dump[t] = data ?? [];
    }
    const payload = {
      generated_at: startedAt,
      project: process.env.SUPABASE_PROJECT_ID ?? null,
      tables: dump,
    };
    const body = JSON.stringify(payload);
    const sizeBytes = new TextEncoder().encode(body).length;
    const stamp = startedAt.replace(/[:.]/g, "-");
    const filePath = `backup-${stamp}.json`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("backups")
      .upload(filePath, body, {
        contentType: "application/json",
        upsert: true,
      });
    if (upErr) throw new Error(`storage upload: ${upErr.message}`);

    if (logId) {
      await supabaseAdmin
        .from("backup_log")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          file_path: filePath,
          size_bytes: sizeBytes,
        })
        .eq("id", logId);
    }
    return { ok: true as const, file_path: filePath, size_bytes: sizeBytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      await supabaseAdmin
        .from("backup_log")
        .update({ status: "error", finished_at: new Date().toISOString(), error: message })
        .eq("id", logId);
    }
    return { ok: false as const, error: message };
  }
}

export const Route = createFileRoute("/api/public/hooks/nightly-backup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const result = await runBackup("cron");
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 500,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

export { runBackup };