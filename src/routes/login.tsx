import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes, Shield, UserCog, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({ component: LoginPage });

const ROLES: { id: Role; label: string; desc: string; icon: any }[] = [
  { id: "admin", label: "Admin", desc: "Full control & settings", icon: Shield },
  { id: "operator", label: "Operator", desc: "Manage stock day-to-day", icon: UserCog },
  { id: "owner", label: "Owner", desc: "Read-only insights", icon: Eye },
];

function LoginPage() {
  const { session, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (session && !loading) nav({ to: "/dashboard" }); }, [session, loading, nav]);

  const [role, setRole] = useState<Role>("operator");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: name, role },
          },
        });
        if (error) throw error;
        toast.success("Account created. You can sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      toast.error(e.message ?? "Authentication failed");
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
          <span className="text-xl font-semibold tracking-tight">Stockflow</span>
        </div>
        <div>
          <h1 className="text-5xl font-semibold tracking-tight leading-tight">
            Inventory that <span className="text-gradient">moves at your pace</span>.
          </h1>
          <p className="mt-4 text-muted-foreground max-w-md">
            Real-time stock, role-based control, and Viber-ready order requests — built for fast-moving teams.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">© Stockflow {new Date().getFullYear()}</div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-6">
        <Card className="card-elevated w-full max-w-md p-8">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="size-9 rounded-lg gradient-primary grid place-items-center"><Boxes className="size-5 text-primary-foreground" /></div>
            <span className="font-semibold">Stockflow</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1">Choose your role and sign in.</p>

          <div className="grid grid-cols-3 gap-2 mt-6">
            {ROLES.map(r => {
              const Icon = r.icon;
              const active = role === r.id;
              return (
                <button
                  key={r.id} type="button" onClick={() => setRole(r.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    active
                      ? "border-primary bg-primary/10 glow"
                      : "border-border hover:border-primary/50 hover:bg-secondary/50"
                  )}
                >
                  <Icon className={cn("size-5 mb-2", active ? "text-primary" : "text-muted-foreground")} />
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{r.desc}</div>
                </button>
              );
            })}
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value={mode} forceMount>
              <form onSubmit={submit} className="space-y-4 mt-4">
                {mode === "signup" && (
                  <div>
                    <Label>Full name</Label>
                    <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
                  </div>
                )}
                <div>
                  <Label>Email</Label>
                  <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
                </div>
                <div>
                  <Label>Password</Label>
                  <Input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" disabled={busy} className="w-full gradient-primary text-primary-foreground border-0 hover:opacity-90">
                  {busy && <Loader2 className="size-4 animate-spin mr-2" />}
                  {mode === "signin" ? "Sign in" : "Create account"} as {ROLES.find(r => r.id === role)?.label}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground mt-6 text-center">
            Role determines which screens you can access. Admins can adjust roles later.
          </p>
        </Card>
      </div>
    </div>
  );
}
