import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLine, Search, ChevronRight, Folder, FolderOpen, Boxes, Camera, ImageIcon, PackageSearch } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";

export const Route = createFileRoute("/_authenticated/stock-in")({ component: StockIn });

function StockIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [parent, setParent] = useState<any | null>(null);
  const [child, setChild] = useState<any | null>(null);
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<any | null>(null);
  const [qty, setQty] = useState("1");
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

  const parents = categories.filter((c: any) => !c.parent_id);
  const children = parent ? categories.filter((c: any) => c.parent_id === parent.id) : [];
  const visibleProducts = products.filter((p: any) => {
    if (child && p.category_id !== child.id) return false;
    if (!child && parent && !categories.filter((c:any)=>c.parent_id===parent.id).map((c:any)=>c.id).includes(p.category_id) && p.category_id !== parent.id) return false;
    if (search && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
      const { error } = await supabase.from("stock_movements").insert({
        product_id: confirm.id, type: "in", quantity: Number(qty), user_id: user?.id, reason: "Stock In", destination,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      toast.success(`Added ${qty} × ${confirm.name}`);
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
      <PageHeader title="Stock In" subtitle="Receive inventory by category or scan." />

      <div className="grid lg:grid-cols-[1fr_2fr] gap-3 sm:gap-4">
        {/* Categories breadcrumb tree */}
        <Card className="card-elevated p-3 sm:p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <button onClick={() => { setParent(null); setChild(null); }} className="hover:text-foreground">All</button>
            {parent && (<><ChevronRight className="size-3" /><button onClick={() => setChild(null)} className="hover:text-foreground">{parent.name}</button></>)}
            {child && (<><ChevronRight className="size-3" /><span className="text-foreground">{child.name}</span></>)}
          </div>
          <div className="space-y-1">
            {(!parent ? parents : children).map((c: any) => (
              <button key={c.id} onClick={() => parent ? setChild(c) : setParent(c)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-secondary/60 text-left">
                {parent ? <FolderOpen className="size-4 text-accent" /> : <Folder className="size-4 text-primary" />}
                {c.name}
              </button>
            ))}
            {(!parent ? parents : children).length === 0 && (
              <p className="text-xs text-muted-foreground p-3">No {parent ? "subcategories" : "categories"} yet.</p>
            )}
          </div>
        </Card>

        {/* Scan + search + product list */}
        <div className="space-y-3 sm:space-y-4">
          <Card className="card-elevated p-3 sm:p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Barcode scan</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <Input autoFocus value={scan} onChange={e => setScan(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && onScan()}
                  placeholder="Scan or type barcode / SKU…" className="pl-9 font-mono" />
              </div>
              <Button onClick={() => setCamOpen(true)} variant="secondary" size="icon" aria-label="Open camera">
                <Camera className="size-4" />
              </Button>
              <Button onClick={onScan} className="gradient-primary text-primary-foreground border-0">Find</Button>
            </div>
          </Card>

          <Card className="card-elevated p-3 sm:p-4">
            <div className="relative mb-3">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className="pl-9" />
            </div>
            <div className="@container">
              <div className="grid grid-cols-2 @[420px]:grid-cols-3 @[640px]:grid-cols-4 @[900px]:grid-cols-5 gap-3 sm:gap-4 max-h-[65vh] sm:max-h-[560px] overflow-auto p-1">
              {visibleProducts.map((p: any) => (
                <button key={p.id} onClick={() => setConfirm(p)}
                  className={cn("group flex flex-col rounded-2xl border border-border bg-card hover:border-primary/60 hover:shadow-md active:scale-[0.98] transition-all text-left overflow-hidden min-h-[180px]")}>
                  <div className="aspect-square w-full bg-secondary relative">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-muted-foreground"><Boxes className="size-8" /></div>
                    )}
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-background/95 backdrop-blur text-[11px] font-bold border border-border shadow-sm">
                      {p.stock}
                    </span>
                  </div>
                  <div className="p-2.5 sm:p-3">
                    <div className="font-semibold text-[13px] leading-tight line-clamp-2 min-h-[2.4em]">{p.name}</div>
                  </div>
                </button>
              ))}
              {visibleProducts.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center col-span-full">No products in this view.</p>}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
          {confirm && (
            <>
              <div className="relative w-full aspect-square bg-secondary">
                {confirm.image_url ? (
                  <img src={confirm.image_url} alt={confirm.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="size-20" /></div>
                )}
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-medium border border-border">
                  Stock: <span className="font-bold">{confirm.stock}</span>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <DialogTitle className="text-xl font-bold leading-tight break-words">{confirm.name}</DialogTitle>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>SKU <span className="font-mono text-foreground">{confirm.sku ?? "—"}</span></span>
                    <span>Barcode <span className="font-mono text-foreground">{confirm.barcode ?? "—"}</span></span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to add</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="secondary" size="icon" className="size-11 text-lg shrink-0"
                      onClick={() => setQty(String(Math.max(1, Number(qty) - 1)))}>−</Button>
                    <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                      className="h-11 text-center text-lg font-bold" />
                    <Button variant="secondary" size="icon" className="size-11 text-lg shrink-0"
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
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button variant="ghost" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button>
                  <Button className="gradient-success text-success-foreground border-0 flex-1" onClick={() => apply.mutate()}>
                    Add to stock
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <BarcodeScanner open={camOpen} onClose={() => setCamOpen(false)} onDetected={lookup} />

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
