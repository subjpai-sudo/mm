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

export { supabaseAdmin };