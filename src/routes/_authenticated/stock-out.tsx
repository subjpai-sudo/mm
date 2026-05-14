import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScanLine, Search, Boxes, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";

export const Route = createFileRoute("/_authenticated/stock-out")({ component: StockOut });

const REASONS = ["Sale", "Damaged", "Returned to supplier", "Internal use", "Lost/Shrinkage"];
const DESTINATIONS = ["Delivery", "Shops"] as const;

function StockOut() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState(REASONS[0]);
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
        product_id: selected.id, type: "out", quantity: Number(qty), user_id: user?.id, reason, destination,
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

      <div className="grid lg:grid-cols-2 gap-3 sm:gap-4">
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
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 max-h-[60vh] sm:max-h-[520px] overflow-auto p-1">
            {filtered.slice(0, 60).map((p: any) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className={cn(
                  "group flex flex-col rounded-xl border bg-card hover:border-destructive/60 hover:shadow-md transition-all text-left overflow-hidden",
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
                    "absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full backdrop-blur text-[10px] font-bold border",
                    p.stock <= 0
                      ? "bg-destructive/90 text-destructive-foreground border-destructive"
                      : "bg-background/90 border-border"
                  )}>
                    {p.stock}
                  </span>
                </div>
                <div className="p-2">
                  <div className="font-semibold text-xs leading-tight line-clamp-2 min-h-[2.2em]">{p.name}</div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center col-span-full">No products found.</p>}
          </div>
        </Card>

        <Card className="card-elevated p-4 sm:p-6">
          <div className="text-sm uppercase tracking-wider text-muted-foreground">Issue details</div>
          {selected ? (
            <div className="mt-3 space-y-4">
              <div className="p-4 rounded-xl border border-border bg-secondary/60">
                <div className="font-semibold text-lg">{selected.name}</div>
                <div className="text-xs text-muted-foreground">Available: {selected.stock} · SKU {selected.sku ?? "—"}</div>
              </div>
              <div>
                <Label>Quantity</Label>
                <Input type="number" min="1" max={selected.stock} value={qty} onChange={e => setQty(e.target.value)} />
              </div>
              <div>
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Destination</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {DESTINATIONS.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDestination(d)}
                      className={`h-11 rounded-lg border text-sm font-semibold transition ${
                        destination === d
                          ? "border-primary bg-primary text-primary-foreground shadow"
                          : "border-border bg-secondary/40 hover:bg-secondary"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <Button className="w-full gradient-warning text-warning-foreground border-0" onClick={() => apply.mutate()}>
                Confirm stock out
              </Button>
            </div>
          ) : (
            <div className="mt-12 text-center text-muted-foreground">Scan or pick a product to issue stock.</div>
          )}
        </Card>
      </div>
      <BarcodeScanner open={camOpen} onClose={() => setCamOpen(false)} onDetected={lookup} />
    </div>
  );
}
