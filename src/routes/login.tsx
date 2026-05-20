import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Boxes, Shield, UserCog, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

const DEMO: Record<Role, { email: string; password: string; name: string; icon: any }> = {
  admin:    { email: "admin@demo.app",    password: "demo12345", name: "Admin",    icon: Shield },
  operator: { email: "operator@demo.app", password: "demo12345", name: "Operator", icon: UserCog },
  owner:    { email: "owner@demo.app",    password: "demo12345", name: "Owner",    icon: Eye },
};

const USERNAME_DOMAIN = "stockflow.local";

function LoginPage() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (session && !loading) nav({ to: "/dashboard" }); }, [session, loading, nav]);

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<Role | null>(null);

  async function demoLogin(r: Role) {
    const creds = DEMO[r];
    setDemoBusy(r);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: creds.email, password: creds.password,
      });
      if (error) throw error;
      toast.success(`Signed in as Demo ${r[0].toUpperCase()}${r.slice(1)}`);
    } catch (e: any) {
      toast.error(e.message ?? "Demo sign-in failed");
    } finally { setDemoBusy(null); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = username.trim().toLowerCase();
      const email = u.includes("@") ? u : `${u}@${USERNAME_DOMAIN}`;
      const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (error) throw error;
    } catch (e: any) {
      toast.error(e.message ?? "Sign-in failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Hero side */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full gradient-primary opacity-30 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full gradient-success opacity-20 blur-3xl" />
        </div>
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl gradient-primary grid place-items-center glow">
            <Boxes className="size-6 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-xl font-semibold tracking-tight">CityStar</div>
            <div className="text-[11px] text-muted-foreground">Inventory Project</div>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-3">Welcome to</div>
          <h1 className="text-6xl font-semibold tracking-tight leading-[1.05]">
            CityStar <span className="text-gradient">Inventory</span> Project.
          </h1>
          <p className="mt-4 text-muted-foreground max-w-md">
            Real-time stock, role-based control, and Viber-ready order requests — built for fast-moving teams.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">© CityStar Inventory Project {new Date().getFullYear()}</div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6">
        <Card className="card-elevated w-full max-w-md p-8">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="size-9 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-5 text-primary-foreground" /></div>
            <span className="font-semibold">CityStar Inventory Project</span>
          </div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Welcome</div>
          <h2 className="text-4xl font-semibold tracking-tight mt-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-2">Use the username and PIN issued by your admin or owner.</p>

          <form onSubmit={submit} className="space-y-4 mt-6">
            <div>
              <Label>Username</Label>
              <Input
                required value={username}
                onChange={e => setUsername(e.target.value)}
                autoCapitalize="none" autoCorrect="off"
                placeholder="jane.doe"
              />
            </div>
            <div>
              <Label>PIN</Label>
              <Input
                type="password" required minLength={4} maxLength={12}
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full gradient-primary text-primary-foreground border-0 hover:opacity-90">
              {busy && <Loader2 className="size-4 animate-spin mr-2" />}
              Sign in
            </Button>
          </form>

          <p className="text-[11px] text-muted-foreground mt-6 text-center">
            No account? Ask your Admin or Owner to issue you a username and PIN.
          </p>

          <div className="mt-6 pt-6 border-t border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-medium text-foreground">Try a demo account</div>
              <span className="text-[10px] text-muted-foreground">one click</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DEMO) as Role[]).map(id => {
                const Icon = DEMO[id].icon;
                const loading = demoBusy === id;
                return (
                  <Button
                    key={id} type="button" variant="outline" size="sm"
                    disabled={demoBusy !== null}
                    onClick={() => demoLogin(id)}
                    className="flex-col h-auto py-2.5 gap-1"
                  >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                    <span className="text-[11px]">{DEMO[id].name}</span>
                  </Button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Demo data is shared. Don't store anything sensitive.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
