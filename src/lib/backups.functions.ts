import { createServerFn } from "@tanstack/start-client-core";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, listBackupsOverview } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return listBackupsOverview(context.supabase);
  });

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin, createBackupDownloadUrl } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return createBackupDownloadUrl(data.name, context.supabase);
  });

export const runBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, runBackup } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return runBackup(`manual:${context.userId}`, context.supabase);
  });

export const runMirrorNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, runMirror } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return runMirror(`manual:${context.userId}`);
  });

export const listMirrorLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, listMirrorLogsOverview } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return listMirrorLogsOverview(context.supabase);
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertAdmin, deleteBackupByName } = await import("./backups.server");
    await assertAdmin(context.userId, context.supabase);
    return deleteBackupByName(data.name, context.supabase);
  });