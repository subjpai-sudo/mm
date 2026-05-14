import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLogs } from "@/lib/audit.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-10 max-w-md mx-auto text-center">
        <AlertTriangle className="size-8 mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold">Audit log unavailable</h2>
        <p className="text-sm text-muted-foreground mt-1 break-words">{error.message}</p>
        <div className="mt-4 flex gap-2 justify-center">
          <Button onClick={() => { router.invalidate(); reset(); }}>Try again</Button>
          <Button variant="secondary" asChild><Link to="/dashboard">Dashboard</Link></Button>
        </div>
      </div>
    );
  },
});

const ACTION_TONE: Record<string, string> = {
  "user.create": "bg-success/15 text-success border-success/30",
  "user.delete": "bg-destructive/15 text-destructive border-destructive/30",
  "user.reset_pin": "bg-warning/15 text-warning border-warning/30",
  "user.set_role": "bg-primary/15 text-primary border-primary/30",
};

function AuditPage() {
  const fetchLogs = useServerFn(listAuditLogs);
  const { data: logs = [], isLoading, refetch, isFetching, error, isError } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => fetchLogs(),
    retry: false,
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="size-10 rounded-xl gradient-primary grid place-items-center">
          <ScrollText className="size-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Backend record of user-management actions.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card className="card-elevated p-0 overflow-hidden">
        <div className="divide-y divide-border max-h-[640px] overflow-auto">
          {isLoading && <p className="text-center text-muted-foreground py-12">Loading…</p>}
          {isError && (
            <div className="p-8 text-center">
              <AlertTriangle className="size-6 mx-auto text-destructive mb-2" />
              <p className="text-sm font-medium">Couldn't load audit log</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">{(error as Error)?.message}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => refetch()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            </div>
          )}
          {!isLoading && logs.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No audit entries yet</p>
          )}
          {logs.map((l: any) => (
            <div key={l.id} className="p-3 sm:p-4 hover:bg-secondary/30">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={ACTION_TONE[l.action] ?? "bg-secondary text-foreground border-border"}>
                  {l.action}
                </Badge>
                {l.target_label && <span className="font-medium truncate">{l.target_label}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                <span>by <span className="text-foreground font-medium">{l.actor_email ?? l.actor_id ?? "system"}</span></span>
                <span>·</span>
                <span>{format(new Date(l.created_at), "MMM d, p")}</span>
                {l.details && Object.keys(l.details).length > 0 && (
                  <>
                    <span>·</span>
                    <code className="text-[11px] font-mono break-all">{JSON.stringify(l.details)}</code>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
