import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, getCachedStorageUrl } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ScanLine, Pencil, Trash2, ImagePlus, ImageIcon, Calendar, User as UserIcon, Barcode, FolderTree, ChevronRight, ChevronDown, Zap, Check, SkipForward, Warehouse, ClipboardList, Wand2, Images } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StockStatus } from "./dashboard";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { StrichScanner } from "@/components/app/StrichScanner";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { LiveBadge } from "@/components/app/LiveBadge";
import { useServerFn } from "@/lib/use-server-fn";
import { uploadProductImageFile, cleanProductImageAI } from "@/lib/product-images.functions";
import { ProductImageZoom } from "@/components/app/ProductImageZoom";
import { BulkAssignShelfDialog } from "@/components/app/BulkAssignShelfDialog";
import { SIZE_UNITS, parseSize, displaySize, extractSizeFromName } from "@/lib/product-format";
import { categoryPalette } from "@/lib/category-colors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function stockInBoxes(stock: number, pcsPerCase: number | null | undefined): string | null {
  if (!pcsPerCase || pcsPerCase < 2) return null;
  const boxes = Math.floor(stock / pcsPerCase);
  const rem = stock - boxes * pcsPerCase;
  if (boxes <= 0 && rem <= 0) return null;
  return rem === 0
    ? `${boxes} box${boxes === 1 ? "" : "es"}`
    : `${boxes} box${boxes === 1 ? "" : "es"} + ${rem} pcs`;
}

type ProductsSearch = { filter?: "all" | "in" | "low" | "out"; edit?: string; mc?: string; sc?: string };
export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
  validateSearch: (s: Record<string, unknown>): ProductsSearch => ({
    filter: s.filter === "in" || s.filter === "low" || s.filter === "out" || s.filter === "all" ? s.filter : undefined,
    edit: typeof s.edit === "string" ? s.edit : undefined,
    mc: typeof s.mc === "string" ? s.mc : undefined,
    sc: typeof s.sc === "string" ? s.sc : undefined,
  }),
});

const IS_LOCAL_PREVIEW = import.meta.env.VITE_LOCAL_PREVIEW === "true";

