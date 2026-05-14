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
import { Plus, Search, ScanLine, Pencil, Trash2, ImagePlus, ImageIcon, Calendar, User as UserIcon, Barcode } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StockStatus } from "./dashboard";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { formatDistanceToNow, format } from "date-fns";

export const Route = createFileRoute("/_authenticated/products")({ component: ProductsPage });

function ProductsPage() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">("all");
  const [open, setOpen] = useState(false);
  const [scanFor, setScanFor] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

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
      const { error } = await supabase.from("products")
        .update({ barcode, barcode_registered_by: user?.id, barcode_registered_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setScanFor(null); toast.success("Barcode registered"); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const { error } = await supabase.from("products").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setEditing(null); toast.success("Product updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setDeleting(null); toast.success("Product deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const canEdit = !!role;
  const canDelete = !!role;

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
            <TableHead className="w-14">Photo</TableHead>
            <TableHead>Name</TableHead><TableHead className="hidden md:table-cell">Category</TableHead><TableHead>Barcode</TableHead>
            <TableHead className="hidden sm:table-cell">Price</TableHead><TableHead>Stock</TableHead><TableHead className="hidden md:table-cell">Status</TableHead>
            {canEdit && <TableHead className="w-[120px] text-right">Actions</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={canEdit ? 8 : 7} className="text-center text-muted-foreground py-12">No products found</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => setViewing(p)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="size-10 rounded-lg object-cover border border-border" />
                  ) : (
                    <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{p.sku ?? "—"}</div>
                </TableCell>
                <TableCell className="text-muted-foreground hidden md:table-cell">{p.categories?.name ?? "—"}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" className="h-8 px-2 font-mono text-xs gap-1"
                      onClick={() => setScanFor({ id: p.id, name: p.name })}>
                      <ScanLine className="size-3.5" />{p.barcode ?? "Register"}
                    </Button>
                  ) : (<span className="font-mono text-xs">{p.barcode ?? "—"}</span>)}
                </TableCell>
                <TableCell className="hidden sm:table-cell">${Number(p.price).toFixed(2)}</TableCell>
                <TableCell>{p.stock}</TableCell>
                <TableCell className="hidden md:table-cell"><StockStatus stock={p.stock} threshold={p.low_stock_threshold} /></TableCell>
                {canEdit && (
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(p)} aria-label="Edit"><Pencil className="size-3.5" /></Button>
                      {canDelete && <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => setDeleting(p)} aria-label="Delete"><Trash2 className="size-3.5" /></Button>}
                    </div>
                  </TableCell>
                )}
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

      {editing && (
        <ProductEditDialog
          product={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={(patch) => update.mutate({ id: editing.id, patch })}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete product?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove <span className="font-medium text-foreground">{deleting?.name}</span> and its stock history references.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewing && (
        <ProductDetailDialog product={viewing} onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onScan={() => { setScanFor({ id: viewing.id, name: viewing.name }); setViewing(null); }}
          canEdit={canEdit} />
      )}
    </div>
  );
}

function ProductDialog({ categories, onSubmit }: { categories: any[]; onSubmit: (f: any) => void }) {
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("0"); const [stock, setStock] = useState("0"); const [threshold, setThreshold] = useState("5");
  const [categoryId, setCategoryId] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <ImagePicker value={imageUrl} onChange={setImageUrl} />
        <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} /></div>
          <div>
            <Label>Barcode</Label>
            <div className="flex gap-1">
              <Input value={barcode} onChange={e => setBarcode(e.target.value)} className="font-mono" />
              <Button type="button" size="icon" variant="secondary" onClick={() => setScanOpen(true)} aria-label="Scan"><ScanLine className="size-4" /></Button>
            </div>
          </div>
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
          image_url: imageUrl || null,
          price: Number(price), stock: Number(stock), low_stock_threshold: Number(threshold),
        })}>Create</Button>
      </DialogFooter>
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(c) => { setBarcode(c); setScanOpen(false); }} />
    </DialogContent>
  );
}

function ProductEditDialog({ product, categories, onClose, onSave }: { product: any; categories: any[]; onClose: () => void; onSave: (patch: any) => void }) {
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [price, setPrice] = useState(String(product.price ?? 0));
  const [stock, setStock] = useState(String(product.stock ?? 0));
  const [threshold, setThreshold] = useState(String(product.low_stock_threshold ?? 5));
  const [categoryId, setCategoryId] = useState<string>(product.category_id ?? "");
  const [imageUrl, setImageUrl] = useState<string>(product.image_url ?? "");
  const [scanOpen, setScanOpen] = useState(false);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit product</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <ImagePicker value={imageUrl} onChange={setImageUrl} />
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} /></div>
            <div>
              <Label>Barcode</Label>
              <div className="flex gap-1">
                <Input value={barcode} onChange={e => setBarcode(e.target.value)} className="font-mono" />
                <Button type="button" size="icon" variant="secondary" onClick={() => setScanOpen(true)} aria-label="Scan"><ScanLine className="size-4" /></Button>
              </div>
            </div>
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className="gradient-primary text-primary-foreground border-0" onClick={() => onSave({
            name, sku: sku || null, barcode: barcode || null,
            category_id: categoryId || null, image_url: imageUrl || null,
            price: Number(price), stock: Number(stock), low_stock_threshold: Number(threshold),
          })}>Save changes</Button>
        </DialogFooter>
        <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(c) => { setBarcode(c); setScanOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ImagePicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  async function handleFile(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img src={value} alt="Product" className="size-20 rounded-xl object-cover border border-border" />
      ) : (
        <div className="size-20 rounded-xl border border-dashed border-border bg-secondary grid place-items-center text-muted-foreground">
          <ImageIcon className="size-6" />
        </div>
      )}
      <div className="space-y-2">
        <label className="inline-flex">
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <span className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/70 cursor-pointer">
            <ImagePlus className="size-3.5" />{uploading ? "Uploading…" : value ? "Change picture" : "Add picture"}
          </span>
        </label>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => onChange("")}>Remove</Button>
        )}
      </div>
    </div>
  );
}
