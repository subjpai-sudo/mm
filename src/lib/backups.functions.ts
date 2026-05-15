import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAdmin,
  createBackupDownloadUrl,
  deleteBackupByName,
  listBackupsOverview,
  listMirrorLogsOverview,
  runBackup,
  runMirror,
} from "./backups.server";

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId, context.supabase);
    return listBackupsOverview(context.supabase);
  });

export const getBackupDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);
    return createBackupDownloadUrl(data.name, context.supabase);
  });

export const runBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId, context.supabase);
    return runBackup(`manual:${context.userId}`, context.supabase);
  });

export const runMirrorNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId, context.supabase);
    return runMirror(`manual:${context.userId}`);
  });

export const listMirrorLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId, context.supabase);
    return listMirrorLogsOverview(context.supabase);
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId, context.supabase);
    return deleteBackupByName(data.name, context.supabase);
  });