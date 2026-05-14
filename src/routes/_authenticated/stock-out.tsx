import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScanLine, Search, Boxes, Camera, ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";

export const Route = createFileRoute("/_authenticated/stock-out")({ component: StockOut });

const DESTINATIONS = ["Delivery", "Shops"] as const;

function StockOut() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState("1");
  const [destination, setDestination] = useState<(typeof DESTINATIONS)[number]>("Delivery");
  const [camOpen, setCamOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  function lookup(code: string) {
    const v = code.trim();
    if (!v) return;
    const p = products.find((x: any) => x.barcode === v || x.sku === v);
    if (!p) { toast.error("Product not found"); return; }
    setSelected(p); setScan("");
  }
  const onScan = () => lookup(scan);
  const filtered = products.filter((p: any) =>
    !search || `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const apply = useMutation({
    mutationFn: async () => {
      if (Number(qty) > selected.stock) throw new Error("Quantity exceeds available stock");
      const { error } = await supabase.from("stock_movements").insert({
        product_id: selected.id, type: "out", quantity: Number(qty), user_id: user?.id, reason: destination, destination,
      });
      if (error) throw error;
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

      <div className="grid gap-3 sm:gap-4">
        <Card className="card-elevated p-4 sm:p-6 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 size-60 rounded-full bg-destructive/20 blur-3xl" />
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
          <div className="relative mt-4">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Or search manually…" className="pl-9" />
          </div>
          <div className="mt-3 @container">
            <div className="grid grid-cols-2 @[420px]:grid-cols-3 @[640px]:grid-cols-4 @[900px]:grid-cols-5 gap-3 sm:gap-4 max-h-[65vh] sm:max-h-[560px] overflow-auto p-1">
            {filtered.slice(0, 60).map((p: any) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className={cn(
                  "group flex flex-col rounded-2xl border bg-card hover:border-destructive/60 hover:shadow-md active:scale-[0.98] transition-all text-left overflow-hidden min-h-[180px]",
                  selected?.id === p.id ? "border-destructive ring-2 ring-destructive/40" : "border-border"
                )}
              >
                <div className="aspect-square w-full bg-secondary relative">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted-foreground"><Boxes className="size-8" /></div>
                  )}
                  <span className={cn(
                    "absolute top-2 right-2 px-2 py-0.5 rounded-full backdrop-blur text-[11px] font-bold border shadow-sm",
                    p.stock <= 0
                      ? "bg-destructive/90 text-destructive-foreground border-destructive"
                      : "bg-background/90 border-border"
                  )}>
                    {p.stock}
                  </span>
                </div>
                <div className="p-2.5 sm:p-3">
                  <div className="font-semibold text-[13px] leading-tight line-clamp-2 min-h-[2.4em]">{p.name}</div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center col-span-full">No products found.</p>}
            </div>
          </div>
        </Card>
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
                    {DESTINATIONS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDestination(d)}
                        className={cn(
                          "h-14 rounded-2xl border text-base font-semibold transition active:scale-[0.98]",
                          destination === d
                            ? "border-primary bg-primary text-primary-foreground shadow-md"
                            : "border-border bg-secondary/40 hover:bg-secondary"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
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
      <BarcodeScanner open={camOpen} onClose={() => setCamOpen(false)} onDetected={lookup} />
    </div>
  );
}
