import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "operator" | "owner";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role | null;
  mustChangePin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, role: null, mustChangePin: false, loading: true,
  signOut: async () => {}, refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [mustChangePin, setMustChangePin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadProfileFor(userId: string) {
    const [{ data: roleRow }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId)
        .order("role").limit(1).maybeSingle(),
      supabase.from("profiles").select("must_change_pin").eq("id", userId).maybeSingle(),
    ]);
    setRole((roleRow?.role as Role) ?? "operator");
    setMustChangePin(Boolean(profile?.must_change_pin));
    setLoading(false);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) { setRole(null); setMustChangePin(false); setLoading(false); return; }
      // defer role fetch to avoid deadlock
      setTimeout(() => { loadProfileFor(s.user.id); }, 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{
      user: session?.user ?? null,
      session, role, mustChangePin, loading,
      signOut: async () => { await supabase.auth.signOut(); },
      refreshProfile: async () => { if (session?.user.id) await loadProfileFor(session.user.id); },
    }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export const NAV_BY_ROLE: Record<Role, string[]> = {
  admin: ["dashboard", "stock-in", "stock-out", "products", "order-request", "shipments", "order-history", "reports", "settings", "users", "audit", "health", "backups"],
  operator: ["dashboard", "stock-in", "stock-out", "products", "reports"],
  owner: ["dashboard", "stock-in", "stock-out", "products", "shipments", "order-history", "reports", "users", "audit", "health"],
};

export function canAccess(role: Role | null, page: string) {
  if (!role) return false;
  return NAV_BY_ROLE[role].includes(page);
}
