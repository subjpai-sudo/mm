import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ScanLine, Pencil, Trash2, ImagePlus, ImageIcon, Calendar, User as UserIcon, Barcode, FolderTree, ChevronRight, ChevronDown, Maximize2, Minimize2, PackageCheck, AlertTriangle, PackageX, LayoutGrid } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StockStatus } from "./dashboard";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarcodeScanner } from "@/components/app/BarcodeScanner";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { LiveBadge } from "@/components/app/LiveBadge";

type ProductsSearch = { filter?: "all" | "in" | "low" | "out" };
export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
  validateSearch: (s: Record<string, unknown>): ProductsSearch => ({
    filter: s.filter === "in" || s.filter === "low" || s.filter === "out" || s.filter === "all" ? s.filter : undefined,
  }),
});

function ProductsPage() {
  const { role, user } = useAuth();
  const { lastUpdated } = useRealtimeSync();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">(search.filter ?? "all");
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
  const [manageCats, setManageCats] = useState(false);
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  // Default to collapsed so users pick one main category at a time
  // instead of seeing everything together.
  const [expandedMains, setExpandedMains] = useState<string[]>([]);

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

  // Build category tree: main (no parent) -> children -> products
  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subsByMain = new Map<string, any[]>();
  categories.forEach((c: any) => {
    if (c.parent_id) {
      const arr = subsByMain.get(c.parent_id) ?? [];
      arr.push(c);
      subsByMain.set(c.parent_id, arr);
    }
  });
  const productsByCat = new Map<string, any[]>();
  filtered.forEach((p: any) => {
    const key = p.category_id ?? "__none__";
    const arr = productsByCat.get(key) ?? [];
    arr.push(p);
    productsByCat.set(key, arr);
  });
  const uncategorized = productsByCat.get("__none__") ?? [];

  const allMainIds = mainCats.map((c: any) => c.id).concat(uncategorized.length ? ["__none__"] : []);
  const accordionValue = expandedMains;
  const allSubsFlat: { sub: any; main: any }[] = [];
  mainCats.forEach((mc: any) => (subsByMain.get(mc.id) ?? []).forEach((sub: any) => allSubsFlat.push({ sub, main: mc })));

  const toggleSub = (id: string) => {
    setCollapsedSubs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const expandAll = () => { setExpandedMains(allMainIds); setCollapsedSubs(new Set()); };
  const collapseAll = () => { setExpandedMains([]); setCollapsedSubs(new Set(allSubsFlat.map(x => x.sub.id))); };
  const jumpToSub = (subId: string) => {
    const found = allSubsFlat.find(x => x.sub.id === subId);
    if (!found) return;
    setExpandedMains(prev => prev.includes(found.main.id) ? prev : [...prev, found.main.id]);
    setCollapsedSubs(prev => { const next = new Set(prev); next.delete(subId); return next; });
    setTimeout(() => {
      document.getElementById(`sub-${subId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Products"
        subtitle={`${products.length} items in catalog`}
        actions={canEdit ? (
          <div className="flex gap-2 flex-wrap items-center">
            <LiveBadge lastUpdated={lastUpdated} className="mr-1" />
            <Button variant="secondary" onClick={() => setManageCats(true)}><FolderTree className="size-4" /> Categories</Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-primary-foreground border-0"><Plus className="size-4" /> New product</Button>
              </DialogTrigger>
              <ProductDialog categories={categories} onSubmit={(f) => create.mutate(f)} />
            </Dialog>
          </div>
        ) : <LiveBadge lastUpdated={lastUpdated} />}
      />

      <Card className="card-elevated p-3 mb-4 space-y-2">
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, SKU, barcode" className="pl-9" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
          {([
            { id: "all", label: "All", icon: LayoutGrid, count: products.length },
            { id: "in", label: "In stock", icon: PackageCheck, count: products.filter((p: any) => p.stock > p.low_stock_threshold).length },
            { id: "low", label: "Low", icon: AlertTriangle, count: products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold).length },
            { id: "out", label: "Out", icon: PackageX, count: products.filter((p: any) => p.stock <= 0).length },
          ] as const).map(t => {
            const active = filter === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => setFilter(t.id as any)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-semibold transition active:scale-[0.97]",
                  active
                    ? t.id === "low" ? "border-warning bg-warning text-warning-foreground"
                      : t.id === "out" ? "border-destructive bg-destructive text-destructive-foreground"
                      : t.id === "in" ? "border-success bg-success text-success-foreground"
                      : "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary/40 hover:bg-secondary text-foreground"
                )}>
                <Icon className="size-3.5" />
                {t.label}
                <span className={cn("ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] tabular-nums",
                  active ? "bg-background/20" : "bg-background/60 text-muted-foreground")}>{t.count}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {allSubsFlat.length > 0 && (
        <Card className="card-elevated p-3 mb-4 flex flex-wrap gap-2 items-center">
          <Select value="" onValueChange={jumpToSub}>
            <SelectTrigger className="flex-1 min-w-[200px]">
              <SelectValue placeholder="Jump to subcategory…" />
            </SelectTrigger>
            <SelectContent>
              {allSubsFlat.map(({ sub, main }) => (
                <SelectItem key={sub.id} value={sub.id}>
                  <span className="text-muted-foreground">{main.name}</span> › <span className="font-semibold">{sub.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="secondary" size="sm" onClick={expandAll}><Maximize2 className="size-3.5" /> Expand all</Button>
          <Button variant="secondary" size="sm" onClick={collapseAll}><Minimize2 className="size-3.5" /> Collapse all</Button>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card className="card-elevated p-12 text-center text-muted-foreground">No products found</Card>
      ) : (
        <Accordion type="multiple" value={accordionValue} onValueChange={setExpandedMains} className="space-y-3">
          {mainCats.map((mc: any) => {
            const subs = subsByMain.get(mc.id) ?? [];
            const directProducts = productsByCat.get(mc.id) ?? [];
            const subItemCount = subs.reduce((s, sub) => s + (productsByCat.get(sub.id)?.length ?? 0), 0);
            const totalCount = directProducts.length + subItemCount;
            if (totalCount === 0) return null;
            return (
              <Card key={mc.id} className="card-elevated p-0 overflow-hidden">
                <AccordionItem value={mc.id} className="border-0">
                  <AccordionTrigger className="px-4 py-4 hover:no-underline hover:bg-secondary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="size-9 rounded-lg gradient-primary grid place-items-center shrink-0">
                        <FolderTree className="size-4 text-primary-foreground" />
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="font-bold text-base truncate">{mc.name}</div>
                        <div className="text-[11px] text-muted-foreground">{totalCount} items</div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-2 pb-2">
                    {subs.map((sub: any) => {
                      const items = productsByCat.get(sub.id) ?? [];
                      if (items.length === 0) return null;
                      const collapsed = collapsedSubs.has(sub.id);
                      return (
                        <div key={sub.id} id={`sub-${sub.id}`} className="mb-3 scroll-mt-20">
                          <button type="button" onClick={() => toggleSub(sub.id)}
                            className="w-full flex items-center gap-2 px-2 py-2 mb-1 sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-l-4 border-primary rounded-r-md hover:bg-secondary/40 transition-colors text-left">
                            <ChevronDown className={cn("size-4 text-primary transition-transform", collapsed && "-rotate-90")} />
                            <span className="text-base font-bold tracking-wide flex-1 truncate">{sub.name}</span>
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/15 text-primary">{items.length}</span>
                          </button>
                          {!collapsed && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {items.map((p: any) => (
                                <ProductCard key={p.id} p={p} canEdit={canEdit} canDelete={canDelete}
                                  onView={() => setViewing(p)} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)}
                                  onScan={() => setScanFor({ id: p.id, name: p.name })} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {directProducts.length > 0 && (
                      <div className="mb-1">
                        {subs.length > 0 && (
                          <div className="flex items-center gap-2 px-2 py-2 mb-1 border-l-4 border-muted rounded-r-md">
                            <span className="text-base font-bold tracking-wide text-muted-foreground">Other</span>
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{directProducts.length}</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {directProducts.map((p: any) => (
                            <ProductCard key={p.id} p={p} canEdit={canEdit} canDelete={canDelete}
                              onView={() => setViewing(p)} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)}
                              onScan={() => setScanFor({ id: p.id, name: p.name })} />
                          ))}
                        </div>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Card>
            );
          })}
          {uncategorized.length > 0 && (
            <Card className="card-elevated p-0 overflow-hidden">
              <AccordionItem value="__none__" className="border-0">
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-secondary/40">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FolderTree className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold truncate">Uncategorized</span>
                    <span className="text-xs text-muted-foreground shrink-0">· {uncategorized.length} items</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-2 pb-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {uncategorized.map((p: any) => (
                      <ProductCard key={p.id} p={p} canEdit={canEdit} canDelete={canDelete}
                        onView={() => setViewing(p)} onEdit={() => setEditing(p)} onDelete={() => setDeleting(p)}
                        onScan={() => setScanFor({ id: p.id, name: p.name })} />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Card>
          )}
        </Accordion>
      )}

      {manageCats && <CategoryManagerDialog categories={categories} onClose={() => setManageCats(false)} />}

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
  const [mainCatId, setMainCatId] = useState<string>("");
  const [subCatId, setSubCatId] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [scanOpen, setScanOpen] = useState(false);

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);
  const categoryId = subCatId || mainCatId;

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
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Category</Label>
            <Select value={mainCatId} onValueChange={(v) => { setMainCatId(v); setSubCatId(""); }}>
              <SelectTrigger><SelectValue placeholder="e.g. Rice" /></SelectTrigger>
              <SelectContent>{mainCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Vendor / Subcategory</Label>
            <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId || subCats.length === 0}>
              <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors yet" : "Select vendor"} /></SelectTrigger>
              <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
  const initialCat = categories.find((c: any) => c.id === product.category_id);
  const initialMainId = initialCat ? (initialCat.parent_id ?? initialCat.id) : "";
  const initialSubId = initialCat && initialCat.parent_id ? initialCat.id : "";
  const [mainCatId, setMainCatId] = useState<string>(initialMainId);
  const [subCatId, setSubCatId] = useState<string>(initialSubId);
  const [imageUrl, setImageUrl] = useState<string>(product.image_url ?? "");
  const [scanOpen, setScanOpen] = useState(false);

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);
  const categoryId = subCatId || mainCatId;

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
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Category</Label>
              <Select value={mainCatId} onValueChange={(v) => { setMainCatId(v); setSubCatId(""); }}>
                <SelectTrigger><SelectValue placeholder="e.g. Rice" /></SelectTrigger>
                <SelectContent>{mainCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vendor / Subcategory</Label>
              <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId || subCats.length === 0}>
                <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors yet" : "Select vendor"} /></SelectTrigger>
                <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
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

function ProductDetailDialog({ product, onClose, onEdit, onScan, canEdit }:
  { product: any; onClose: () => void; onEdit: () => void; onScan: () => void; canEdit: boolean }) {
  const { data: lastMove } = useQuery({
    queryKey: ["product-last-movement", product.id],
    queryFn: async () => {
      const { data } = await supabase.from("stock_movements")
        .select("*").eq("product_id", product.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return null;
      let email: string | null = null;
      if (data.user_id) {
        const { data: prof } = await supabase.from("profiles").select("email,full_name").eq("id", data.user_id).maybeSingle();
        email = prof?.full_name || prof?.email || null;
      }
      return { ...data, by: email };
    },
  });
  const { data: registrar } = useQuery({
    queryKey: ["product-barcode-registrar", product.id, product.barcode_registered_by],
    enabled: !!product.barcode_registered_by,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("email,full_name").eq("id", product.barcode_registered_by).maybeSingle();
      return data?.full_name || data?.email || null;
    },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{product.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-4">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="size-32 rounded-xl object-cover border border-border" />
            ) : (
              <div className="size-32 rounded-xl bg-secondary grid place-items-center text-muted-foreground border border-border"><ImageIcon className="size-10" /></div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5 text-sm">
              <div className="text-xs text-muted-foreground">{product.categories?.name ?? "Uncategorized"}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{product.stock}</span>
                <span className="text-xs text-muted-foreground">in stock · low at {product.low_stock_threshold}</span>
              </div>
              <div><StockStatus stock={product.stock} threshold={product.low_stock_threshold} /></div>
              <div className="text-xs text-muted-foreground">SKU <span className="font-mono">{product.sku ?? "—"}</span></div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Barcode className="size-3.5" />Barcode</div>
            {product.barcode ? (
              <>
                <div className="font-mono text-base">{product.barcode}</div>
                {product.barcode_registered_at && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1"><UserIcon className="size-3" />{registrar ?? "Unknown"}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1"><Calendar className="size-3" />{format(new Date(product.barcode_registered_at), "PP p")}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground italic">Not registered yet</div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-1 text-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Last stock update</div>
            {lastMove ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
                    lastMove.type === "in" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {lastMove.type === "in" ? "Stock In" : "Stock Out"} · {lastMove.quantity}
                  </span>
                  {lastMove.reason && <span className="text-xs text-muted-foreground truncate">{lastMove.reason}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1"><UserIcon className="size-3" />{lastMove.by ?? "Unknown"}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Calendar className="size-3" />
                    {formatDistanceToNow(new Date(lastMove.created_at), { addSuffix: true })}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground italic">No stock movements yet</div>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 flex-wrap sm:flex-nowrap">
          {canEdit && <Button variant="secondary" onClick={onScan}><ScanLine className="size-4" /> Scan barcode</Button>}
          {canEdit && <Button onClick={onEdit} className="gradient-primary text-primary-foreground border-0"><Pencil className="size-4" /> Edit</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
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

function ProductCard({ p, canEdit, canDelete, onView, onEdit, onDelete, onScan }:
  { p: any; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void; onScan: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card hover:bg-secondary/40 hover:border-primary/40 transition-colors cursor-pointer overflow-hidden" onClick={onView}>
      <div className="flex items-start gap-3 p-3">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} className="size-14 rounded-lg object-cover border border-border shrink-0" />
        ) : (
          <div className="size-14 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><ImageIcon className="size-5" /></div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-semibold text-sm leading-tight line-clamp-2">{p.name}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <StockStatus stock={p.stock} threshold={p.low_stock_threshold} />
            <span className="text-[11px] text-muted-foreground">Qty <span className="text-foreground font-bold">{p.stock}</span></span>
          </div>
          {p.barcode && <div className="font-mono text-[10px] text-muted-foreground truncate">{p.barcode}</div>}
        </div>
      </div>
      {canEdit && (
        <div className="flex border-t border-border divide-x divide-border" onClick={(e) => e.stopPropagation()}>
          <button onClick={onScan} className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <ScanLine className="size-3.5" /> Scan
          </button>
          <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <Pencil className="size-3.5" /> Edit
          </button>
          {canDelete && (
            <button onClick={onDelete} className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="size-3.5" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryManagerDialog({ categories, onClose }: { categories: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("__root__");
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [editName, setEditName] = useState("");

  const mainCats = categories.filter((c: any) => !c.parent_id);

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name required");
      const { error } = await supabase.from("categories").insert({ name: name.trim(), parent_id: parentId === "__root__" ? null : parentId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setName(""); toast.success("Category added"); },
    onError: (e: any) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("categories").update({ name: editName.trim() }).eq("id", editingCat.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setEditingCat(null); toast.success("Category renamed"); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Category removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Manage categories</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-auto">
          <div className="rounded-xl border border-border p-3 space-y-2 bg-secondary/30">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add new</div>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" />
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">— Top level (main category)</SelectItem>
                {mainCats.map(c => <SelectItem key={c.id} value={c.id}>Sub of: {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="gradient-primary text-primary-foreground border-0 w-full" onClick={() => create.mutate()}>
              <Plus className="size-4" /> Add category
            </Button>
          </div>
          <div className="space-y-2">
            {mainCats.map((mc: any) => {
              const subs = categories.filter((c: any) => c.parent_id === mc.id);
              return (
                <div key={mc.id} className="rounded-lg border border-border">
                  <CategoryRow cat={mc} onEdit={() => { setEditingCat(mc); setEditName(mc.name); }} onDelete={() => remove.mutate(mc.id)} />
                  {subs.map((sub: any) => (
                    <div key={sub.id} className="pl-6 border-t border-border">
                      <CategoryRow cat={sub} onEdit={() => { setEditingCat(sub); setEditName(sub.name); }} onDelete={() => remove.mutate(sub.id)} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Done</Button></DialogFooter>
        {editingCat && (
          <Dialog open onOpenChange={(v) => !v && setEditingCat(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Rename category</DialogTitle></DialogHeader>
              <Input value={editName} onChange={e => setEditName(e.target.value)} />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditingCat(null)}>Cancel</Button>
                <Button className="gradient-primary text-primary-foreground border-0" onClick={() => rename.mutate()}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({ cat, onEdit, onDelete }: { cat: any; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex-1 text-sm truncate">{cat.name}</span>
      <Button variant="ghost" size="icon" className="size-8" onClick={onEdit}><Pencil className="size-3.5" /></Button>
      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="size-3.5" /></Button>
    </div>
  );
}
