import { createFileRoute } from "@tanstack/react-router";
import postgres from "postgres";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Insert order respects logical dependencies (parents before children).
const TABLES = [
  "app_settings",
  "profiles",
  "user_roles",
  "categories",
  "products",
  "order_requests",
  "stock_movements",
  "audit_logs",
] as const;

function checkApiKey(request: Request): boolean {
  const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const got = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(expected) && got === expected;
}

async function runMirror(triggeredBy: string) {
  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabaseAdmin
    .from("mirror_sync_log")
    .insert({ status: "running", triggered_by: triggeredBy, started_at: startedAt })
    .select("id")
    .single();
  const logId = logRow?.id as string | undefined;

  const mirrorUrl = process.env.MIRROR_DB_URL;
  if (!mirrorUrl) {
    const message = "MIRROR_DB_URL is not configured";
    if (logId) {
      await supabaseAdmin
        .from("mirror_sync_log")
        .update({ status: "error", finished_at: new Date().toISOString(), error: message })
        .eq("id", logId);
    }
    return { ok: false as const, error: message };
  }

  const sql = postgres(mirrorUrl, {
    ssl: "require",
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    prepare: false,
  });

  const rowsSynced: Record<string, number> = {};
  try {
    // Pull data from source
    const dump: Record<string, any[]> = {};
    for (const t of TABLES) {
      const { data, error } = await supabaseAdmin.from(t as any).select("*");
      if (error) throw new Error(`source ${t}: ${error.message}`);
      dump[t] = data ?? [];
      rowsSynced[t] = dump[t].length;
    }

    // Push: TRUNCATE in reverse order, INSERT in dep order, all in one transaction
    await sql.begin(async (tx) => {
      // Truncate children first
      for (const t of [...TABLES].reverse()) {
        await tx.unsafe(`TRUNCATE TABLE public.${t} RESTART IDENTITY CASCADE`);
      }
      // Bulk insert
      for (const t of TABLES) {
        const rows = dump[t];
        if (!rows.length) continue;
        // Insert in chunks to keep payload small
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          await tx`insert into ${tx(`public.${t}`)} ${tx(slice)}`;
        }
      }
    });

    if (logId) {
      await supabaseAdmin
        .from("mirror_sync_log")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          rows_synced: rowsSynced,
        })
        .eq("id", logId);
    }
    return { ok: true as const, rows_synced: rowsSynced };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (logId) {
      await supabaseAdmin
        .from("mirror_sync_log")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error: message,
          rows_synced: rowsSynced,
        })
        .eq("id", logId);
    }
    return { ok: false as const, error: message, rows_synced: rowsSynced };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export const Route = createFileRoute("/api/public/hooks/mirror-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiKey(request)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const result = await runMirror("cron");
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 500,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

export { runMirror };