import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  USERNAME_DOMAIN,
  usernameToEmail,
  assertAdminOrOwner,
  supabaseAdmin,
  writeAudit,
} from "./users.server";
import { sendSmsTo } from "./notifications.functions";

export const listManagedUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrOwner(context.userId);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone, created_at, must_change_pin")
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
      mustChangePin: z.boolean().optional().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    const email = usernameToEmail(data.username);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.pin,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName,
        role: data.role,
        must_change_pin: data.mustChangePin,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Create failed");

    await supabaseAdmin.from("profiles").upsert({
      id: created.user.id,
      full_name: data.fullName,
      email,
      must_change_pin: data.mustChangePin,
    });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      role: data.role,
    });

    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "user.create",
      targetId: created.user.id,
      targetLabel: data.username,
      details: { fullName: data.fullName, role: data.role },
    });

    return { id: created.user.id, username: data.username, email };
  });

const DEFAULT_TEMP_PIN = "0000";

export const inviteManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      fullName: z.string().min(1).max(80),
      username: z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/, "lowercase letters, numbers, . _ - only"),
      role: z.enum(["operator", "admin", "owner"]).default("operator"),
      phone: z.string().min(8).max(20).regex(/^\+[1-9]\d{6,18}$/, "Phone must be E.164 e.g. +15551234567"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    const email = usernameToEmail(data.username);
    const tempPin = DEFAULT_TEMP_PIN;

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPin,
      email_confirm: true,
      phone: undefined,
      user_metadata: {
        full_name: data.fullName,
        role: data.role,
        must_change_pin: true,
        phone: data.phone,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Invite failed");

    await supabaseAdmin.from("profiles").upsert({
      id: created.user.id,
      full_name: data.fullName,
      email,
      phone: data.phone,
      must_change_pin: true,
    });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      role: data.role,
    });

    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "user.invite",
      targetId: created.user.id,
      targetLabel: data.username,
      details: { fullName: data.fullName, role: data.role, phone: data.phone },
    });

    // Send SMS invite via Twilio
    const origin = process.env.PUBLIC_APP_URL || "https://stock-buddy-727.lovable.app";
    const loginUrl = `${origin}/login`;
    const smsBody = `Stock Bot invite\nLogin: ${loginUrl}\nUsername: ${data.username}\nTemp PIN: ${tempPin}\nYou'll be asked to change your PIN on first sign-in.`;
    const sms = await sendSmsTo(data.phone, smsBody).catch((e: any) => ({ sent: false, reason: "exception", detail: e?.message }));

    return {
      id: created.user.id,
      username: data.username,
      email,
      tempPin,
      phone: data.phone,
      sms,
    };
  });

export const changeOwnPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      currentPin: z.string().min(4).max(12).regex(/^\d+$/),
      newPin: z.string().min(6).max(12).regex(/^\d+$/, "PIN must be digits"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.currentPin === data.newPin) {
      throw new Error("New PIN must be different from current PIN");
    }
    // Verify current PIN by attempting a sign-in with admin client
    const email = context.claims?.email;
    if (!email) throw new Error("No email on session");

    const verify = await supabaseAdmin.auth.signInWithPassword({
      email,
      password: data.currentPin,
    });
    if (verify.error) throw new Error("Current PIN is incorrect");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.newPin,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("profiles")
      .update({ must_change_pin: false })
      .eq("id", context.userId);

    await writeAudit({
      actorId: context.userId,
      actorEmail: email,
      action: "user.change_own_pin",
      targetId: context.userId,
    });

    return { ok: true };
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
    await assertAdminOrOwner(context.userId);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.pin,
    });
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "user.reset_pin",
      targetId: data.userId,
    });
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
    await assertAdminOrOwner(context.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await supabaseAdmin.from("user_roles").insert({
      user_id: data.userId,
      role: data.role,
    });
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "user.set_role",
      targetId: data.userId,
      details: { role: data.role },
    });
    return { ok: true };
  });

export const deleteManagedUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    if (data.userId === context.userId) throw new Error("Cannot delete yourself");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "user.delete",
      targetId: data.userId,
    });
    return { ok: true };
  });
