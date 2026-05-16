import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export const USERNAME_DOMAIN = "stockflow.local";

function isServiceRoleConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function usernameToEmail(u: string) {
  return `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;
}

async function lookupAdminOrOwnerRole(client: SupabaseClient<Database>, userId: string) {
  return client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "owner"])
    .limit(1)
    .maybeSingle();
}

export async function assertAdminOrOwner(
  userId: string,
  client?: SupabaseClient<Database>,
) {
  const lookupClient = client ?? (isServiceRoleConfigured() ? supabaseAdmin : undefined);
  if (!lookupClient) {
    throw new Error("Forbidden: admin lookup unavailable");
  }
  const result = await lookupAdminOrOwnerRole(lookupClient, userId);

  if (result.error) {
    console.error("assertAdminOrOwner role lookup failed", { userId, error: result.error });
    throw new Error("Forbidden: role lookup failed");
  }

  if (!result.data?.role) {
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