function ProductsPage() {
  const { role, user } = useAuth();
  const { lastUpdated } = useRealtimeSync({ silent: true });
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">(search.filter ?? "all");
  const [mainFilter, setMainFilter] = useState<string>(search.mc ?? "all");
  const [subFilter, setSubFilter] = useState<string>(search.sc ?? "all");
  const [noBarcode, setNoBarcode] = useState(false);

  // Keep filters in URL so browser back restores them
  const setMainFilterUrl = (v: string) => {
    setMainFilter(v);
    setSubFilter("all");
    navigate({ to: "/products", search: (prev: any) => ({ ...prev, mc: v !== "all" ? v : undefined, sc: undefined }), replace: true });
  };
  const setSubFilterUrl = (v: string) => {
    setSubFilter(v);
    navigate({ to: "/products", search: (prev: any) => ({ ...prev, sc: v !== "all" ? v : undefined }), replace: true });
  };
  const [open, setOpen] = useState(false);
  const [scanFor, setScanFor] = useState<{ id: string; name: string } | null>(null);
  const [rapidOpen, setRapidOpen] = useState(false);
  const [bulkShelfOpen, setBulkShelfOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const openProduct = (p: any) => navigate({ to: "/products/$productId", params: { productId: p.id } });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*, categories(name)").order("created_at", { ascending: false })).data ?? [],
  });

  // Auto-open editor when arriving via ?edit=<productId>
  useEffect(() => {
    if (!search.edit || editing) return;
    const target = (products as any[]).find((p) => p.id === search.edit);
    if (target) {
      setEditing(target);
      navigate({ to: "/products", search: { filter: search.filter } as any, replace: true });
    }
  }, [search.edit, products, editing, navigate, search.filter]);
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const [manageCats, setManageCats] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  // Default to collapsed so users pick one main category at a time
  // instead of seeing everything together.
  const [expandedMains, setExpandedMains] = useState<string[]>([]);

  const filtered = products.filter((p: any) => {
    if (q && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "out" && p.stock > 0) return false;
    if (filter === "low" && !(p.stock > 0 && p.stock <= p.low_stock_threshold)) return false;
    if (filter === "in" && !(p.stock > p.low_stock_threshold)) return false;
    if (mainFilter !== "all") {
      const cat = categories.find((c: any) => c.id === p.category_id);
      const mainId = cat ? (cat.parent_id ?? cat.id) : null;
      if (mainId !== mainFilter) return false;
    }
    if (subFilter !== "all" && p.category_id !== subFilter) return false;
    if (noBarcode && p.barcode) return false;
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
        title="MAIN Product List"
        subtitle={`${products.length} warehouse products with SKU, barcode, price and stock`}
        actions={canEdit ? (
          <div className="flex items-center gap-2 flex-wrap">
            {!IS_LOCAL_PREVIEW && <LiveBadge lastUpdated={lastUpdated} className="mr-1" />}
            <div className="inline-flex items-center gap-1 p-1 rounded-2xl border border-border bg-card/60 backdrop-blur">
              <Button size="icon" variant="ghost" title="Assign to shelf" onClick={() => setBulkShelfOpen(true)}>
                <Warehouse className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Categories" onClick={() => setManageCats(true)}>
                <FolderTree className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Import products" onClick={() => setImportOpen(true)}>
                <ClipboardList className="size-4" />
              </Button>
              <div className="mx-1 w-px h-6 bg-border" />
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground border-0 rounded-xl"><Plus className="size-4" /> New product</Button>
                </DialogTrigger>
                <ProductDialog categories={categories} onSubmit={(f) => create.mutate(f)} />
              </Dialog>
            </div>
          </div>
        ) : !IS_LOCAL_PREVIEW ? <LiveBadge lastUpdated={lastUpdated} /> : null}
      />

      {/* Unified search + status segmented control */}
      <div className="mb-3 rounded-2xl border border-border bg-card/60 backdrop-blur p-2 flex items-center gap-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition">
        <Search className="size-4 ml-2 text-muted-foreground shrink-0" />
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, SKU, barcode…"
          className="flex-1 min-w-0 h-9 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0"
        />
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-background text-[10px] font-mono text-muted-foreground shrink-0">⌘ K</kbd>
        <div className="hidden md:block w-px h-6 bg-border shrink-0" />
        <div className="hidden md:inline-flex p-0.5 rounded-xl border border-border bg-background gap-0.5 shrink-0">
          {([
            { id: "all", label: "All", count: products.length, tone: "text-primary" },
            { id: "in", label: "In stock", count: products.filter((p: any) => p.stock > p.low_stock_threshold).length, tone: "text-success" },
            { id: "low", label: "Low", count: products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold).length, tone: "text-warning" },
            { id: "out", label: "Out", count: products.filter((p: any) => p.stock <= 0).length, tone: "text-destructive" },
          ] as const).map(t => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id as any)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-semibold transition",
                  active ? `bg-card ${t.tone} shadow-sm` : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                <span className={cn(
                  "px-1.5 py-px rounded-full text-[10px] font-mono tabular-nums",
                  active ? "bg-current/15 text-current" : "bg-background text-muted-foreground"
                )}>{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile-only status pills (md+ shows them in search bar) */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
        {([
          { id: "all", label: "All", count: products.length },
          { id: "in", label: "In stock", count: products.filter((p: any) => p.stock > p.low_stock_threshold).length },
          { id: "low", label: "Low", count: products.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold).length },
          { id: "out", label: "Out", count: products.filter((p: any) => p.stock <= 0).length },
        ] as const).map(t => {
          const active = filter === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setFilter(t.id as any)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40"
              )}>
              {t.label}
              <span className={cn("px-1.5 py-px rounded-full text-[10px] tabular-nums",
                active ? "bg-background/25" : "bg-background/60 text-muted-foreground")}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {mainCats.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Select value={mainFilter} onValueChange={setMainFilterUrl}>
            <SelectTrigger className="w-auto h-10 rounded-xl border-border bg-card/60 backdrop-blur gap-2 px-3 text-sm font-semibold">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Cat</span>
              <SelectValue />
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-background border border-border text-[10px] font-mono text-muted-foreground tabular-nums">
                {mainCats.length}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {mainCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select
            value={subFilter}
            onValueChange={setSubFilterUrl}
            disabled={mainFilter === "all" || (subsByMain.get(mainFilter)?.length ?? 0) === 0}
          >
            <SelectTrigger className="w-auto h-10 rounded-xl border-border bg-card/60 backdrop-blur gap-2 px-3 text-sm font-semibold">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Vendor</span>
              <SelectValue placeholder={mainFilter === "all" ? "Pick category first" : "All vendors"} />
              {mainFilter !== "all" && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-background border border-border text-[10px] font-mono text-muted-foreground tabular-nums">
                  {subsByMain.get(mainFilter)?.length ?? 0}
                </span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {(subsByMain.get(mainFilter) ?? []).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setNoBarcode((v) => !v)}
            className={cn("inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border text-sm font-semibold transition",
              noBarcode ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card/60 text-muted-foreground hover:text-foreground")}
          >
            <Barcode className="size-4" /> No barcode
          </button>
        </div>
      )}

      {(() => {
        const sections = mainCats
          .map((mc: any) => {
            const subs = subsByMain.get(mc.id) ?? [];
            const items = [
              ...(productsByCat.get(mc.id) ?? []),
              ...subs.flatMap((s: any) => productsByCat.get(s.id) ?? []),
            ];
            return { id: mc.id, name: mc.name, items };
          })
          .filter((s) => s.items.length > 0);
        if (uncategorized.length > 0) {
          sections.push({ id: "__none__", name: "Uncategorized", items: uncategorized });
        }
        if (filtered.length === 0) {
          return <Card className="card-elevated p-12 text-center text-muted-foreground">No products found</Card>;
        }
        return (
          <>
            {sections.length > 1 && (
              <div className="mb-4 sticky top-2 z-20">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-border bg-card/80 backdrop-blur text-xs font-semibold text-foreground hover:border-foreground/30 transition"
                    >
                      <FolderTree className="size-3.5 text-muted-foreground" />
                      <span>Jump to category</span>
                      <span className="flex -space-x-1">
                        {sections.slice(0, 5).map((s) => (
                          <span
                            key={s.id}
                            className="size-2.5 rounded-full ring-1 ring-card"
                            style={{ background: categoryPalette(s.name).bg }}
                          />
                        ))}
                      </span>
                      <span className="px-1.5 py-px rounded-full text-[10px] font-mono tabular-nums bg-background border border-border text-muted-foreground">
                        {sections.length}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-1.5 max-h-[60vh] overflow-y-auto">
                    <div className="flex flex-col gap-0.5">
                      {sections.map((s) => {
                        const pal = categoryPalette(s.name);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() =>
                              document
                                .getElementById(`cat-${s.id}`)
                                ?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                            className="w-full inline-flex items-center gap-2 h-8 px-2 rounded-md text-xs font-medium text-foreground hover:bg-muted transition text-left"
                          >
                            <span
                              className="size-2.5 rounded-full shrink-0"
                              style={{ background: pal.bg }}
                            />
                            <span className="flex-1 truncate">{s.name}</span>
                            <span className="px-1.5 py-px rounded-full text-[10px] font-mono tabular-nums bg-muted text-muted-foreground">
                              {s.items.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className="space-y-6">
              {sections.map((s) => {
                const pal = categoryPalette(s.name);
                return (
                  <section key={s.id} id={`cat-${s.id}`} className="scroll-mt-24">
                    <div
                      className="flex items-center gap-2 mb-2.5 px-3 py-2 rounded-lg border-l-4"
                      style={{ borderLeftColor: pal.bg, background: pal.soft }}
                    >
                      <FolderTree className="size-4" style={{ color: pal.accent }} />
                      <h2 className="font-bold text-base" style={{ color: pal.accent }}>{s.name}</h2>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: pal.bg, color: pal.fg }}
                      >
                        {s.items.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {s.items.map((p: any) => (
                        <ProductCard
                          key={p.id}
                          p={p}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          onView={() => openProduct(p)}
                          onEdit={() => setEditing(p)}
                          onDelete={() => setDeleting(p)}
                          onScan={() => setScanFor({ id: p.id, name: p.name })}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        );
      })()}

      {manageCats && <CategoryManagerDialog categories={categories} onClose={() => setManageCats(false)} />}
      {importOpen && (
        <BulkImportDialog
          categories={categories}
          defaultMainId={mainFilter !== "all" ? mainFilter : ""}
          defaultSubId={subFilter !== "all" ? subFilter : ""}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      {scanFor && (
        <StrichScanner
          open={!!scanFor}
          onClose={() => setScanFor(null)}
          onDetected={(code) => setBarcode.mutate({ id: scanFor.id, barcode: code })}
        />
      )}

      {rapidOpen && (
        <RapidScanDialog
          products={products}
          categories={categories}
          userId={user?.id}
          onClose={() => { setRapidOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); }}
        />
      )}

      {bulkShelfOpen && (
        <BulkAssignShelfDialog
          products={products}
          onClose={() => { setBulkShelfOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); }}
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

    </div>
  );
}

function ProductDialog({ categories, onSubmit }: { categories: any[]; onSubmit: (f: any) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("0"); const [stock, setStock] = useState("0"); const [threshold, setThreshold] = useState("5");
  const [sizeNum, setSizeNum] = useState(""); const [sizeUnit, setSizeUnit] = useState<string>("g");
  const [pcsPerCase, setPcsPerCase] = useState("");
  const [mainCatId, setMainCatId] = useState<string>("");
  const [subCatId, setSubCatId] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [scanOpen, setScanOpen] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);

  async function createVendor() {
    if (!newVendorName.trim() || !mainCatId) return;
    const { data, error } = await supabase.from("categories").insert({ name: newVendorName.trim(), parent_id: mainCatId }).select().single();
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["categories"] });
    setSubCatId(data.id);
    setNewVendorName("");
    setAddingVendor(false);
    toast.success("Vendor added");
  }
  const categoryId = subCatId || mainCatId;
  const mainName = mainCats.find((c: any) => c.id === mainCatId)?.name;
  const subName = subCats.find((c: any) => c.id === subCatId)?.name;

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New product</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <ImagePicker value={imageUrl} onChange={setImageUrl} productName={name} />
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Vendor / Subcategory</Label>
              {mainCatId && !addingVendor && (
                <button type="button" onClick={() => setAddingVendor(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="size-3" /> New vendor
                </button>
              )}
            </div>
            {addingVendor ? (
              <div className="flex gap-1">
                <Input autoFocus placeholder="Vendor name" value={newVendorName} onChange={e => setNewVendorName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") createVendor(); if (e.key === "Escape") { setAddingVendor(false); setNewVendorName(""); } }} className="h-9 text-sm" />
                <Button type="button" size="sm" onClick={createVendor} disabled={!newVendorName.trim()} className="h-9 gradient-primary text-primary-foreground border-0">Add</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingVendor(false); setNewVendorName(""); }} className="h-9 px-2">✕</Button>
              </div>
            ) : (
              <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId}>
                <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors — add one →" : "Select vendor"} /></SelectTrigger>
                <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Path: </span>
          {mainName ? (
            <span className="font-semibold">
              {mainName}
              {subName && <> <ChevronRight className="inline size-3 -mt-0.5 text-muted-foreground" /> {subName}</>}
            </span>
          ) : (
            <span className="italic text-muted-foreground">Uncategorized</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Default price</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div><Label>Stock</Label><Input type="number" value={stock} onChange={e => setStock(e.target.value)} /></div>
          <div><Label>Low at</Label><Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <div><Label>Size</Label><Input type="number" step="0.01" inputMode="decimal" placeholder="400" value={sizeNum} onChange={e => setSizeNum(e.target.value)} /></div>
          <div><Label>Unit</Label>
            <Select value={sizeUnit} onValueChange={setSizeUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SIZE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Pcs per box</Label>
          <Input type="number" inputMode="numeric" placeholder="e.g. 24" value={pcsPerCase} onChange={e => setPcsPerCase(e.target.value)} />
          <p className="text-[11px] text-muted-foreground mt-1">Used to convert boxes → pcs on stock in/out.</p>
        </div>
      </div>
      <DialogFooter>
        <Button className="gradient-primary text-primary-foreground border-0" onClick={() => onSubmit({
          name, sku: sku || null, barcode: barcode || null,
          category_id: categoryId || null,
          image_url: imageUrl || null,
          size: sizeNum ? sizeNum : null,
          unit: sizeNum ? sizeUnit : null,
          price: Number(price), stock: Number(stock), low_stock_threshold: Number(threshold),
          pcs_per_case: pcsPerCase ? Number(pcsPerCase) : null,
        })}>Create</Button>
      </DialogFooter>
      <StrichScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(c) => { setBarcode(c); setScanOpen(false); }} />
    </DialogContent>
  );
}

function ProductEditDialog({ product, categories, onClose, onSave }: { product: any; categories: any[]; onClose: () => void; onSave: (patch: any) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [price, setPrice] = useState(String(product.price ?? 0));
  const [stock, setStock] = useState(String(product.stock ?? 0));
  const [threshold, setThreshold] = useState(String(product.low_stock_threshold ?? 5));
  const _ppc = product.pcs_per_case && product.pcs_per_case > 0 ? product.pcs_per_case : 0;
  const [stockBoxes, setStockBoxes] = useState(String(_ppc > 0 ? Math.floor((product.stock ?? 0) / _ppc) : (product.stock ?? 0)));
  const [stockPcs, setStockPcs] = useState(String(_ppc > 0 ? (product.stock ?? 0) % _ppc : 0));
  const initialSize = parseSize(product.size, product.unit);
  const [sizeNum, setSizeNum] = useState(initialSize.num);
  const [sizeUnit, setSizeUnit] = useState<string>(initialSize.unit || "g");
  const [pcsPerCase, setPcsPerCase] = useState(product.pcs_per_case != null ? String(product.pcs_per_case) : "");
  const initialCat = categories.find((c: any) => c.id === product.category_id);
  const initialMainId = initialCat ? (initialCat.parent_id ?? initialCat.id) : "";
  const initialSubId = initialCat && initialCat.parent_id ? initialCat.id : "";
  const [mainCatId, setMainCatId] = useState<string>(initialMainId);
  const [subCatId, setSubCatId] = useState<string>(initialSubId);
  const [imageUrl, setImageUrl] = useState<string>(product.image_url ?? "");
  const [scanOpen, setScanOpen] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);

  async function createVendor() {
    if (!newVendorName.trim() || !mainCatId) return;
    const { data, error } = await supabase.from("categories").insert({ name: newVendorName.trim(), parent_id: mainCatId }).select().single();
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["categories"] });
    setSubCatId(data.id);
    setNewVendorName("");
    setAddingVendor(false);
    toast.success("Vendor added");
  }
  const categoryId = subCatId || mainCatId;
  const mainName = mainCats.find((c: any) => c.id === mainCatId)?.name;
  const subName = subCats.find((c: any) => c.id === subCatId)?.name;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit product</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <ImagePicker value={imageUrl} onChange={setImageUrl} productName={name} />
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
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Vendor / Subcategory</Label>
                {mainCatId && !addingVendor && (
                  <button type="button" onClick={() => setAddingVendor(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                    <Plus className="size-3" /> New vendor
                  </button>
                )}
              </div>
              {addingVendor ? (
                <div className="flex gap-1">
                  <Input autoFocus placeholder="Vendor name" value={newVendorName} onChange={e => setNewVendorName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") createVendor(); if (e.key === "Escape") { setAddingVendor(false); setNewVendorName(""); } }} className="h-9 text-sm" />
                  <Button type="button" size="sm" onClick={createVendor} disabled={!newVendorName.trim()} className="h-9 gradient-primary text-primary-foreground border-0">Add</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingVendor(false); setNewVendorName(""); }} className="h-9 px-2">✕</Button>
                </div>
              ) : (
                <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId}>
                  <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors — add one →" : "Select vendor"} /></SelectTrigger>
                  <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Path: </span>
            {mainName ? (
              <span className="font-semibold">
                {mainName}
                {subName && <> <ChevronRight className="inline size-3 -mt-0.5 text-muted-foreground" /> {subName}</>}
              </span>
            ) : (
              <span className="italic text-muted-foreground">Uncategorized</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Default price</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div><Label>Low at</Label><Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} /></div>
          </div>
          <div>
            <Label>Pcs per box</Label>
            <Input type="number" inputMode="numeric" placeholder="e.g. 48 (leave blank if not boxed)" value={pcsPerCase} onChange={e => setPcsPerCase(e.target.value)} />
          </div>
          <div>
            <Label>Stock</Label>
            {Number(pcsPerCase) > 0 ? (
              <>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mt-1">
                  <div>
                    <Input type="number" inputMode="numeric" placeholder="Boxes" value={stockBoxes} onChange={e => setStockBoxes(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5">boxes × {pcsPerCase}</p>
                  </div>
                  <span className="text-muted-foreground font-medium">+</span>
                  <div>
                    <Input type="number" inputMode="numeric" placeholder="Pcs" value={stockPcs} onChange={e => setStockPcs(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5">extra pcs</p>
                  </div>
                </div>
                {(() => {
                  const b = Number(stockBoxes) || 0;
                  const p = Number(stockPcs) || 0;
                  const ppc = Number(pcsPerCase);
                  return <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">{b} boxes × {ppc} + {p} pcs = {b * ppc + p} total pcs</p>;
                })()}
              </>
            ) : (
              <Input className="mt-1" type="number" inputMode="numeric" placeholder="0" value={stockBoxes} onChange={e => setStockBoxes(e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div><Label>Size</Label><Input type="number" step="0.01" inputMode="decimal" placeholder="400" value={sizeNum} onChange={e => setSizeNum(e.target.value)} /></div>
            <div><Label>Unit</Label>
              <Select value={sizeUnit} onValueChange={setSizeUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SIZE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost"
            onPointerDown={() => (document.activeElement as HTMLElement)?.blur()}
            onClick={onClose}>Cancel</Button>
          <Button className="gradient-primary text-primary-foreground border-0"
            onPointerDown={() => (document.activeElement as HTMLElement)?.blur()}
            onClick={() => onSave({
              name, sku: sku || null, barcode: barcode || null,
              category_id: categoryId || null,
              image_url: imageUrl || null,
              size: sizeNum ? sizeNum : null,
              unit: sizeNum ? sizeUnit : null,
              price: Number(price),
              stock: Number(pcsPerCase) > 0 ? Number(stockBoxes) * Number(pcsPerCase) + Number(stockPcs) : Number(stockBoxes),
              low_stock_threshold: Number(threshold),
              pcs_per_case: pcsPerCase ? Number(pcsPerCase) : null,
            })}>Save changes</Button>
        </DialogFooter>
        <StrichScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(c) => { setBarcode(c); setScanOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ImagePicker({ value, onChange }: { value: string; onChange: (url: string) => void; productName?: string }) {
  const [uploading, setUploading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const uploadFn = useServerFn(uploadProductImageFile);
  const cleanFn = useServerFn(cleanProductImageAI);

  async function handleFile(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const res = await uploadFn({ data: { dataUrl, ext } });
      onChange(res.url);
      toast.success("Image uploaded");
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleClean() {
    if (!value) return;
    setCleaning(true);
    try {
      const res = await cleanFn({ data: { image: value } });
      onChange(res.url);
      toast.success("Photo cleaned");
    } catch (e: any) {
      toast.error(e.message ?? "Clean failed");
    } finally {
      setCleaning(false);
    }
  }

  const busy = uploading || cleaning;

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img src={value} alt="Product" className="size-20 rounded-xl object-cover border border-border shrink-0" />
      ) : (
        <div className="size-20 rounded-xl border border-dashed border-border bg-secondary grid place-items-center text-muted-foreground shrink-0">
          <ImageIcon className="size-6" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        <label className="inline-flex">
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-border bg-secondary hover:bg-secondary/70 cursor-pointer whitespace-nowrap">
            <ImagePlus className="size-3.5" />{busy ? "Working…" : "Take photo"}
          </span>
        </label>
        <label className="inline-flex">
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-border bg-secondary hover:bg-secondary/70 cursor-pointer whitespace-nowrap">
            <Images className="size-3.5" />Gallery
          </span>
        </label>
        {value && (
          <button
            type="button"
            disabled={busy}
            onClick={handleClean}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-border bg-secondary hover:bg-secondary/70 disabled:opacity-50 whitespace-nowrap"
          >
            <Wand2 className="size-3.5" />Clean photo
          </button>
        )}
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-xs text-destructive rounded-full" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function ProductDetailImage({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  if (src) {
    return (
      <>
        <button
          type="button"
          className="size-32 rounded-xl overflow-hidden border border-border shrink-0"
          onClick={() => setZoomOpen(true)}
        >
          <img src={getCachedStorageUrl(src)} alt={alt} className="size-full object-cover" />
        </button>
        <ProductImageZoom open={zoomOpen} onOpenChange={setZoomOpen} src={getCachedStorageUrl(src)} alt={alt} />
      </>
    );
  }
  return (
    <div className="size-32 rounded-xl bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0">
      <ImageIcon className="size-10" />
    </div>
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
      let by: string | null = null;
      if (data.user_id) {
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", data.user_id).maybeSingle();
        by = prof?.full_name || null;
      }
      return { ...data, by };
    },
  });
  const { data: registrar } = useQuery({
    queryKey: ["product-barcode-registrar", product.id, product.barcode_registered_by],
    enabled: !!product.barcode_registered_by,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("id", product.barcode_registered_by).maybeSingle();
      return data?.full_name || null;
    },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{product.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-4">
            <ProductDetailImage src={product.image_url} alt={product.name} />
            <div className="flex-1 min-w-0 space-y-1.5 text-sm">
              <div className="text-xs text-muted-foreground">{product.categories?.name ?? "Uncategorized"}</div>
              {(() => {
                const ppc = product.pcs_per_case;
                const stock = product.stock ?? 0;
                if (ppc && ppc >= 2) {
                  const boxes = Math.floor(stock / ppc);
                  const pcs = stock % ppc;
                  return (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold">{boxes}</span>
                        <span className="text-sm font-medium text-muted-foreground">boxes</span>
                        <span className="text-lg font-semibold">+</span>
                        <span className="text-2xl font-bold">{pcs}</span>
                        <span className="text-sm font-medium text-muted-foreground">pcs</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{stock} total pcs · {ppc}/box · low at {product.low_stock_threshold}</div>
                    </>
                  );
                }
                return (
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{stock}</span>
                    <span className="text-xs text-muted-foreground">in stock · low at {product.low_stock_threshold}</span>
                  </div>
                );
              })()}
              <div><StockStatus stock={product.stock} threshold={product.low_stock_threshold} /></div>
              <div className="text-xs text-muted-foreground">SKU <span className="font-mono">{product.sku ?? "—"}</span></div>
              {displaySize(product) && (
                <div className="text-xs text-muted-foreground">Size <span className="font-semibold text-foreground">{displaySize(product)}</span></div>
              )}
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

function ProductCard({ p, canEdit, canDelete, onView, onEdit, onDelete, onScan }:
  { p: any; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void; onScan: () => void }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const catName = p.categories?.name || "";
  const pal = categoryPalette(catName);
  return (
    <>
      <div className="rounded-xl border border-border bg-card hover:border-primary/40 transition-colors cursor-pointer overflow-hidden flex flex-col" onClick={onView}>
        {catName && (
          <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider truncate" style={{ background: pal.bg, color: pal.fg }}>
            {catName}
          </div>
        )}
        <div className="p-3 min-w-0 flex-1 space-y-2">
          <div className="flex items-start gap-2">
            <button
              type="button"
              className="size-14 rounded-lg border border-border shrink-0 overflow-hidden bg-secondary grid place-items-center text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); if (p.image_url) setZoomOpen(true); }}
            >
              {p.image_url ? (
                <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm leading-tight line-clamp-2">{p.name}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "No SKU"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StockStatus stock={p.stock} threshold={p.low_stock_threshold} />
            <span className="text-[11px] text-muted-foreground">Stock <span className="text-foreground font-bold">{p.stock}</span></span>
            <span className="text-[11px] text-muted-foreground">¥<span className="text-foreground font-bold">{Number(p.price ?? 0).toLocaleString("en-US")}</span></span>
            {stockInBoxes(p.stock, p.pcs_per_case) && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                {stockInBoxes(p.stock, p.pcs_per_case)}
              </span>
            )}
            {displaySize(p) && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/30">{displaySize(p)}</span>
            )}
          </div>
          {p.barcode && (
            <div className="font-mono text-[10px] text-muted-foreground truncate">{p.barcode}</div>
          )}
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
      <ProductImageZoom open={zoomOpen} onOpenChange={setZoomOpen} src={getCachedStorageUrl(p.image_url)} alt={p.name} />
    </>
  );
}

function CategoryManagerDialog({ categories, onClose }: { categories: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("__root__");
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState<string>("__root__");

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
      const newParent = editParentId === "__root__" ? null : editParentId;
      const { error } = await supabase.from("categories").update({ name: editName.trim(), parent_id: newParent }).eq("id", editingCat.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setEditingCat(null); toast.success("Category updated"); },
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
                  <CategoryRow cat={mc} onEdit={() => { setEditingCat(mc); setEditName(mc.name); setEditParentId("__root__"); }} onDelete={() => remove.mutate(mc.id)} />
                  {subs.map((sub: any) => (
                    <div key={sub.id} className="pl-6 border-t border-border">
                      <CategoryRow cat={sub} onEdit={() => { setEditingCat(sub); setEditName(sub.name); setEditParentId(sub.parent_id ?? "__root__"); }} onDelete={() => remove.mutate(sub.id)} />
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
              <DialogHeader><DialogTitle>Edit category</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Name</label>
                  <Input className="mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Parent category</label>
                  <Select value={editParentId} onValueChange={setEditParentId}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__root__">— Top level (main category)</SelectItem>
                      {mainCats.filter((c: any) => c.id !== editingCat.id).map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>Sub of: {c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
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

function RapidScanDialog({
  products, categories, userId, onClose,
}: { products: any[]; categories: any[]; userId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [mainCatId, setMainCatId] = useState<string>("all");
  const [subCatId, setSubCatId] = useState<string>("all");
  const [sequenceMode, setSequenceMode] = useState(false);

  const detectedLabelFor = (code: string) => {
    const currentProduct = current;
    if (!currentProduct) return code;
    return `${currentProduct.name} · ${code}`;
  };

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);

  // Sequence: ordered list of main categories (alphabetical) that still have un-barcoded products,
  // plus a final "Uncategorized" bucket if applicable.
  const sequence: { id: string; name: string }[] = (() => {
    const list: { id: string; name: string }[] = [];
    [...mainCats].sort((a: any, b: any) => a.name.localeCompare(b.name)).forEach((mc: any) => {
      const has = products.some((p: any) => {
        if (p.barcode) return false;
        const c = categories.find((x: any) => x.id === p.category_id);
        const mid = c ? (c.parent_id ?? c.id) : null;
        return mid === mc.id;
      });
      if (has) list.push({ id: mc.id, name: mc.name });
    });
    const hasUncat = products.some((p: any) => !p.barcode && !p.category_id);
    if (hasUncat) list.push({ id: "__uncat__", name: "Uncategorized" });
    return list;
  })();

  const inSelectedCategory = (p: any) => {
    if (mainCatId === "__uncat__") return !p.category_id;
    if (mainCatId === "all") return true;
    const cat = categories.find((c: any) => c.id === p.category_id);
    if (!cat) return false;
    const mainId = cat.parent_id ?? cat.id;
    if (mainId !== mainCatId) return false;
    if (subCatId !== "all" && p.category_id !== subCatId) return false;
    return true;
  };

  const remaining = products
    .filter((p: any) => !p.barcode && !doneIds.has(p.id) && !skippedIds.has(p.id))
    .filter(inSelectedCategory)
    .filter((p: any) => !q || `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  const totalUnbarcoded = products.filter((p: any) => !p.barcode && inSelectedCategory(p)).length;
  const completed = doneIds.size;

  const current = currentId
    ? products.find((p: any) => p.id === currentId)
    : remaining[0];
  const activeId = current?.id ?? null;

  const catFor = (p: any) => {
    const c = categories.find((x: any) => x.id === p?.category_id);
    if (!c) return "Uncategorized";
    const main = c.parent_id ? categories.find((x: any) => x.id === c.parent_id) : null;
    return main ? `${main.name} › ${c.name}` : c.name;
  };

  const advance = (afterId: string) => {
    const next = products.find(
      (p: any) => !p.barcode && p.id !== afterId && !doneIds.has(p.id) && !skippedIds.has(p.id) && inSelectedCategory(p)
    );
    if (next) {
      setCurrentId(next.id);
      if (autoNext) setTimeout(() => setScannerOpen(true), 350);
      return;
    }
    setCurrentId(null);
    // Sequence mode: jump to next category that still has work.
    if (sequenceMode) {
      const idx = sequence.findIndex(s => s.id === mainCatId);
      const nextCat = sequence[idx + 1] ?? sequence.find(s => s.id !== mainCatId);
      if (nextCat) {
        setMainCatId(nextCat.id);
        setSubCatId("all");
        toast.success(`Category done — moving to "${nextCat.name}"`);
        if (autoNext) setTimeout(() => setScannerOpen(true), 600);
      } else {
        toast.success("All categories complete 🎉");
      }
    }
  };

  const save = useMutation({
    mutationFn: async ({ id, code }: { id: string; code: string }) => {
      const { error } = await supabase.from("products")
        .update({ barcode: code, barcode_registered_by: userId, barcode_registered_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      setDoneIds(prev => new Set(prev).add(vars.id));
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Saved — next product");
      advance(vars.id);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("products")
        .update({ barcode: null, barcode_registered_by: null, barcode_registered_at: null })
        .not("barcode", "is", null);
      if (error) throw error;
    },
    onSuccess: () => {
      setDoneIds(new Set()); setSkippedIds(new Set()); setCurrentId(null);
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("All barcodes cleared");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onDetected = (code: string) => {
    if (!current) return;
    // Check if barcode already exists on another product
    const dupe = products.find((p: any) => p.barcode === code && p.id !== current.id);
    if (dupe) {
      toast.error(`Barcode already used by "${dupe.name}"`);
      return;
    }
    save.mutate({ id: current.id, code });
  };

  const skip = () => {
    if (!current) return;
    setSkippedIds(prev => new Set(prev).add(current.id));
    advance(current.id);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-primary" /> Rapid barcode scan
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground -mt-2">
          <span>{completed} done · {remaining.length} remaining · {totalUnbarcoded} total without barcode</span>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} className="accent-primary" />
            Auto-open scanner
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={sequenceMode}
              onChange={e => {
                setSequenceMode(e.target.checked);
                if (e.target.checked && (mainCatId === "all") && sequence[0]) {
                  setMainCatId(sequence[0].id); setSubCatId("all"); setCurrentId(null);
                }
              }}
              className="accent-primary" />
            <span className="font-medium">Category sequence</span>
            <span className="text-muted-foreground">— auto-jump to next category when done</span>
          </label>
          <Button size="sm" variant="ghost" className="h-7 text-destructive hover:bg-destructive/10"
            disabled={clearAll.isPending}
            onClick={() => { if (confirm("Remove the barcode from EVERY product? This cannot be undone.")) clearAll.mutate(); }}>
            <Trash2 className="size-3.5" /> {clearAll.isPending ? "Clearing…" : "Clear all barcodes"}
          </Button>
        </div>

        {sequenceMode && sequence.length > 0 && (
          <div className="flex gap-1 flex-wrap text-[10px]">
            {sequence.map((s, i) => {
              const isCurrent = s.id === mainCatId;
              const passed = sequence.findIndex(x => x.id === mainCatId) > i;
              return (
                <span key={s.id} className={cn(
                  "px-2 py-0.5 rounded-full border",
                  isCurrent ? "border-primary bg-primary text-primary-foreground font-bold"
                    : passed ? "border-success/40 bg-success/10 text-success line-through"
                      : "border-border bg-secondary/40 text-muted-foreground"
                )}>{i + 1}. {s.name}</span>
              );
            })}
          </div>
        )}

        {current ? (
          <Card className="card-elevated p-4 border-primary/40 bg-primary/5">
            <div className="text-[10px] uppercase tracking-wider text-primary font-bold mb-1">Current target</div>
            <div className="font-bold text-base leading-tight">{current.name}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{catFor(current)}{current.sku ? ` · SKU ${current.sku}` : ""}</div>
            <div className="flex gap-2 mt-3">
              <Button className="flex-1 gradient-primary text-primary-foreground border-0" onClick={() => setScannerOpen(true)} disabled={save.isPending}>
                <ScanLine className="size-4" /> {save.isPending ? "Saving…" : "Scan barcode"}
              </Button>
              <Button variant="secondary" onClick={skip} disabled={save.isPending}>
                <SkipForward className="size-4" /> Skip
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="card-elevated p-6 text-center">
            <Check className="size-6 mx-auto text-success mb-2" />
            <div className="font-semibold">All caught up</div>
            <div className="text-xs text-muted-foreground">No products left without a barcode in this list.</div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Select value={mainCatId} onValueChange={(v) => { setMainCatId(v); setSubCatId("all"); setCurrentId(null); }}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {mainCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              <SelectItem value="__uncat__">Uncategorized</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subCatId} onValueChange={(v) => { setSubCatId(v); setCurrentId(null); }}
            disabled={mainCatId === "all" || mainCatId === "__uncat__" || subCats.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder={mainCatId === "all" ? "Pick category first" : "All vendors"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {subCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search remaining products" className="pl-9" />
        </div>

        <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
          {remaining.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">No matches</div>
          )}
          {remaining.map((p: any) => (
            <button
              key={p.id}
              onClick={() => setCurrentId(p.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2 border transition flex items-center gap-2",
                activeId === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary/40 hover:bg-secondary"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{catFor(p)}</div>
              </div>
              {activeId === p.id && <span className="text-[10px] font-bold text-primary uppercase">Active</span>}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </DialogFooter>

        <StrichScanner
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDetected={onDetected}
          keepOpenOnDetect
          onDetectedLabel={detectedLabelFor}
        />
      </DialogContent>
    </Dialog>
  );
}

function BulkImportDialog({
  categories,
  defaultMainId,
  defaultSubId,
  onClose,
  onDone,
}: {
  categories: any[];
  defaultMainId: string;
  defaultSubId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [mainCatId, setMainCatId] = useState(defaultMainId);
  const [subCatId, setSubCatId] = useState(defaultSubId);
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);
  const categoryId = subCatId || mainCatId;

  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const extracted = extractSizeFromName(line);
      return { name: line, size: extracted?.size ?? "", unit: extracted?.unit ?? "" };
    });

  async function createVendor() {
    if (!newVendorName.trim() || !mainCatId) return;
    const { data, error } = await supabase.from("categories").insert({ name: newVendorName.trim(), parent_id: mainCatId }).select().single();
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["categories"] });
    setSubCatId(data.id);
    setNewVendorName("");
    setAddingVendor(false);
    toast.success("Vendor added");
  }

  async function doImport() {
    if (!rows.length || !categoryId) return;
    setImporting(true);
    try {
      const records = rows.map((r) => ({
        name: r.name,
        size: r.size || null,
        unit: r.unit || null,
        category_id: categoryId,
        stock: 0,
        price: 0,
        low_stock_threshold: 5,
      }));
      const { error } = await supabase.from("products").insert(records);
      if (error) throw error;
      toast.success(`Imported ${records.length} products`);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="size-5 text-primary" /> Import products</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Paste product names — one per line. Sizes like 450ml or 400g are extracted automatically.</p>
        </DialogHeader>

        <div className="p-4 space-y-3 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
              <Select value={mainCatId} onValueChange={(v) => { setMainCatId(v); setSubCatId(""); }} >
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{mainCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vendor</Label>
                {mainCatId && !addingVendor && (
                  <button type="button" onClick={() => setAddingVendor(true)} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                    <Plus className="size-3" /> New vendor
                  </button>
                )}
              </div>
              {addingVendor ? (
                <div className="flex gap-1 mt-1">
                  <Input autoFocus placeholder="Vendor name" value={newVendorName} onChange={e => setNewVendorName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") createVendor(); if (e.key === "Escape") { setAddingVendor(false); setNewVendorName(""); } }} className="h-9 text-sm" />
                  <Button type="button" size="sm" onClick={createVendor} disabled={!newVendorName.trim()} className="h-9 gradient-primary text-primary-foreground border-0">Add</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingVendor(false); setNewVendorName(""); }} className="h-9 px-2">✕</Button>
                </div>
              ) : (
                <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId} >
                  <SelectTrigger className="mt-1"><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors — add one →" : "Select vendor"} /></SelectTrigger>
                  <SelectContent>{subCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paste product names</Label>
            <textarea
              className="mt-1 w-full h-36 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={"Fish Sauce 700ml\nCoconut Milk 400ml\nJasmine Rice 5kg\nSoy Sauce 300ml"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex-1 overflow-auto border-t border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-8">#</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Product name</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-20">Size</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-16">Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border/50 hover:bg-secondary/30">
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">{r.name}</td>
                    <td className="px-3 py-1.5 font-mono text-accent">{r.size || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {rows.length > 0 ? <><span className="font-semibold text-foreground">{rows.length}</span> products ready</> : "Paste names above"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              className="gradient-primary text-primary-foreground border-0 gap-2"
              disabled={!rows.length || !categoryId || importing}
              onClick={doImport}
            >
              {importing ? <><span className="size-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />Importing…</> : <><ClipboardList className="size-4" />Import {rows.length > 0 ? rows.length : ""} products</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
