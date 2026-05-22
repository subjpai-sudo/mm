import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLine, Search, ChevronRight, ChevronLeft, Folder, FolderOpen, Boxes, Camera, ImageIcon, PackageSearch, Package } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";

type StockInSearch = { barcode?: string };
export const Route = createFileRoute("/_authenticated/stock-in")({
  component: StockIn,
  validateSearch: (s: Record<string, unknown>): StockInSearch => ({
    barcode: typeof s.barcode === "string" && s.barcode.length ? s.barcode : undefined,
  }),
});

function formatDetectedProductLabel(code: string, products: any[]) {
  const match = products.find((x: any) => x.barcode === code || x.sku === code);
  return match ? `${match.name} · ${code}` : code;
}

function StockIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const routeSearch = Route.useSearch();
  const nav = Route.useNavigate();
  const [parent, setParent] = useState<any | null>(null);
  const [child, setChild] = useState<any | null>(null);
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<any | null>(null);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState<"pcs" | "boxes">("pcs");
  const [destination, setDestination] = useState<"Delivery" | "Shops">("Delivery");
  const [camOpen, setCamOpen] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pickSearch, setPickSearch] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  // Auto-prefill from ?barcode=… when navigating from the scanner.
  useEffect(() => {
    if (!routeSearch.barcode || products.length === 0) return;
    const p = (products as any[]).find((x) => x.barcode === routeSearch.barcode || x.sku === routeSearch.barcode);
    if (p) setConfirm(p);
    else setNotFound(routeSearch.barcode);
    nav({ search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.barcode, products.length]);

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
  const visibleProducts = products.filter((p: any) => {
    if (child && p.category_id !== child.id) return false;
    if (!child && parent && !subIdsByParent(parent.id).includes(p.category_id) && p.category_id !== parent.id) return false;
    if (search && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const showResults = !!search || !!parent;

  function lookup(code: string) {
    const v = code.trim();
    if (!v) return;
    const p = products.find((x: any) => x.barcode === v || x.sku === v);
    if (!p) { setNotFound(v); setPickSearch(""); setScan(""); return; }
    setConfirm(p);
    setScan("");
  }
  const onScan = () => lookup(scan);

  const apply = useMutation({
    mutationFn: async () => {
      const qtyNum = Number(qty);
      if (!qtyNum || qtyNum < 1) throw new Error("Enter a quantity");
      const { error } = await supabase.from("stock_movements").insert({
        product_id: confirm.id, type: "in", quantity: qtyNum, user_id: user?.id,
        reason: `Stock In · ${qtyNum} ${unit}`, destination,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      toast.success(`Added ${qty} ${unit} × ${confirm.name}`);
      setConfirm(null); setQty("1");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const registerBarcode = useMutation({
    mutationFn: async ({ id, barcode }: { id: string; barcode: string }) => {
      const { error } = await supabase.from("products").update({ barcode }).eq("id", id);
      if (error) throw error;
      return barcode;
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      const { data } = await supabase.from("products").select("*").eq("id", vars.id).single();
      toast.success("Barcode registered");
      setNotFound(null);
      if (data) setConfirm(data);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader eyebrow="Receiving" title="Stock In" subtitle="Receive inventory by category or scan." />

      <div className="space-y-3 sm:space-y-4">
        {/* Scan + search */}
        <Card className="card-elevated p-3 sm:p-4 space-y-3 relative overflow-hidden border-success/30">
          <div aria-hidden className="absolute -top-20 -right-20 size-60 rounded-full bg-success/20 blur-3xl pointer-events-none" />
          <div className="relative">
            <Label className="text-xs uppercase tracking-[0.14em] text-success font-semibold">Barcode scan · receive</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-success" />
                <Input autoFocus value={scan} onChange={e => setScan(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && onScan()}
                  placeholder="Scan or type barcode / SKU…" className="pl-9 font-mono" />
              </div>
              <Button onClick={() => setCamOpen(true)} variant="secondary" size="icon" aria-label="Open camera">
                <Camera className="size-4" />
              </Button>
              <Button onClick={onScan} className="gradient-success text-success-foreground border-0">Find</Button>
            </div>
          </div>
          <div className="relative z-10">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products by name, SKU or barcode…" className="pl-9" />
          </div>
        </Card>

        {/* Browse: category cards or results */}
        {!showResults ? (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Browse categories</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
              {parents.map((c: any) => {
                const count = countFor(c);
                return (
                  <button key={c.id} onClick={() => setParent(c)}
                    className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/60 hover:shadow-md active:scale-[0.98] transition-all p-4 text-left min-h-[110px]">
                    <div className="size-10 rounded-xl gradient-primary grid place-items-center mb-3 shadow-sm">
                      <Folder className="size-5 text-primary-foreground" />
                    </div>
                    <div className="font-bold text-sm leading-tight line-clamp-2">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{count} item{count === 1 ? "" : "s"}</div>
                    <ChevronRight className="size-4 text-muted-foreground absolute top-3 right-3 group-hover:text-primary transition-colors" />
                  </button>
                );
              })}
              {parents.length === 0 && <p className="text-xs text-muted-foreground p-3 col-span-full">No categories yet.</p>}
            </div>
          </Card>
        ) : (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="flex items-center gap-2 text-sm mb-3">
              <button onClick={() => { setParent(null); setChild(null); setSearch(""); }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" /> Back
              </button>
              {parent && (
                <>
                  <ChevronRight className="size-3 text-muted-foreground" />
                  <button onClick={() => setChild(null)} className="font-semibold hover:text-primary">{parent.name}</button>
                </>
              )}
              {child && (<><ChevronRight className="size-3 text-muted-foreground" /><span className="font-semibold text-primary">{child.name}</span></>)}
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
              {visibleProducts.slice(0, 100).map((p: any) => (
                <button key={p.id} onClick={() => setConfirm(p)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 hover:bg-secondary/60 active:bg-secondary rounded-lg text-left">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="size-12 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground shrink-0"><Package className="size-5" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} · {p.barcode ?? "no barcode"}</div>
                    {displaySize(p) && (
                      <div className="text-[10px] font-semibold text-accent mt-0.5">{displaySize(p)}</div>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-secondary text-[11px] font-bold border border-border tabular-nums shrink-0">{p.stock}</span>
                </button>
              ))}
              {visibleProducts.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No products match.</p>}
            </div>
          </Card>
        )}
      </div>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[92vh] overflow-y-auto">
          {confirm && (
            <>
              <div className="relative w-full aspect-[4/3] sm:aspect-square bg-secondary shrink-0">
                {confirm.image_url ? (
                  <img src={confirm.image_url} alt={confirm.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="size-16" /></div>
                )}
                <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-medium border border-border">
                  Stock: <span className="font-bold">{confirm.stock}</span>
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-4">
                <div>
                  <DialogTitle className="text-lg sm:text-xl font-bold leading-tight break-words">{confirm.name}</DialogTitle>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>SKU <span className="font-mono text-foreground">{confirm.sku ?? "—"}</span></span>
                    <span>Barcode <span className="font-mono text-foreground">{confirm.barcode ?? "—"}</span></span>
                    {displaySize(confirm) && <span>Size <span className="font-semibold text-foreground">{displaySize(confirm)}</span></span>}
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["pcs", "boxes"] as const).map((u) => (
                      <button key={u} type="button" onClick={() => setUnit(u)}
                        className={cn(
                          "h-11 rounded-xl border text-sm font-semibold capitalize transition active:scale-[0.98]",
                          unit === u ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-secondary/40 hover:bg-secondary",
                        )}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to add ({unit})</Label>
                  <div className="mt-2 flex items-center gap-3">
                    <Button variant="secondary" size="icon" className="size-14 sm:size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                      onClick={() => setQty(String(Math.max(1, Number(qty) - 1)))}>−</Button>
                    <Input type="number" inputMode="numeric" min="1" value={qty} onChange={e => setQty(e.target.value)}
                      className="h-14 sm:h-16 text-center text-2xl font-bold rounded-2xl" />
                    <Button variant="secondary" size="icon" className="size-14 sm:size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                      onClick={() => setQty(String(Number(qty) + 1))}>+</Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Destination</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["Delivery", "Shops"] as const).map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDestination(d)}
                        className={cn(
                          "h-12 rounded-xl border text-sm font-semibold transition",
                          destination === d
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-secondary/40 hover:bg-secondary"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2 sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-card border-t border-border">
                  <Button variant="ghost" onClick={() => setConfirm(null)} className="flex-1 h-12">Cancel</Button>
                  <Button className="gradient-success text-success-foreground border-0 flex-1 h-12 text-base font-bold" onClick={() => apply.mutate()} disabled={apply.isPending}>
                    OK · Add {qty} {unit}
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

      <Dialog open={!!notFound} onOpenChange={(v) => !v && setNotFound(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackageSearch className="size-5 text-primary" />Barcode not registered</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-secondary/60 border border-border text-sm">
              Scanned code: <span className="font-mono text-foreground">{notFound}</span>
              <p className="text-xs text-muted-foreground mt-1">Pick the product this barcode belongs to. We'll register it for future scans.</p>
            </div>
            <div className="relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Search products or categories…" className="pl-9" />
            </div>
            <div className="max-h-[320px] overflow-auto space-y-1">
              {products
                .filter((p: any) => {
                  if (!pickSearch) return true;
                  const q = pickSearch.toLowerCase();
                  const cat = categories.find((c: any) => c.id === p.category_id);
                  const parentCat = cat ? categories.find((c: any) => c.id === cat.parent_id) : null;
                  return `${p.name} ${p.sku ?? ""} ${cat?.name ?? ""} ${parentCat?.name ?? ""}`.toLowerCase().includes(q);
                })
                .slice(0, 50)
                .map((p: any) => {
                  const cat = categories.find((c: any) => c.id === p.category_id);
                  return (
                    <button key={p.id}
                      onClick={() => registerBarcode.mutate({ id: p.id, barcode: notFound! })}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/60 text-left border border-transparent hover:border-border">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="size-10 rounded-lg object-cover border border-border" />
                      ) : (
                        <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{cat?.name ?? "Uncategorized"} · Stock {p.stock}</div>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-primary">Register</span>
                    </button>
                  );
                })}
              {products.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No products yet.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotFound(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
