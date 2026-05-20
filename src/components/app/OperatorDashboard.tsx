import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { LiveBadge } from "@/components/app/LiveBadge";
import { UniversalScanner } from "@/components/app/UniversalScanner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { PackagePlus, PackageMinus, ScanLine, Search, Plus, Barcode, X } from "lucide-react";
import { StockStatus } from "@/routes/_authenticated/dashboard";

export function OperatorDashboard() {
  const { lastUpdated } = useRealtimeSync();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scanFor, setScanFor] = useState<{ id: string; name: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () =>
      (await supabase.from("products").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const setBarcode = useMutation({
    mutationFn: async ({ id, barcode }: { id: string; barcode: string }) => {
      const { error } = await supabase
        .from("products")
        .update({ barcode, barcode_registered_by: user?.id, barcode_registered_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setScanFor(null);
      toast.success("Barcode registered");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("products").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setAddOpen(false);
      toast.success("Product added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = (products as any[]).filter((p) => {
    if (!q) return true;
    const s = `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader title="Operator" subtitle="Scan, move stock, manage barcodes." actions={<LiveBadge lastUpdated={lastUpdated} />} />

      {/* Three primary actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Link to="/stock-in" className="block">
          <button className="w-full h-28 sm:h-32 rounded-2xl border border-success/30 bg-success/10 hover:bg-success/15 text-success font-bold inline-flex flex-col items-center justify-center gap-2 transition active:scale-[0.98] shadow-sm">
            <PackagePlus className="size-8" />
            <span className="text-base">Stock In</span>
          </button>
        </Link>
        <Link to="/stock-out" className="block">
          <button className="w-full h-28 sm:h-32 rounded-2xl border border-destructive/30 bg-destructive/10 hover:bg-destructive/15 text-destructive font-bold inline-flex flex-col items-center justify-center gap-2 transition active:scale-[0.98] shadow-sm">
            <PackageMinus className="size-8" />
            <span className="text-base">Stock Out</span>
            <span className="text-[10px] font-medium opacity-80">Shop or Delivery</span>
          </button>
        </Link>
        <button
          onClick={() => setScanOpen(true)}
          className="w-full h-28 sm:h-32 rounded-2xl gradient-primary text-primary-foreground font-bold inline-flex flex-col items-center justify-center gap-2 transition active:scale-[0.98] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.45)]"
        >
          <ScanLine className="size-8" />
          <span className="text-base">Scan QR / Barcode</span>
        </button>
      </div>

      {/* Products list with barcode registration */}
      <Card className="card-elevated p-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, barcode" className="pl-9" />
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary text-primary-foreground border-0"><Plus className="size-4" /> New product</Button>
            </DialogTrigger>
            <NewProductDialog onSubmit={(f) => create.mutate(f)} />
          </Dialog>
        </div>
      </Card>

      <Card className="card-elevated p-0 overflow-hidden">
        <div className="overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No products</TableCell></TableRow>
              )}
              {filtered.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.barcode ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary/60 border border-border">
                        <Barcode className="size-3" /> {p.barcode}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">none</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.stock}</TableCell>
                  <TableCell><StockStatus stock={p.stock} threshold={p.low_stock_threshold} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={p.barcode ? "secondary" : "default"}
                      className={!p.barcode ? "gradient-primary text-primary-foreground border-0" : ""}
                      onClick={() => setScanFor({ id: p.id, name: p.name })}>
                      <ScanLine className="size-3.5" />
                      {p.barcode ? "Re-scan" : "Register"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <UniversalScanner open={scanOpen} onClose={() => setScanOpen(false)} />

      {scanFor && (
        <BarcodeScanner
          open={!!scanFor}
          onClose={() => setScanFor(null)}
          onDetected={(code) => setBarcode.mutate({ id: scanFor.id, barcode: code })}
          onDetectedLabel={() => `Register to ${scanFor.name}`}
        />
      )}
    </div>
  );
}

function NewProductDialog({ onSubmit }: { onSubmit: (f: any) => void }) {
  const [form, setForm] = useState({ name: "", sku: "", barcode: "", stock: 0, low_stock_threshold: 5, price: 0 });
  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
          <div><Label>Barcode</Label><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Stock</Label><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></div>
          <div><Label>Low at</Label><Input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} /></div>
          <div><Label>Price</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button disabled={!form.name.trim()} onClick={() => onSubmit({ ...form, barcode: form.barcode || null, sku: form.sku || null })} className="gradient-primary text-primary-foreground border-0">
          <Plus className="size-4" /> Add
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}