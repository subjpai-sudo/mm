import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Warehouse, Package, ImageIcon, Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/racks")({ component: RacksPage });

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

function RacksPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [rackInput, setRackInput] = useState("");
  const [shelfInput, setShelfInput] = useState<Shelf>("mid");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const visible = useMemo(() => {
    if (!q) return products as any[];
    const v = q.toLowerCase();
    return (products as any[]).filter((p) =>
      `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""} ${p.rack ?? ""}`.toLowerCase().includes(v),
    );
  }, [products, q]);

  const racks = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of visible) {
      const key = (p.rack ?? "").trim() || "__unassigned__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "__unassigned__") return 1;
      if (b === "__unassigned__") return -1;
      return a.localeCompare(b);
    });
  }, [visible]);

  const save = useMutation({
    mutationFn: async () => {
      const rack = rackInput.trim() || null;
      const shelf = rack ? shelfInput : null;
      const { error } = await supabase.from("products")
        .update({ rack, shelf })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Location updated");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openEdit(p: any) {
    setEditing(p);
    setRackInput(p.rack ?? "");
    setShelfInput((p.shelf as Shelf) ?? "mid");
  }

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Racks" subtitle="Warehouse layout with live stock status." />

      <Card className="card-elevated p-3 sm:p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or racks…" className="pl-9" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" /> In stock</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" /> Low</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" /> Out</span>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {racks.map(([rackKey, items]) => {
          const isUnassigned = rackKey === "__unassigned__";
          const byShelf: Record<Shelf, any[]> = { upper: [], mid: [], down: [] };
          const unshelved: any[] = [];
          for (const p of items) {
            if (!isUnassigned && p.shelf && SHELVES.includes(p.shelf)) byShelf[p.shelf as Shelf].push(p);
            else unshelved.push(p);
          }
          return (
            <Card key={rackKey} className="card-elevated p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
                    <Warehouse className="size-5 text-primary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-base leading-tight truncate">
                      {isUnassigned ? "Unassigned" : `Rack ${rackKey}`}
                    </div>
                    <div className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
                  </div>
                </div>
              </div>

              {isUnassigned ? (
                <ShelfRow products={unshelved} onClick={openEdit} label="No location" />
              ) : (
                <div className="space-y-2">
                  {SHELVES.map((s) => (
                    <ShelfRow key={s} label={`${s.charAt(0).toUpperCase()}${s.slice(1)} shelf`} products={byShelf[s]} onClick={openEdit} />
                  ))}
                  {unshelved.length > 0 && <ShelfRow label="Rack, no shelf" products={unshelved} onClick={openEdit} />}
                </div>
              )}
            </Card>
          );
        })}
        {racks.length === 0 && (
          <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">No products yet.</Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MapPin className="size-5 text-primary" />Set location</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50 border border-border">
                {editing.image_url ? (
                  <img src={editing.image_url} alt={editing.name} className="size-12 rounded-lg object-cover border border-border" />
                ) : (
                  <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-5" /></div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{editing.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">{editing.barcode ?? "no barcode"}</div>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Rack (name / code)</Label>
                <Input value={rackInput} onChange={(e) => setRackInput(e.target.value)} placeholder="e.g. R1, A, Aisle-3" className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shelf</Label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {SHELVES.map((s) => (
                    <button key={s} type="button" disabled={!rackInput.trim()}
                      onClick={() => setShelfInput(s)}
                      className={cn(
                        "h-11 rounded-xl border text-sm font-semibold capitalize transition disabled:opacity-50",
                        shelfInput === s && rackInput.trim()
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-secondary/40 hover:bg-secondary",
                      )}>
                      {s}
                    </button>
                  ))}
                </div>
                {!rackInput.trim() && <p className="text-[11px] text-muted-foreground mt-1.5">Enter a rack name to enable shelf selection. Leave both empty to unassign.</p>}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} className="flex-1">Cancel</Button>
            <Button className="gradient-primary text-primary-foreground border-0 flex-1" onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShelfRow({ label, products, onClick }: { label: string; products: any[]; onClick: (p: any) => void }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1 mb-1.5">{label} · {products.length}</div>
      {products.length === 0 ? (
        <div className="text-xs text-muted-foreground italic px-1 py-3">Empty</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {products.map((p) => (
            <button key={p.id} onClick={() => onClick(p)}
              className={cn(
                "relative text-left rounded-lg border-2 p-2 hover:shadow-md active:scale-[0.98] transition min-h-[110px] flex flex-col gap-1.5",
                stockColor(p),
              )}>
              <span className={cn("absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2 ring-background", stockDot(p))} />
              <div className="aspect-square w-full rounded-md overflow-hidden bg-background/60 border border-border grid place-items-center">
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}