import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const USERNAME_DOMAIN = "stockflow.local";

export function usernameToEmail(u: string) {
  return `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;
}

export async function assertAdminOrOwner(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "owner"])
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("assertAdminOrOwner role lookup failed", { userId, error });
    throw new Error("Forbidden: role lookup failed");
  }
  if (!data?.role) {
    console.warn("assertAdminOrOwner denied", { userId, role: null });
    throw new Error("Forbidden: admin or owner only");
  }
}

export async function writeAudit(params: {
  actorId: string;
  actorEmail?: string | null;
  action: string;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: params.actorId,
      actor_email: params.actorEmail ?? null,
      action: params.action,
      target_id: params.targetId ?? null,
      target_label: params.targetLabel ?? null,
      details: (params.details ?? {}) as any,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export { supabaseAdmin };