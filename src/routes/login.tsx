import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Boxes, Shield, UserCog, Eye, Loader2, User, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

const DEMO: Record<Role, { email: string; password: string; name: string; icon: any }> = {
  admin:    { email: "admin@demo.app",    password: "demo12345", name: "Admin",    icon: Shield },
  operator: { email: "operator@demo.app", password: "demo12345", name: "Operator", icon: UserCog },
  owner:    { email: "owner@demo.app",    password: "demo12345", name: "Owner",    icon: Eye },
};

const USERNAME_DOMAIN = "stockflow.local";
const PIN_LENGTH = 6;

function LoginPage() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (session && !loading) nav({ to: "/dashboard" }); }, [session, loading, nav]);

  // Match the rest of the app's dark theme
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<Role | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);

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
    <div className="min-h-screen w-full grid lg:grid-cols-[1fr_540px] bg-background">
      {/* Hero side */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        {/* Mesh gradient blobs */}
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full blur-3xl opacity-40"
               style={{ background: "radial-gradient(circle, var(--cs-primary), transparent 65%)" }} />
          <div className="absolute bottom-[-160px] right-[-120px] w-[560px] h-[560px] rounded-full blur-3xl opacity-35"
               style={{ background: "radial-gradient(circle, var(--cs-accent), transparent 65%)" }} />
          <div className="absolute top-1/3 right-1/4 w-[320px] h-[320px] rounded-full blur-3xl opacity-25"
               style={{ background: "radial-gradient(circle, var(--cs-primary-2), transparent 70%)" }} />
        </div>

        {/* Brand block */}
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl gradient-primary grid place-items-center glow">
            <Boxes className="size-6 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">CityStar</div>
            <div className="upper-label" style={{ fontSize: 10 }}>Inventory v3.0</div>
          </div>
        </div>

        {/* Hero copy */}
        <div className="max-w-2xl">
          <div className="upper-label mb-4">Welcome</div>
          <h1 className="font-semibold tracking-[-0.03em] leading-[1.02] text-[clamp(48px,7vw,84px)]">
            Every box,<br/>every shelf,<br/>
            <span className="text-primary">real time.</span>
          </h1>
          <p className="mt-6 text-muted-foreground max-w-lg text-[15px]">
            Real-time stock, role-based control, and Viber-ready order requests — built for fast-moving teams.
          </p>

          {/* Stat strip */}
          <div className="mt-10 grid grid-cols-3 gap-3 max-w-xl">
            {[
              { v: "1,284", l: "SKUs tracked" },
              { v: "38 / 40", l: "Racks active" },
              { v: "99.7%", l: "Sync uptime" },
            ].map((s) => (
              <div key={s.l} className="rounded-[14px] border border-border bg-card/60 backdrop-blur-sm px-4 py-3">
                <div className="num-m text-foreground">{s.v}</div>
                <div className="upper-label mt-1.5" style={{ fontSize: 10 }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground">© CityStar Inventory · {new Date().getFullYear()}</div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 lg:p-10 bg-card lg:border-l border-border">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="size-9 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-5 text-primary-foreground" /></div>
            <span className="font-semibold tracking-tight">CityStar Inventory</span>
          </div>

          <div className="upper-label">Welcome</div>
          <h2 className="text-[34px] leading-tight font-semibold tracking-[-0.025em] mt-1">Welcome back.</h2>
          <p className="text-sm text-muted-foreground mt-2">Sign in with the username and PIN issued by your admin.</p>

          <form onSubmit={submit} className="space-y-6 mt-8">
            {/* Username with leading icon */}
            <div>
              <label className="upper-label">Username</label>
              <div className="relative mt-2">
                <User className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  required value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoCapitalize="none" autoCorrect="off"
                  placeholder="jane.doe"
                  className="h-11 pl-10 rounded-[10px]"
                />
              </div>
            </div>

            {/* PIN pad */}
            <div>
              <label className="upper-label">PIN</label>
              <button
                type="button"
                onClick={() => pinRef.current?.focus()}
                className="mt-2 w-full grid grid-cols-6 gap-2"
              >
                {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                  const filled = i < pin.length;
                  const active = i === pin.length;
                  return (
                    <div
                      key={i}
                      className={`h-12 rounded-[10px] border grid place-items-center transition-all ${
                        filled
                          ? "border-primary/40 bg-primary/5"
                          : active
                            ? "border-primary/60 bg-card ring-4 ring-primary/15"
                            : "border-border bg-card"
                      }`}
                    >
                      {filled && <span className="size-2.5 rounded-full bg-primary" />}
                    </div>
                  );
                })}
              </button>
              <input
                ref={pinRef}
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="sr-only"
                required
                minLength={4}
              />
            </div>

            <Button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-[12px] gradient-primary text-primary-foreground border-0 hover:opacity-95 text-[14px] font-semibold justify-between px-5"
            >
              <span className="inline-flex items-center gap-2">
                {busy && <Loader2 className="size-4 animate-spin" />}
                Sign in
              </span>
              <ChevronRight className="size-4" />
            </Button>
          </form>

          {/* Quick demo access */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="upper-label mb-3">Quick demo access</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DEMO) as Role[]).map(id => {
                const Icon = DEMO[id].icon;
                const isBusy = demoBusy === id;
                return (
                  <button
                    key={id} type="button"
                    disabled={demoBusy !== null}
                    onClick={() => demoLogin(id)}
                    className="group rounded-[12px] border border-border bg-card hover:border-primary/40 hover:-translate-y-0.5 transition-all px-3 py-3 text-left disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      {isBusy ? <Loader2 className="size-4 animate-spin text-primary" /> : <Icon className="size-4 text-primary" />}
                      <span className="text-[13px] font-semibold">{DEMO[id].name}</span>
                    </div>
                    <div className="upper-label mt-1.5" style={{ fontSize: 9 }}>one-tap demo</div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Demo data is shared. Don't store anything sensitive.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
