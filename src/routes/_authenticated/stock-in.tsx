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
import { ScanLine, Search, ChevronRight, Folder, FolderOpen, Boxes } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  function onScan() {
    if (!scan.trim()) return;
    const p = products.find((x: any) => x.barcode === scan.trim() || x.sku === scan.trim());
    if (!p) { toast.error("Product not found"); return; }
    setConfirm(p); setScan("");
  }

  const apply = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("stock_movements").insert({
        product_id: confirm.id, type: "in", quantity: Number(qty), user_id: user?.id, reason: "Stock In",
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

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Stock In" subtitle="Receive inventory by category or scan." />

      <div className="grid lg:grid-cols-[1fr_2fr] gap-4">
        {/* Categories breadcrumb tree */}
        <Card className="card-elevated p-4">
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
        <div className="space-y-4">
          <Card className="card-elevated p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Barcode scan</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <Input autoFocus value={scan} onChange={e => setScan(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && onScan()}
                  placeholder="Scan or type barcode / SKU…" className="pl-9 font-mono" />
              </div>
              <Button onClick={onScan} className="gradient-primary text-primary-foreground border-0">Find</Button>
            </div>
          </Card>

          <Card className="card-elevated p-4">
            <div className="relative mb-3">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…" className="pl-9" />
            </div>
            <div className="grid sm:grid-cols-2 gap-2 max-h-[420px] overflow-auto">
              {visibleProducts.map((p: any) => (
                <button key={p.id} onClick={() => setConfirm(p)}
                  className={cn("group flex items-center gap-3 p-3 rounded-xl border border-border bg-secondary/40 hover:border-primary/50 hover:bg-secondary transition-all text-left")}>
                  <div className="size-10 rounded-lg gradient-primary/20 grid place-items-center bg-primary/10"><Boxes className="size-5 text-primary" /></div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Stock: {p.stock} · SKU {p.sku ?? "—"}</div>
                  </div>
                </button>
              ))}
              {visibleProducts.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center col-span-2">No products in this view.</p>}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm stock in</DialogTitle></DialogHeader>
          {confirm && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-secondary/60 border border-border">
                <div className="font-semibold">{confirm.name}</div>
                <div className="text-xs text-muted-foreground mt-1">SKU {confirm.sku ?? "—"} · Current stock: {confirm.stock}</div>
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button className="gradient-success text-success-foreground border-0" onClick={() => apply.mutate()}>Add to stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
