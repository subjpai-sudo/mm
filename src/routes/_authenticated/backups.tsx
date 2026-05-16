import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listBackups,
  listMirrorLogs,
  runBackupNow,
  runMirrorNow,
  getBackupDownloadUrl,
  deleteBackup,
} from "@/lib/backups.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Database, Download, RefreshCw, AlertTriangle, PlayCircle, CloudUpload, Trash2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

async function toError(e: unknown): Promise<Error> {
  if (e instanceof Response) {
    const text = await e.text().catch(() => e.statusText);
    return new Error(text || `Request failed (${e.status})`);
  }
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : "Unknown error");
}

export const Route = createFileRoute("/_authenticated/backups")({
  component: BackupsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-10 max-w-md mx-auto text-center">
        <AlertTriangle className="size-8 mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold">Backups unavailable</h2>
        <p className="text-sm text-muted-foreground mt-1 break-words">{error.message}</p>
        <div className="mt-4 flex gap-2 justify-center">
          <Button onClick={() => { router.invalidate(); reset(); }}>Try again</Button>
          <Button variant="secondary" asChild><Link to="/dashboard">Dashboard</Link></Button>
        </div>
      </div>
    );
  },
});

function fmtBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "success" ? "bg-success/15 text-success border-success/30"
    : status === "error" ? "bg-destructive/15 text-destructive border-destructive/30"
    : "bg-warning/15 text-warning border-warning/30";
  return <Badge variant="outline" className={cls}>{status}</Badge>;
}

function BackupsPage() {
  const qc = useQueryClient();
  const fetchBackups = useServerFn(listBackups);
  const fetchMirror = useServerFn(listMirrorLogs);
  const runBackup = useServerFn(runBackupNow);
  const runMirror = useServerFn(runMirrorNow);
  const getUrl = useServerFn(getBackupDownloadUrl);
  const remove = useServerFn(deleteBackup);

  const backupsQ = useQuery({
    queryKey: ["backups"],
    queryFn: async () => {
      try { return await fetchBackups(); }
      catch (e) { throw await toError(e); }
    },
    retry: false,
  });
  const mirrorQ = useQuery({
    queryKey: ["mirror-logs"],
    queryFn: async () => {
      try { return await fetchMirror(); }
      catch (e) { throw await toError(e); }
    },
    retry: false,
  });

  const backupNow = useMutation({
    mutationFn: () => runBackup(),
    onSuccess: (r) => {
      if ((r as any).ok) toast.success(`Backup created: ${(r as any).file_path}`);
      else toast.error(`Backup failed: ${(r as any).error}`);
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mirrorNow = useMutation({
    mutationFn: () => runMirror(),
    onSuccess: (r) => {
      if ((r as any).ok) toast.success("Mirror sync completed");
      else toast.error(`Mirror failed: ${(r as any).error}`);
      qc.invalidateQueries({ queryKey: ["mirror-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const download = useMutation({
    mutationFn: (name: string) => getUrl({ data: { name } }),
    onSuccess: (r) => { window.open(r.url, "_blank"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (name: string) => remove({ data: { name } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["backups"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const files = backupsQ.data?.files ?? [];
  const backupLogs = backupsQ.data?.logs ?? [];
  const mirrorLogs = mirrorQ.data?.logs ?? [];

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl gradient-primary grid place-items-center">
          <Database className="size-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Backups & Mirror</h1>
          <p className="text-sm text-muted-foreground">Nightly snapshots and 5-minute sync to your external Supabase.</p>
        </div>
      </div>

      <Card className="card-elevated p-4 text-sm text-muted-foreground">
        Backup listing and downloads work with your signed-in session. Creating backups needs the admin backend key on Cloudflare, and mirror sync also needs both source and target database connection strings available to that deployment.
      </Card>

      {/* Mirror panel */}
      <Card className="card-elevated p-5">
        <div className="flex items-start gap-3 mb-4">
          <CloudUpload className="size-5 text-primary mt-0.5" />
          <div className="flex-1">
            <h2 className="font-semibold">Mirror to your Supabase</h2>
            <p className="text-sm text-muted-foreground">Runs every 5 minutes via cron. Truncates and re-inserts all tables.</p>
          </div>
          <Button size="sm" onClick={() => mirrorNow.mutate()} disabled={mirrorNow.isPending}>
            <PlayCircle className="size-4" /> {mirrorNow.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
        <div className="space-y-1.5 text-sm">
          {mirrorQ.isLoading && <p className="text-muted-foreground">Loading…</p>}
          {mirrorLogs.length === 0 && !mirrorQ.isLoading && <p className="text-muted-foreground">No sync runs yet.</p>}
          {mirrorLogs.map((l: any) => (
            <div key={l.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
              <StatusBadge status={l.status} />
              <span className="text-muted-foreground text-xs flex-1">
                {format(new Date(l.started_at), "MMM d, HH:mm:ss")} · {formatDistanceToNow(new Date(l.started_at), { addSuffix: true })}
              </span>
              {l.error && <span className="text-destructive text-xs truncate max-w-[40%]" title={l.error}>{l.error}</span>}
              {l.rows_synced && <span className="text-xs text-muted-foreground tabular-nums">{Object.values(l.rows_synced as Record<string, number>).reduce((a, b) => a + b, 0)} rows</span>}
            </div>
          ))}
        </div>
      </Card>

      {/* Backups panel */}
      <Card className="card-elevated p-5">
        <div className="flex items-start gap-3 mb-4">
          <Database className="size-5 text-primary mt-0.5" />
          <div className="flex-1">
            <h2 className="font-semibold">Database backups</h2>
            <p className="text-sm text-muted-foreground">Nightly JSON snapshots stored privately. Download anytime.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => backupsQ.refetch()} disabled={backupsQ.isFetching}>
            <RefreshCw className={`size-4 ${backupsQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => backupNow.mutate()} disabled={backupNow.isPending}>
            <PlayCircle className="size-4" /> {backupNow.isPending ? "Creating…" : "Backup now"}
          </Button>
        </div>

        <div className="divide-y divide-border">
          {backupsQ.isLoading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
          {files.length === 0 && !backupsQ.isLoading && (
            <p className="text-sm text-muted-foreground py-4">No backups yet. Click "Backup now" to create one.</p>
          )}
          {files.map((f) => (
            <div key={f.name} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm truncate">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtBytes(f.size)} · {f.updated_at ? formatDistanceToNow(new Date(f.updated_at), { addSuffix: true }) : "—"}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => download.mutate(f.name)} disabled={download.isPending}>
                <Download className="size-4" /> Download
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${f.name}?`)) del.mutate(f.name); }}>
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        {backupLogs.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Recent runs</h3>
            <div className="space-y-1 text-xs">
              {backupLogs.map((l: any) => (
                <div key={l.id} className="flex items-center gap-3">
                  <StatusBadge status={l.status} />
                  <span className="text-muted-foreground flex-1">
                    {format(new Date(l.started_at), "MMM d, HH:mm")} · {l.triggered_by}
                  </span>
                  {l.error && <span className="text-destructive truncate max-w-[40%]" title={l.error}>{l.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}