import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, Package, Plus, Search, X, ImageIcon, Warehouse, ArrowUpRight, ArrowDownRight, Printer, PencilLine, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { DEFAULT_RACK_CODES, formatRackLabel } from "@/lib/racks";

export const Route = createFileRoute("/_authenticated/racks_/$rackId")({ component: RackDetail });

const SHELVES = ["upper", "mid", "down"] as const;
type Shelf = (typeof SHELVES)[number];

function stockColor(p: any) {
  if (p.stock <= 0) return "border-destructive bg-destructive/10";
  if (p.stock <= (p.low_stock_threshold ?? 5)) return "border-warning bg-warning/10";
  return "border-success bg-success/10";
}
function stockDot(p: any) {
  if (p.stock <= 0) return "bg-destructive";
  if (p.stock <= (p.low_stock_threshold ?? 5)) return "bg-warning";
  return "bg-success";
}

function RackDetail() {
  const { rackId } = Route.useParams();
  const qc = useQueryClient();
  const [addingTo, setAddingTo] = useState<Shelf | null>(null);
  const [q, setQ] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [rackNameDraft, setRackNameDraft] = useState(rackId);
  useRealtimeSync({ silent: true });

  const { data: rackRecord } = useQuery({
    queryKey: ["rack", rackId],
    queryFn: async () => (await supabase.from("racks").select("id, code, name").eq("code", rackId).maybeSingle()).data,
  });

  // Only products that live in THIS rack — keeps payload small even for big inventories.
  const { data: rackProducts = [] } = useQuery({
    queryKey: ["products", "by-rack", rackId],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, name, sku, barcode, image_url, stock, low_stock_threshold, rack, shelf")
          .eq("rack", rackId)
          .order("name")
      ).data ?? [],
  });

  const byShelf = useMemo(() => {
    const result: Record<Shelf, any[]> = { upper: [], mid: [], down: [] };
    for (const p of rackProducts as any[]) {
      if (p.shelf && SHELVES.includes(p.shelf)) result[p.shelf as Shelf].push(p);
      else result.mid.push(p);
    }
    return result;
  }, [rackProducts]);

  const productIdsInRack = useMemo(() => {
    return (rackProducts as any[]).map((p) => p.id);
  }, [rackProducts]);

  const { data: movements = [] } = useQuery({
    queryKey: ["movements-by-rack", rackId, productIdsInRack.length],
    enabled: productIdsInRack.length > 0,
    queryFn: async () => (await supabase
      .from("stock_movements")
      .select("id, type, quantity, created_at, product_id")
      .in("product_id", productIdsInRack)
      .order("created_at", { ascending: false })
      .limit(40)).data ?? [],
  });

  const movementsByShelf = useMemo(() => {
    const result: Record<Shelf, any[]> = { upper: [], mid: [], down: [] };
    const productShelf = new Map<string, Shelf>();
    for (const p of rackProducts as any[]) {
      const s: Shelf = (p.shelf && SHELVES.includes(p.shelf)) ? p.shelf : "mid";
      productShelf.set(p.id, s);
    }
    for (const m of movements as any[]) {
      const s = productShelf.get(m.product_id);
      if (s) result[s].push(m);
    }
    return result;
  }, [movements, rackProducts]);

  // Pickable list is fetched only when the add-dialog opens.
  const { data: pickableAll = [], isFetching: pickableLoading } = useQuery({
    queryKey: ["products", "pickable", rackId],
    enabled: !!addingTo,
    staleTime: 30_000,
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id, name, sku, barcode, image_url, stock, rack, shelf")
          .or(`rack.is.null,rack.neq.${rackId}`)
          .order("name")
      ).data ?? [],
  });

  const pickable = useMemo(() => {
    const v = q.trim().toLowerCase();
    if (!v) return pickableAll as any[];
    return (pickableAll as any[]).filter((p) =>
      `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(v),
    );
  }, [pickableAll, q]);

  const assign = useMutation({
    mutationFn: async ({ productId, shelf }: { productId: string; shelf: Shelf | null }) => {
      const { error } = await supabase.from("products")
        .update({ rack: shelf ? rackId : null, shelf })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const renameRack = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Rack name is required");
      if (rackRecord?.id) {
        const { error } = await supabase.from("racks").update({ name: trimmed }).eq("id", rackRecord.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("racks").insert({ code: rackId, name: trimmed });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rack", rackId] });
      qc.invalidateQueries({ queryKey: ["racks"] });
      setRenameOpen(false);
      toast.success("Rack updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const printableLabel = formatRackLabel(rackId, rackRecord?.name);
  const rackInDefaultSet = DEFAULT_RACK_CODES.includes(rackId);

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-6xl mx-auto">
      <Link to="/racks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="size-4" /> All racks
      </Link>
      <PageHeader
        title={printableLabel}
        subtitle="3D shelf view with live in/out activity per level."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setRackNameDraft(rackRecord?.name ?? rackId); setRenameOpen(true); }}>
              <PencilLine className="size-4" /> {rackInDefaultSet ? "Rename rack" : "Set rack name"}
            </Button>
            <Link to="/racks/print" search={{ ids: rackId } as any}>
              <Button variant="outline" className="gap-2">
                <Printer className="size-4" /> Generate QR
              </Button>
            </Link>
            <Link to="/racks/labels" search={{ ids: rackId } as any}>
              <Button className="gradient-primary text-primary-foreground border-0 gap-2">
                <Tag className="size-4" /> Print product labels
              </Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-4">
        {SHELVES.map((s) => {
          const items = byShelf[s];
          const recent = movementsByShelf[s];
          const inCount = recent.filter((m) => m.type === "in").reduce((a, m) => a + (m.quantity ?? 0), 0);
          const outCount = recent.filter((m) => m.type === "out").reduce((a, m) => a + (m.quantity ?? 0), 0);
          const productMap = new Map((rackProducts as any[]).map((p) => [p.id, p]));
          return (
            <Card key={s} className="card-elevated p-3 sm:p-4 relative overflow-hidden">
              {/* 3D isometric shelf base */}
              <div className="absolute inset-x-3 bottom-2 h-3 rounded-md bg-gradient-to-r from-foreground/10 via-foreground/20 to-foreground/10 blur-sm pointer-events-none" />
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-9 rounded-xl bg-secondary border border-border grid place-items-center shrink-0">
                    <Warehouse className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold capitalize text-base leading-tight">{s} shelf</div>
                    <div className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-success/15 text-success border border-success/30">
                    <ArrowUpRight className="size-3" /> +{inCount}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-destructive/15 text-destructive border border-destructive/30">
                    <ArrowDownRight className="size-3" /> -{outCount}
                  </span>
                  <Button size="sm" onClick={() => { setAddingTo(s); setQ(""); }} className="gradient-primary text-primary-foreground border-0">
                    <Plus className="size-4" /> Add
                  </Button>
                </div>
              </div>

              {/* Live movement tracker line */}
              <div className="mb-3 flex items-center gap-1 overflow-x-auto pb-1">
                {recent.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground italic">No recent activity</span>
                ) : recent.slice(0, 18).map((m: any) => {
                  const tone = m.type === "in"
                    ? "bg-success/80 hover:bg-success"
                    : (productMap.get(m.product_id)?.stock ?? 0) <= 0
                      ? "bg-destructive/80 hover:bg-destructive"
                      : (productMap.get(m.product_id)?.stock ?? 0) <= 5
                        ? "bg-warning/80 hover:bg-warning"
                        : "bg-destructive/60 hover:bg-destructive/80";
                  return (
                    <div key={m.id} title={`${productMap.get(m.product_id)?.name ?? "?"} · ${m.type === "in" ? "+" : "-"}${m.quantity} · ${formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}`}
                      className={cn("h-2 rounded-full shrink-0 transition", tone)}
                      style={{ width: Math.min(40, 6 + (m.quantity ?? 1) * 2) + "px" }} />
                  );
                })}
              </div>

              {items.length === 0 ? (
                <button
                  onClick={() => { setAddingTo(s); setQ(""); }}
                  className="w-full rounded-xl border-2 border-dashed border-border bg-gradient-to-b from-secondary/10 to-secondary/30 hover:bg-secondary/40 transition p-8 text-sm text-muted-foreground"
                  style={{ transform: "perspective(900px) rotateX(8deg)" }}
                >
                  Empty shelf — tap to load products
                </button>
              ) : (
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 p-2 rounded-xl bg-gradient-to-b from-secondary/40 to-secondary/10 border border-border/60 shadow-inner"
                  style={{ transform: "perspective(1100px) rotateX(6deg)", transformOrigin: "center top" }}
                >
                  {items.map((p) => (
                    <div key={p.id}
                      className={cn(
                        "relative rounded-lg border-2 p-2 min-h-[120px] flex flex-col gap-1.5 bg-card shadow-md hover:-translate-y-0.5 hover:shadow-lg transition",
                        stockColor(p),
                      )}>
                      <span className={cn("absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2 ring-background", stockDot(p))} />
                      <button
                        type="button"
                        title="Remove from rack"
                        onClick={() => assign.mutate({ productId: p.id, shelf: null })}
                        className="absolute top-1 left-1 size-5 rounded-full bg-background/80 grid place-items-center text-muted-foreground hover:text-destructive hover:bg-background border border-border"
                      >
                        <X className="size-3" />
                      </button>
                      <div className="aspect-square w-full rounded-md overflow-hidden bg-background/60 border border-border grid place-items-center mt-3">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="size-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold leading-tight line-clamp-2">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">{p.barcode ?? p.sku ?? "—"}</div>
                        <div className="text-[10px] font-bold tabular-nums mt-0.5">Stock: {p.stock}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* 3D shelf plank */}
              <div className="mt-1 h-2 rounded-b-md bg-gradient-to-b from-border to-foreground/20" />
            </Card>
          );
        })}
      </div>

      <Dialog open={!!addingTo} onOpenChange={(v) => !v && setAddingTo(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              Add to Rack {rackId} · <span className="capitalize">{addingTo} shelf</span>
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="pl-9" />
          </div>
          <VirtualPickList
            items={pickable}
            loading={pickableLoading}
            onPick={(p) => {
              if (!addingTo) return;
              assign.mutate({ productId: p.id, shelf: addingTo });
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddingTo(null)} className="w-full">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename rack {rackId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Rack name</label>
            <Input value={rackNameDraft} onChange={(event) => setRackNameDraft(event.target.value)} placeholder="Cold room wall" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={() => renameRack.mutate(rackNameDraft)} className="gradient-primary text-primary-foreground border-0">
              {renameRack.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VirtualPickList({
  items,
  loading,
  onPick,
}: {
  items: any[];
  loading: boolean;
  onPick: (p: any) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  if (loading && items.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Loading products…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        No matching products
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto border border-border rounded-lg max-h-[55vh]"
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const p = items[virtualRow.index];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="absolute left-0 top-0 w-full flex items-center gap-3 p-2 hover:bg-secondary/40 transition text-left border-b border-border"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-10 rounded-lg object-cover border border-border shrink-0"
                />
              ) : (
                <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0">
                  <ImageIcon className="size-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">
                  {p.barcode ?? p.sku ?? "—"}
                  {(p.rack ?? "").trim() && (
                    <span className="ml-2">
                      · in Rack {p.rack} / {p.shelf ?? "—"}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] tabular-nums font-bold text-muted-foreground">
                {p.stock}
              </span>
              <Plus className="size-4 text-primary shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
