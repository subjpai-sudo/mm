import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const BACKUP_TABLES = [
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

const MIRROR_TABLES = [
  "app_settings",
  "profiles",
  "user_roles",
  "categories",
  "products",
  "order_requests",
  "stock_movements",
  "audit_logs",
] as const;

function hasServiceRoleAccess() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function hasDirectMirrorDbAccess() {
  // Target (mirror) connection string is required. Source DB URL is optional —
  // when present we also sync auth.users / auth.identities directly via pg.
  return Boolean(process.env.MIRROR_DB_URL?.trim());
}

function getDbClient(client?: SupabaseClient<Database>) {
  if (client) return client;
  if (!hasServiceRoleAccess()) {
    throw new Error("Admin backend connection is not configured on this deployment");
  }
  return supabaseAdmin;
}

async function safeWriteBackupLog(logId: string | undefined, values: Record<string, unknown>) {
  if (!logId) return;
  try {
    await supabaseAdmin.from("backup_log").update(values as never).eq("id", logId);
  } catch (error) {
    console.warn("backup log update skipped", { logId, error });
  }
}

export async function assertAdmin(userId: string, client?: SupabaseClient<Database>) {
  const lookupClient = client ?? supabaseAdmin;
  const { data, error } = await lookupClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "owner"])
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin or owner only");
}

export async function listBackupsOverview(client?: SupabaseClient<Database>) {
  const db = getDbClient(client);
  const { data: files, error } = await db.storage
    .from("backups")
    .list("", { limit: 100, sortBy: { column: "name", order: "desc" } });

  if (error) throw new Error(error.message);

  const { data: logs } = await db
    .from("backup_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);

  return {
    files: (files ?? []).map((file) => ({
      name: file.name,
      size: (file.metadata as { size?: number } | null)?.size ?? null,
      updated_at: file.updated_at ?? file.created_at,
    })),
    logs: logs ?? [],
  };
}

export async function createBackupDownloadUrl(name: string, client?: SupabaseClient<Database>) {
  const { data: signed, error } = await getDbClient(client).storage
    .from("backups")
    .createSignedUrl(name, 60 * 10);

  if (error) throw new Error(error.message);
  return { url: signed.signedUrl };
}

export async function listMirrorLogsOverview(client?: SupabaseClient<Database>) {
  const { data, error } = await getDbClient(client)
    .from("mirror_sync_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return { logs: data ?? [] };
}

export async function deleteBackupByName(name: string, client?: SupabaseClient<Database>) {
  const { error } = await getDbClient(client).storage.from("backups").remove([name]);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function runBackup(triggeredBy: string, client?: SupabaseClient<Database>) {
  const db = getDbClient(client);
  const startedAt = new Date().toISOString();
  const { data: logRow } = await db
    .from("backup_log")
    .insert({ status: "running", triggered_by: triggeredBy, started_at: startedAt })
    .select("id")
    .single();

  const logId = logRow?.id as string | undefined;

  try {
    const dump: Record<string, unknown[]> = {};
    for (const table of BACKUP_TABLES) {
      const { data, error } = await db.from(table as any).select("*");
      if (error) throw new Error(`${table}: ${error.message}`);
      dump[table] = data ?? [];
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

    const { error: uploadError } = await db.storage
      .from("backups")
      .upload(filePath, body, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);

    await safeWriteBackupLog(logId, {
      status: "success",
      finished_at: new Date().toISOString(),
      file_path: filePath,
      size_bytes: sizeBytes,
    });

    return { ok: true as const, file_path: filePath, size_bytes: sizeBytes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await safeWriteBackupLog(logId, {
      status: "error",
      finished_at: new Date().toISOString(),
      error: message,
    });
    return { ok: false as const, error: message };
  }
}

export async function runMirror(triggeredBy: string) {
  if (!hasServiceRoleAccess()) {
    return { ok: false as const, error: "Mirror sync requires the admin backend key on this deployment" };
  }
  if (!hasDirectMirrorDbAccess()) {
    return { ok: false as const, error: "Mirror sync requires the target database connection string (MIRROR_DB_URL)" };
  }
  const { default: postgres } = await import("postgres");
  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabaseAdmin
    .from("mirror_sync_log")
    .insert({ status: "running", triggered_by: triggeredBy, started_at: startedAt })
    .select("id")
    .single();

  const logId = logRow?.id as string | undefined;
  const mirrorUrl = process.env.MIRROR_DB_URL?.trim();
  const isValidPgUrl = (() => {
    if (!mirrorUrl) return false;
    try {
      const url = new URL(mirrorUrl);
      return url.protocol === "postgres:" || url.protocol === "postgresql:";
    } catch {
      return false;
    }
  })();

  if (!isValidPgUrl) {
    const message = !mirrorUrl
      ? "MIRROR_DB_URL is not configured"
      : "MIRROR_DB_URL is not a valid postgres:// connection string";

    if (logId) {
      await supabaseAdmin
        .from("mirror_sync_log")
        .update({ status: "error", finished_at: new Date().toISOString(), error: message })
        .eq("id", logId);
    }

    return { ok: false as const, error: message };
  }

  const sql = postgres(mirrorUrl!, {
    ssl: "require",
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    prepare: false,
  });

  const sourceDbUrl = process.env.SUPABASE_DB_URL?.trim();
  const sourceSql = sourceDbUrl
    ? postgres(sourceDbUrl, {
        ssl: "require",
        max: 1,
        idle_timeout: 5,
        connect_timeout: 15,
        prepare: false,
      })
    : null;

  const rowsSynced: Record<string, number> = {};

  try {
    const dump: Record<string, any[]> = {};
    for (const table of MIRROR_TABLES) {
      const { data, error } = await supabaseAdmin.from(table as any).select("*");
      if (error) throw new Error(`source ${table}: ${error.message}`);
      dump[table] = data ?? [];
      rowsSynced[table] = dump[table].length;
    }

    let authUsers: any[] = [];
    let authIdentities: any[] = [];

    if (sourceSql) {
      try {
        authUsers = await sourceSql`SELECT * FROM auth.users`;
        authIdentities = await sourceSql`SELECT * FROM auth.identities`;
        rowsSynced["auth.users"] = authUsers.length;
        rowsSynced["auth.identities"] = authIdentities.length;
      } catch {
        rowsSynced["auth.users"] = -1;
      }
    }

    await sql.begin(async (tx) => {
      if (authUsers.length) {
        await tx.unsafe("DELETE FROM auth.identities");
        await tx.unsafe("DELETE FROM auth.users");

        const authChunk = 200;
        for (let index = 0; index < authUsers.length; index += authChunk) {
          await tx`insert into auth.users ${tx(authUsers.slice(index, index + authChunk))}`;
        }
        for (let index = 0; index < authIdentities.length; index += authChunk) {
          await tx`insert into auth.identities ${tx(authIdentities.slice(index, index + authChunk))}`;
        }
      }

      for (const table of [...MIRROR_TABLES].reverse()) {
        await tx.unsafe(`TRUNCATE TABLE public.${table} RESTART IDENTITY CASCADE`);
      }

      for (const table of MIRROR_TABLES) {
        const rows = dump[table];
        if (!rows.length) continue;
        const chunkSize = 500;
        for (let index = 0; index < rows.length; index += chunkSize) {
          await tx`insert into ${tx(`public.${table}`)} ${tx(rows.slice(index, index + chunkSize))}`;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    if (sourceSql) await sourceSql.end({ timeout: 5 }).catch(() => {});
  }
}