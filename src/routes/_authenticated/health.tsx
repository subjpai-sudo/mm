import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, RefreshCw, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/health")({ component: HealthPage });

type CallStatus = "pending" | "ok" | "fail";
interface CallLog {
  id: string;
  name: string;
  status: CallStatus;
  ms?: number;
  detail?: string;
  at: string;
}

function maskKey(v?: string) {
  if (!v) return "—";
  if (v.length <= 16) return v;
  return `${v.slice(0, 8)}…${v.slice(-6)} (${v.length} chars)`;
}

function HealthPage() {
  const env = {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
    VITE_SUPABASE_PROJECT_ID: import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined,
  };

  const [calls, setCalls] = useState<CallLog[]>([]);
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<string | null>(null);

  const log = (entry: CallLog) =>
    setCalls((prev) => [entry, ...prev].slice(0, 20));

  async function timed<T>(name: string, fn: () => Promise<T>) {
    const id = crypto.randomUUID();
    const at = new Date().toLocaleTimeString();
    log({ id, name, status: "pending", at });
    const t0 = performance.now();
    try {
      const res = await fn();
      const ms = Math.round(performance.now() - t0);
      setCalls((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: "ok", ms, detail: summarize(res) } : c)),
      );
      return res;
    } catch (e: any) {
      const ms = Math.round(performance.now() - t0);
      setCalls((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "fail", ms, detail: e?.message ?? String(e) } : c,
        ),
      );
      throw e;
    }
  }

  function summarize(res: any) {
    if (res?.error) return `error: ${res.error.message}`;
    if (Array.isArray(res?.data)) return `${res.data.length} rows`;
    if (res?.data) return "ok";
    return "ok";
  }

  async function runChecks() {
    setRunning(true);
    try {
      await timed("auth.getSession", async () => {
        const r = await supabase.auth.getSession();
        setSession(r.data.session?.user?.email ?? null);
        return r;
      });
      await timed("products (count)", () =>
        supabase.from("products").select("id", { count: "exact", head: true }),
      );
      await timed("categories (5)", () =>
        supabase.from("categories").select("id,name").limit(5),
      );
      await timed("stock_movements (1)", () =>
        supabase.from("stock_movements").select("id").limit(1),
      );
      await timed("REST ping (/rest/v1/)", async () => {
        const url = `${env.VITE_SUPABASE_URL}/rest/v1/`;
        const res = await fetch(url, {
          headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { data: res.status };
      });
    } catch {
      /* logged */
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOk = calls.length > 0 && calls.every((c) => c.status === "ok");
  const envMissing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Connection health"
        subtitle="Verify environment + live Supabase API calls."
      />

      <Card className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl gradient-primary grid place-items-center">
              <Activity className="size-5 text-primary-foreground" />
            </div>
            <div>
              <div className="font-semibold">Overall status</div>
              <div className="text-xs text-muted-foreground">
                {envMissing.length
                  ? `Missing env: ${envMissing.join(", ")}`
                  : allOk
                    ? "All checks passing"
                    : running
                      ? "Running checks…"
                      : "Some checks failed"}
              </div>
            </div>
          </div>
          <Button onClick={runChecks} disabled={running} variant="outline">
            {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Re-run
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {envMissing.length === 0 ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 border-0">env loaded</Badge>
          ) : (
            <Badge variant="destructive">env missing</Badge>
          )}
          {session ? (
            <Badge className="bg-blue-500/15 text-blue-600 border-0">signed in: {session}</Badge>
          ) : (
            <Badge variant="secondary">no session</Badge>
          )}
        </div>
      </Card>

      <Card className="card-elevated p-6">
        <div className="font-semibold mb-3">Environment variables (build-time)</div>
        <div className="space-y-2 text-sm font-mono">
          {Object.entries(env).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b last:border-0 py-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="flex items-center gap-2">
                {v ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                <span className="truncate max-w-[260px]">{maskKey(v)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          VITE_* vars are baked in at build time. If a value is missing here on the deployed site,
          add it in your host's env settings and trigger a fresh deploy.
        </p>
      </Card>

      <Card className="card-elevated p-6">
        <div className="font-semibold mb-3">Recent API calls</div>
        <div className="space-y-2">
          {calls.length === 0 && (
            <div className="text-sm text-muted-foreground">No calls yet.</div>
          )}
          {calls.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                {c.status === "pending" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                {c.status === "ok" && <CheckCircle2 className="size-4 text-emerald-500" />}
                {c.status === "fail" && <XCircle className="size-4 text-destructive" />}
                <span className="font-mono truncate">{c.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                {c.detail && <span className="truncate max-w-[220px]">{c.detail}</span>}
                {typeof c.ms === "number" && <span>{c.ms}ms</span>}
                <span>{c.at}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}