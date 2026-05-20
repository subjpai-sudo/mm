import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, Package, Plus, Search, X, ImageIcon, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const byShelf = useMemo(() => {
    const result: Record<Shelf, any[]> = { upper: [], mid: [], down: [] };
    for (const p of products as any[]) {
      if ((p.rack ?? "").trim() !== rackId) continue;
      if (p.shelf && SHELVES.includes(p.shelf)) result[p.shelf as Shelf].push(p);
      else result.mid.push(p);
    }
    return result;
  }, [products, rackId]);

  const pickable = useMemo(() => {
    const v = q.toLowerCase();
    return (products as any[])
      .filter((p) => (p.rack ?? "").trim() !== rackId)
      .filter((p) => !v || `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(v));
  }, [products, rackId, q]);

  const assign = useMutation({
    mutationFn: async ({ productId, shelf }: { productId: string; shelf: Shelf | null }) => {
      const { error } = await supabase.from("products")
        .update({ rack: shelf ? rackId : null, shelf })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-6xl mx-auto">
      <Link to="/racks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ChevronLeft className="size-4" /> All racks
      </Link>
      <PageHeader
        title={`Rack ${rackId}`}
        subtitle="Upper, mid, and down shelves — tap a shelf to add products."
      />

      <div className="space-y-3">
        {SHELVES.map((s) => {
          const items = byShelf[s];
          return (
            <Card key={s} className="card-elevated p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-9 rounded-xl bg-secondary border border-border grid place-items-center shrink-0">
                    <Warehouse className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold capitalize text-base leading-tight">{s} shelf</div>
                    <div className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <Button size="sm" onClick={() => { setAddingTo(s); setQ(""); }} className="gradient-primary text-primary-foreground border-0">
                  <Plus className="size-4" /> Add
                </Button>
              </div>

              {items.length === 0 ? (
                <button
                  onClick={() => { setAddingTo(s); setQ(""); }}
                  className="w-full rounded-xl border-2 border-dashed border-border bg-secondary/20 hover:bg-secondary/40 transition p-6 text-sm text-muted-foreground"
                >
                  Empty shelf — tap to load products
                </button>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {items.map((p) => (
                    <div key={p.id}
                      className={cn(
                        "relative rounded-lg border-2 p-2 min-h-[120px] flex flex-col gap-1.5",
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
                          <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
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
          <div className="flex-1 overflow-y-auto -mx-6 px-6 divide-y divide-border border border-border rounded-lg max-h-[55vh]">
            {pickable.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No matching products</p>}
            {pickable.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (!addingTo) return;
                  assign.mutate({ productId: p.id, shelf: addingTo });
                }}
                className="w-full flex items-center gap-3 p-2 hover:bg-secondary/40 transition text-left"
              >
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="size-10 rounded-lg object-cover border border-border shrink-0" />
                ) : (
                  <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {p.barcode ?? p.sku ?? "—"}
                    {(p.rack ?? "").trim() && <span className="ml-2">· in Rack {p.rack} / {p.shelf ?? "—"}</span>}
                  </div>
                </div>
                <span className="text-[10px] tabular-nums font-bold text-muted-foreground">{p.stock}</span>
                <Plus className="size-4 text-primary shrink-0" />
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddingTo(null)} className="w-full">Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
