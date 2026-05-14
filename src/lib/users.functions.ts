import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  USERNAME_DOMAIN,
  usernameToEmail,
  assertAdminOrOwner,
  supabaseAdmin,
} from "./users.server";

export const listManagedUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrOwner(context.supabase, context.userId);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    const byUser = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role);
      byUser.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p) => ({
      ...p,
      username: p.email?.endsWith(`@${USERNAME_DOMAIN}`) ? p.email.split("@")[0] : p.email,
      roles: byUser.get(p.id) ?? ["operator"],
    }));
  });

export const createManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      fullName: z.string().min(1).max(80),
      username: z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/, "lowercase letters, numbers, . _ - only"),
      pin: z.string().min(4).max(12).regex(/^\d+$/, "PIN must be digits"),
      role: z.enum(["operator", "admin", "owner"]).default("operator"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.supabase, context.userId);
    const email = usernameToEmail(data.username);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.pin,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, role: data.role },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Create failed");

    await supabaseAdmin.from("profiles").upsert({
      id: created.user.id,
      full_name: data.fullName,
      email,
    });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      role: data.role,
    });

    return { id: created.user.id, username: data.username, email };
  });

export const resetUserPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      pin: z.string().min(4).max(12).regex(/^\d+$/),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.supabase, context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.pin,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      userId: z.string().uuid(),
      role: z.enum(["operator", "admin", "owner"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.supabase, context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.from("user_roles").insert({
      user_id: data.userId,
      role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("Cannot delete yourself");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
