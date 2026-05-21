import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Warehouse, Package, AlertTriangle, PackageX, Printer, Plus, PencilLine, LayoutGrid, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { DEFAULT_RACK_CODES, formatRackLabel } from "@/lib/racks";

export const Route = createFileRoute("/_authenticated/racks")({ component: RacksIndex });

export const RACK_IDS = DEFAULT_RACK_CODES;

function RacksIndex() {
  const location = useLocation();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameRack, setRenameRack] = useState<{ id: string; code: string; name: string | null } | null>(null);
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });
  const { data: racks = [] } = useQuery({
    queryKey: ["racks"],
    queryFn: async () => (await supabase.from("racks").select("id, code, name").order("code")).data ?? [],
  });

  const createRack = useMutation({
    mutationFn: async ({ code, name }: { code: string; name: string }) => {
      const rackCode = code.trim().toUpperCase();
      if (!rackCode) throw new Error("Rack code is required");
      const { error } = await supabase.from("racks").insert({ code: rackCode, name: name.trim() || rackCode });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["racks"] });
      setCreateOpen(false);
      toast.success("Rack added");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const nextName = name.trim();
      if (!nextName) throw new Error("Rack name is required");
      const { error } = await supabase.from("racks").update({ name: nextName }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["racks"] });
      setRenameRack(null);
      toast.success("Rack renamed");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const rackMeta = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string | null }>();
    for (const rack of racks as any[]) map.set((rack.code ?? "").trim().toUpperCase(), rack);
    return map;
  }, [racks]);

  const byRack = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of products as any[]) {
      const key = (p.rack ?? "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [products]);

  const extraRacks = useMemo(
    () => Array.from(byRack.keys()).filter((r) => !RACK_IDS.includes(r)).sort(),
    [byRack],
  );

  const rackCodes = useMemo(() => {
    const combined = new Set<string>([...RACK_IDS, ...extraRacks, ...(racks as any[]).map((rack) => (rack.code ?? "").trim().toUpperCase()).filter(Boolean)]);
    return Array.from(combined).sort((a, b) => {
      const aNum = Number.parseInt(a.replace(/^R/i, ""), 10);
      const bNum = Number.parseInt(b.replace(/^R/i, ""), 10);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      return a.localeCompare(b);
    });
  }, [extraRacks, racks]);

  const unassigned = (products as any[]).filter((p) => !(p.rack ?? "").trim());

  if (location.pathname !== "/racks") {
    return <Outlet />;
  }

  const [view, setView] = useState<"grid" | "plan">("grid");

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Warehouse"
        title="Racks"
        subtitle="40 racks · 3 shelves each. Pick one to manage its shelves."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-[10px] border border-border bg-card p-0.5">
              <button
                onClick={() => setView("grid")}
                className={cn("h-8 px-3 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5", view === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                <LayoutGrid className="size-3.5" /> Grid
              </button>
              <button
                onClick={() => setView("plan")}
                className={cn("h-8 px-3 rounded-[8px] text-[12px] font-medium inline-flex items-center gap-1.5", view === "plan" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                <MapIcon className="size-3.5" /> Floor plan
              </button>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Add rack
            </Button>
            <Link to="/racks/print">
              <Button variant="outline" className="gap-2">
                <Printer className="size-4" /> Print all QR labels
              </Button>
            </Link>
          </div>
        }
      />

      {view === "grid" ? (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {rackCodes.map((id) => {
          const items = byRack.get(id) ?? [];
          const meta = rackMeta.get(id);
          const out = items.filter((p) => p.stock <= 0).length;
          const low = items.filter((p) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5)).length;
          const ok = items.length - out - low;
          const tone =
            items.length === 0 ? "border-border bg-card"
            : out > 0 ? "border-destructive/40 bg-destructive/[0.04]"
            : low > 0 ? "border-warning/40 bg-warning/[0.05]"
            : "border-border bg-card";
          const status =
            items.length === 0 ? { cls: "chip", label: "Empty" }
            : out > 0 ? { cls: "chip chip-bad", label: "Out" }
            : low > 0 ? { cls: "chip chip-warn", label: "Low" }
            : { cls: "chip chip-ok", label: "Healthy" };
          return (
            <div
              key={id}
              className={cn(
                "group relative rounded-[14px] border p-3 sm:p-4 hover-lift overflow-hidden",
                tone,
              )}
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-1.5 top-1.5 z-10 size-7 rounded-full bg-background/80 border border-border hover:bg-background"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenameRack(meta ?? { id: "", code: id, name: id });
                }}
              >
                <PencilLine className="size-3.5" />
              </Button>
              <Link
                to="/racks/$rackId"
                params={{ rackId: id }}
                className="block active:scale-[0.98]"
              >
                <Mini3DRack ok={ok} low={low} out={out} />
                <div className="mt-3 flex items-center justify-between gap-1">
                  <div className="font-semibold text-[14px] tracking-tight truncate">{formatRackLabel(id, meta?.name)}</div>
                  <span className={status.cls} style={{ fontSize: 9, padding: "2px 6px" }}>{status.label}</span>
                </div>
                <div className="upper-label font-mono mt-0.5" style={{ fontSize: 9 }}>{items.length} item{items.length === 1 ? "" : "s"}</div>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-success"><span className="size-1.5 rounded-full bg-success" />{ok}</span>
                  <span className="inline-flex items-center gap-1 text-warning"><span className="size-1.5 rounded-full bg-warning" />{low}</span>
                  <span className="inline-flex items-center gap-1 text-destructive"><span className="size-1.5 rounded-full bg-destructive" />{out}</span>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
      ) : (
        <FloorPlanView racks={rackCodes} byRack={byRack} rackMeta={rackMeta} />
      )}

      <Card className="card-elevated p-4 mt-6">
        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
          <Package className="size-4 text-muted-foreground" /> Unassigned products
          <span className="ml-auto text-xs font-normal text-muted-foreground">{unassigned.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Open any rack above, pick a shelf, then add products from this pool.
        </p>
      </Card>

      <RackEditorDialog
        open={createOpen}
        title="Add rack"
        description="Create a new rack code and optional name."
        submitLabel={createRack.isPending ? "Adding…" : "Add rack"}
        initialCode=""
        initialName=""
        onClose={() => setCreateOpen(false)}
        onSubmit={({ code, name }) => createRack.mutate({ code, name })}
      />

      <RackEditorDialog
        open={!!renameRack}
        title={`Rename ${renameRack?.code ?? "rack"}`}
        description="Update how this rack appears in the app and on QR labels."
        submitLabel={renameMutation.isPending ? "Saving…" : "Save"}
        initialCode={renameRack?.code ?? ""}
        initialName={renameRack?.name ?? renameRack?.code ?? ""}
        codeDisabled
        onClose={() => setRenameRack(null)}
        onSubmit={({ name }) => {
          if (!renameRack?.id) {
            toast.error("This rack record is missing. Refresh and try again.");
            return;
          }
          renameMutation.mutate({ id: renameRack.id, name });
        }}
      />
    </div>
  );
}

// Mini isometric 3D rack preview: 3 shelves with colored crates
function Mini3DRack({ ok, low, out }: { ok: number; low: number; out: number }) {
  const total = ok + low + out;
  // distribute crates across shelves
  const shelves = [
    { ok: Math.ceil(ok / 3), low: Math.ceil(low / 3), out: Math.ceil(out / 3) },
    { ok: Math.floor(ok / 3), low: Math.floor(low / 3), out: Math.floor(out / 3) },
    { ok: Math.max(0, ok - 2 * Math.ceil(ok / 3)), low: Math.max(0, low - 2 * Math.ceil(low / 3)), out: Math.max(0, out - 2 * Math.ceil(out / 3)) },
  ];
  return (
    <div
      className="relative h-[90px] rounded-[10px] bg-gradient-to-br from-secondary to-card border border-border overflow-hidden"
      style={{ perspective: "600px" }}
    >
      <div
        className="absolute inset-0 flex flex-col justify-end gap-1 px-3 pb-2"
        style={{ transform: "rotateX(34deg) rotateY(-14deg)", transformStyle: "preserve-3d" }}
      >
        {shelves.map((s, i) => (
          <div key={i} className="relative h-[18px] flex items-end gap-0.5 border-b border-border/60">
            {Array.from({ length: Math.min(s.ok, 4) }).map((_, j) => (
              <span key={`ok${j}`} className="block w-2 bg-success/80 rounded-[1px]" style={{ height: `${8 + (j % 3) * 3}px` }} />
            ))}
            {Array.from({ length: Math.min(s.low, 3) }).map((_, j) => (
              <span key={`lo${j}`} className="block w-2 bg-warning/80 rounded-[1px]" style={{ height: `${8 + (j % 3) * 3}px` }} />
            ))}
            {Array.from({ length: Math.min(s.out, 2) }).map((_, j) => (
              <span key={`ot${j}`} className="block w-2 bg-destructive/80 rounded-[1px]" style={{ height: "8px" }} />
            ))}
          </div>
        ))}
      </div>
      {total === 0 && (
        <div className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Empty</div>
      )}
      <div className="absolute top-1.5 left-1.5">
        <Warehouse className="size-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

function FloorPlanView({ racks, byRack, rackMeta }: { racks: string[]; byRack: Map<string, any[]>; rackMeta: Map<string, any> }) {
  const half = Math.ceil(racks.length / 2);
  const rows = [racks.slice(0, half), racks.slice(half)];
  return (
    <Card className="card-elevated p-4 sm:p-6 relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 grid-tex opacity-30" />
      <div className="relative flex items-center justify-between mb-3">
        <div className="upper-label">← Loading bay</div>
        <div className="upper-label">Office →</div>
      </div>
      <div className="relative space-y-4">
        {rows.map((row, ri) => (
          <div key={ri} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
            {row.map((id) => {
              const items = byRack.get(id) ?? [];
              const out = items.filter((p) => p.stock <= 0).length;
              const low = items.filter((p) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5)).length;
              const tone =
                items.length === 0 ? "bg-muted border-border"
                : out > 0 ? "bg-destructive/20 border-destructive/40"
                : low > 0 ? "bg-warning/20 border-warning/40"
                : "bg-success/15 border-success/40";
              const cap = Math.min(100, (items.length / 12) * 100);
              return (
                <Link key={id} to="/racks/$rackId" params={{ rackId: id }} className={cn("relative rounded-[8px] border p-2 h-20 hover-lift overflow-hidden", tone)}>
                  <div className="font-mono text-[11px] font-bold">{id}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{rackMeta.get(id)?.name || ""}</div>
                  <div className="absolute bottom-1.5 left-2 right-2 h-1 rounded-full bg-background/40 overflow-hidden">
                    <div className="h-full bg-foreground/40" style={{ width: `${cap}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}

function RackEditorDialog({
  open,
  title,
  description,
  submitLabel,
  initialCode,
  initialName,
  codeDisabled = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  initialCode: string;
  initialName: string;
  codeDisabled?: boolean;
  onClose: () => void;
  onSubmit: (values: { code: string; name: string }) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setCode(initialCode);
    setName(initialName);
  }, [initialCode, initialName, open]);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Rack code</Label>
            <Input
              value={code}
              disabled={codeDisabled}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="R21"
            />
          </div>
          <div className="space-y-2">
            <Label>Rack name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Cold storage side" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit({ code, name })} className="gradient-primary text-primary-foreground border-0">
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
