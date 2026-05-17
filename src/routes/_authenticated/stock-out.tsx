import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScanLine, Search, Boxes, Camera, ImageIcon, Folder, ChevronRight, ChevronLeft, FolderOpen, Package } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { checkLowStockAlert } from "@/lib/notifications.functions";
import { SHOPS } from "@/lib/shops";

export const Route = createFileRoute("/_authenticated/stock-out")({ component: StockOut });

const TOP_DESTINATIONS = ["Delivery", "Shops"] as const;
type DestKind = (typeof TOP_DESTINATIONS)[number];

function formatDetectedProductLabel(code: string, products: any[]) {
  const match = products.find((x: any) => x.barcode === code || x.sku === code);
  return match ? `${match.name} · ${code}` : code;
}

function StockOut() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState("1");
  const [destKind, setDestKind] = useState<DestKind>("Delivery");
  const [shop, setShop] = useState<string>(SHOPS[0]);
  const [camOpen, setCamOpen] = useState(false);
  const [parent, setParent] = useState<any | null>(null);
  const [child, setChild] = useState<any | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const parents = categories.filter((c: any) => !c.parent_id);
  const children = parent ? categories.filter((c: any) => c.parent_id === parent.id) : [];
  const subIdsByParent = (pid: string) => categories.filter((c: any) => c.parent_id === pid).map((c: any) => c.id);
  const countFor = (cat: any) => {
    if (!cat.parent_id) {
      const ids = new Set<string>([cat.id, ...subIdsByParent(cat.id)]);
      return products.filter((p: any) => ids.has(p.category_id)).length;
    }
    return products.filter((p: any) => p.category_id === cat.id).length;
  };

  function lookup(code: string) {
    const v = code.trim();
    if (!v) return;
    const p = products.find((x: any) => x.barcode === v || x.sku === v);
    if (!p) { toast.error("Product not found"); return; }
    setSelected(p); setScan("");
  }
  const onScan = () => lookup(scan);
  const filtered = products.filter((p: any) => {
    if (child && p.category_id !== child.id) return false;
    if (!child && parent && !subIdsByParent(parent.id).includes(p.category_id) && p.category_id !== parent.id) return false;
    if (search && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const showResults = !!search || !!parent;

  const apply = useMutation({
    mutationFn: async () => {
      if (Number(qty) > selected.stock) throw new Error("Quantity exceeds available stock");
      const finalDestination = destKind === "Shops" ? shop : "Delivery";
      const { error } = await supabase.from("stock_movements").insert({
        product_id: selected.id, type: "out", quantity: Number(qty), user_id: user?.id,
        reason: destKind === "Shops" ? `Shop · ${shop}` : "Delivery",
        destination: finalDestination,
      });
      if (error) throw error;
      // Fire-and-forget low-stock alert. Don't block the UX if it fails.
      checkLowStockAlert({ data: { productId: selected.id } }).catch(() => {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      toast.success(`Removed ${qty} × ${selected.name}`);
      setSelected(null); setQty("1");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Stock Out" subtitle="Issue inventory with reason logging." />

      <div className="space-y-3 sm:space-y-4">
        <Card className="card-elevated p-3 sm:p-4 relative overflow-hidden space-y-3">
          <div className="absolute -top-20 -right-20 size-60 rounded-full bg-destructive/20 blur-3xl pointer-events-none" />
          <div className="relative">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scan zone</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-destructive" />
                <Input autoFocus value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => e.key === "Enter" && onScan()}
                  placeholder="Scan barcode / SKU…" className="pl-9 font-mono" />
              </div>
              <Button onClick={() => setCamOpen(true)} variant="secondary" size="icon" aria-label="Open camera">
                <Camera className="size-4" />
              </Button>
              <Button onClick={onScan} variant="destructive">Find</Button>
            </div>
          </div>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products by name, SKU or barcode…" className="pl-9" />
          </div>
        </Card>

        {!showResults ? (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Browse categories</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
              {parents.map((c: any) => {
                const count = countFor(c);
                return (
                  <button key={c.id} onClick={() => setParent(c)}
                    className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-destructive/10 via-card to-card hover:border-destructive/60 hover:shadow-md active:scale-[0.98] transition-all p-4 text-left min-h-[110px]">
                    <div className="size-10 rounded-xl bg-destructive grid place-items-center mb-3 shadow-sm">
                      <Folder className="size-5 text-destructive-foreground" />
                    </div>
                    <div className="font-bold text-sm leading-tight line-clamp-2">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{count} item{count === 1 ? "" : "s"}</div>
                    <ChevronRight className="size-4 text-muted-foreground absolute top-3 right-3 group-hover:text-destructive transition-colors" />
                  </button>
                );
              })}
              {parents.length === 0 && <p className="text-xs text-muted-foreground p-3 col-span-full">No categories yet.</p>}
            </div>
          </Card>
        ) : (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="flex items-center gap-2 text-sm mb-3 flex-wrap">
              <button onClick={() => { setParent(null); setChild(null); setSearch(""); }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" /> Back
              </button>
              {parent && (<><ChevronRight className="size-3 text-muted-foreground" />
                <button onClick={() => setChild(null)} className="font-semibold hover:text-destructive">{parent.name}</button></>)}
              {child && (<><ChevronRight className="size-3 text-muted-foreground" /><span className="font-semibold text-destructive">{child.name}</span></>)}
              {!parent && search && <span className="text-muted-foreground">Search results</span>}
            </div>

            {parent && !child && children.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {children.map((c: any) => (
                  <button key={c.id} onClick={() => setChild(c)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-secondary/40 hover:bg-secondary text-xs font-semibold transition active:scale-[0.97]">
                    <FolderOpen className="size-3.5 text-accent" />
                    {c.name}
                    <span className="text-muted-foreground">{countFor(c)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="divide-y divide-border max-h-[60vh] overflow-auto -mx-1">
              {filtered.slice(0, 100).map((p: any) => (
                <button key={p.id} onClick={() => setSelected(p)}
                  className={cn("w-full flex items-center gap-3 px-2 py-2.5 hover:bg-secondary/60 active:bg-secondary rounded-lg text-left",
                    selected?.id === p.id && "bg-destructive/10")}>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="size-12 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground shrink-0"><Package className="size-5" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} · {p.barcode ?? "no barcode"}</div>
                  </div>
                  <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold border tabular-nums shrink-0",
                    p.stock <= 0 ? "bg-destructive text-destructive-foreground border-destructive" : "bg-secondary border-border")}>
                    {p.stock}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No products match.</p>}
            </div>
          </Card>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setQty("1"); } }}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {selected && (
            <>
              <div className="relative w-full aspect-square bg-secondary">
                {selected.image_url ? (
                  <img src={selected.image_url} alt={selected.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="size-20" /></div>
                )}
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-medium border border-border">
                  Stock: <span className="font-bold">{selected.stock}</span>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <DialogTitle className="text-xl font-bold leading-tight break-words">{selected.name}</DialogTitle>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>SKU <span className="font-mono text-foreground">{selected.sku ?? "—"}</span></span>
                    <span>Barcode <span className="font-mono text-foreground">{selected.barcode ?? "—"}</span></span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to remove</Label>
                  <div className="mt-2 flex items-center gap-3">
                    <Button variant="secondary" size="icon" className="size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                      onClick={() => setQty(String(Math.max(1, Number(qty) - 1)))}>−</Button>
                    <Input type="number" inputMode="numeric" min="1" max={selected.stock} value={qty} onChange={e => setQty(e.target.value)}
                      className="h-16 text-center text-2xl font-bold rounded-2xl" />
                    <Button variant="secondary" size="icon" className="size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                      onClick={() => setQty(String(Math.min(selected.stock, Number(qty) + 1)))}>+</Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Destination</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {TOP_DESTINATIONS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDestKind(d)}
                        className={cn(
                          "h-14 rounded-2xl border text-base font-semibold transition active:scale-[0.98]",
                          destKind === d
                            ? "border-primary bg-primary text-primary-foreground shadow-md"
                            : "border-border bg-secondary/40 hover:bg-secondary"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {destKind === "Shops" && (
                    <div className="mt-3">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Choose shop</Label>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {SHOPS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setShop(s)}
                            className={cn(
                              "h-11 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                              shop === s
                                ? "border-warning bg-warning text-warning-foreground shadow-sm"
                                : "border-border bg-secondary/40 hover:bg-secondary"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button variant="ghost" onClick={() => setSelected(null)} className="flex-1">Cancel</Button>
                  <Button className="gradient-warning text-warning-foreground border-0 flex-1" onClick={() => apply.mutate()}>
                    Confirm stock out
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <BarcodeScanner
        open={camOpen}
        onClose={() => setCamOpen(false)}
        onDetected={lookup}
        keepOpenOnDetect
        onDetectedLabel={(code) => formatDetectedProductLabel(code, products)}
      />
    </div>
  );
}
