import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "operator" | "owner";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, role: null, loading: true, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) { setRole(null); setLoading(false); return; }
      // defer role fetch to avoid deadlock
      setTimeout(async () => {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", s.user.id)
          .order("role")
          .limit(1)
          .maybeSingle();
        setRole((data?.role as Role) ?? "operator");
        setLoading(false);
      }, 0);
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
      session, role, loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export const NAV_BY_ROLE: Record<Role, string[]> = {
  admin: ["dashboard", "stock-in", "stock-out", "products", "order-request", "order-history", "reports", "settings"],
  operator: ["dashboard", "stock-in", "stock-out", "products", "reports"],
  owner: ["dashboard", "products", "reports"],
};

export function canAccess(role: Role | null, page: string) {
  if (!role) return false;
  return NAV_BY_ROLE[role].includes(page);
}
