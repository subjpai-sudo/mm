import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: files, error } = await supabaseAdmin.storage
      .from("backups")
      .list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
    if (error) throw new Error(error.message);
    const { data: logs } = await supabaseAdmin
      .from("backup_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);
    return {
      files: (files ?? []).map((f) => ({
        name: f.name,
        size: (f.metadata as any)?.size ?? null,
        updated_at: f.updated_at ?? f.created_at,
      })),
      logs: logs ?? [],
    };
  });

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: signed, error } = await supabaseAdmin.storage
      .from("backups")
      .createSignedUrl(data.name, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });

export const runBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { runBackup } = await import("@/routes/api/public/hooks/nightly-backup");
    return runBackup(`manual:${context.userId}`);
  });

export const runMirrorNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { runMirror } = await import("@/routes/api/public/hooks/mirror-sync");
    return runMirror(`manual:${context.userId}`);
  });

export const listMirrorLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("mirror_sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { logs: data ?? [] };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.storage.from("backups").remove([data.name]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });