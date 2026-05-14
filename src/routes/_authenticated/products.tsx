import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search } from "lucide-react";
import { ScanLine } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StockStatus } from "./dashboard";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";

export const Route = createFileRoute("/_authenticated/products")({ component: ProductsPage });

function ProductsPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">("all");
  const [open, setOpen] = useState(false);
  const [scanFor, setScanFor] = useState<{ id: string; name: string } | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, categories(name)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });

  const filtered = products.filter((p: any) => {
    if (q && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "out" && p.stock > 0) return false;
    if (filter === "low" && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
    if (filter === "in" && !(p.stock > p.low_stock_threshold)) return false;
    return true;
  });

  const create = useMutation({
    mutationFn: async (form: any) => {
      const { error } = await supabase.from("products").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setOpen(false); toast.success("Product added"); },
    onError: (e: any) => toast.error(e.message),
  });

  const setBarcode = useMutation({
    mutationFn: async ({ id, barcode }: { id: string; barcode: string }) => {
      const { error } = await supabase.from("products").update({ barcode }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setScanFor(null); toast.success("Barcode registered"); },
    onError: (e: any) => toast.error(e.message),
  });

  const canEdit = role === "admin" || role === "operator";

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Products"
        subtitle={`${products.length} items in catalog`}
        actions={canEdit ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gradient-primary text-primary-foreground border-0"><Plus className="size-4" /> New product</Button>
            </DialogTrigger>
            <ProductDialog categories={categories} onSubmit={(f) => create.mutate(f)} />
          </Dialog>
        ) : null}
      />

      <Card className="card-elevated p-4 mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, SKU or barcode" className="pl-9" />
        </div>
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="in">In stock</SelectItem>
            <SelectItem value="low">Low stock</SelectItem>
            <SelectItem value="out">Out of stock</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      <Card className="card-elevated p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Barcode</TableHead>
            <TableHead>Price</TableHead><TableHead>Stock</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">No products found</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-muted-foreground">{p.categories?.name ?? "—"}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" className="h-8 px-2 font-mono text-xs gap-1"
                      onClick={() => setScanFor({ id: p.id, name: p.name })}>
                      <ScanLine className="size-3.5" />{p.barcode ?? "Register"}
                    </Button>
                  ) : (<span className="font-mono text-xs">{p.barcode ?? "—"}</span>)}
                </TableCell>
                <TableCell>${Number(p.price).toFixed(2)}</TableCell>
                <TableCell>{p.stock}</TableCell>
                <TableCell><StockStatus stock={p.stock} threshold={p.low_stock_threshold} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {scanFor && (
        <BarcodeScanner
          open={!!scanFor}
          onClose={() => setScanFor(null)}
          onDetected={(code) => setBarcode.mutate({ id: scanFor.id, barcode: code })}
        />
      )}
    </div>
  );
}

function ProductDialog({ categories, onSubmit }: { categories: any[]; onSubmit: (f: any) => void }) {
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("0"); const [stock, setStock] = useState("0"); const [threshold, setThreshold] = useState("5");
  const [categoryId, setCategoryId] = useState<string>("");

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} /></div>
          <div><Label>Barcode</Label><Input value={barcode} onChange={e => setBarcode(e.target.value)} /></div>
        </div>
        <div><Label>Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Price</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div><Label>Stock</Label><Input type="number" value={stock} onChange={e => setStock(e.target.value)} /></div>
          <div><Label>Low at</Label><Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button className="gradient-primary text-primary-foreground border-0" onClick={() => onSubmit({
          name, sku: sku || null, barcode: barcode || null,
          category_id: categoryId || null,
          price: Number(price), stock: Number(stock), low_stock_threshold: Number(threshold),
        })}>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}
