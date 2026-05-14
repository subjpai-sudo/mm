import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const USERNAME_DOMAIN = "stockflow.local";

export function usernameToEmail(u: string) {
  return `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;
}

export async function assertAdminOrOwner(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("owner")) {
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