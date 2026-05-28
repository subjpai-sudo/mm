import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ScanLine, Pencil, Trash2, ImagePlus, ImageIcon, Calendar, User as UserIcon, Barcode, FolderTree, ChevronRight, ChevronDown, Maximize2, Minimize2, PackageCheck, AlertTriangle, PackageX, LayoutGrid, Zap, Check, SkipForward, Warehouse } from "lucide-react";
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
import { useServerFn } from "@tanstack/react-start";
import { fetchProductImage, bulkFetchProductImages, generateProductImageAI, bulkGenerateProductImagesAI } from "@/lib/product-images.functions";
import { Sparkles, Globe, Wand2 } from "lucide-react";
import { ReportPdfDialog } from "@/components/app/ReportPdfDialog";
import { BulkAssignShelfDialog } from "@/components/app/BulkAssignShelfDialog";
import { SIZE_UNITS, parseSize, displaySize } from "@/lib/product-format";
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

type ProductsSearch = { filter?: "all" | "in" | "low" | "out"; edit?: string };
export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
  validateSearch: (s: Record<string, unknown>): ProductsSearch => ({
    filter: s.filter === "in" || s.filter === "low" || s.filter === "out" || s.filter === "all" ? s.filter : undefined,
    edit: typeof s.edit === "string" ? s.edit : undefined,
  }),
});

function ProductsPage() {
  const { role, user } = useAuth();
  const { lastUpdated } = useRealtimeSync();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">(search.filter ?? "all");
  const [mainFilter, setMainFilter] = useState<string>("all");
  const [subFilter, setSubFilter] = useState<string>("all");
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
  const { data: reportMovements = [] } = useQuery({
    queryKey: ["movements-all"],
    queryFn: async () => (await supabase.from("stock_movements").select("*, products(name)").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });
  const productsWithCat = (products as any[]).map((p) => ({
    ...p,
    categories: p.categories ? { name: p.categories.name } : null,
  }));
  const reportLowList = productsWithCat.filter((p: any) => p.stock > 0 && p.stock <= p.low_stock_threshold);
  const reportOutList = productsWithCat.filter((p: any) => p.stock <= 0);
  const reportInQty = (reportMovements as any[]).filter((m) => m.type === "in").reduce((a, m) => a + m.quantity, 0);
  const reportOutQty = (reportMovements as any[]).filter((m) => m.type === "out").reduce((a, m) => a + m.quantity, 0);
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
    if (mainFilter !== "all") {
      const cat = categories.find((c: any) => c.id === p.category_id);
      const mainId = cat ? (cat.parent_id ?? cat.id) : null;
      if (mainId !== mainFilter) return false;
    }
    if (subFilter !== "all" && p.category_id !== subFilter) return false;
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

  const clearBarcode = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products")
        .update({ barcode: null, barcode_registered_by: null, barcode_registered_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Barcode removed"); },
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

  const fetchImageFn = useServerFn(fetchProductImage);
  const bulkFetchFn = useServerFn(bulkFetchProductImages);
  const bulkAutoFill = useMutation({
    mutationFn: () => bulkFetchFn({}),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Fetched ${r.updated}/${r.total} images${r.failures.length ? ` · ${r.failures.length} failed` : ""}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk fetch failed"),
  });

  const generateAIFn = useServerFn(generateProductImageAI);
  const bulkGenerateAIFn = useServerFn(bulkGenerateProductImagesAI);
  const bulkAIAll = useMutation({
    mutationFn: () => bulkGenerateAIFn({ data: { mode: "all", limit: 50 } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`AI generated ${r.updated}/${r.total} images${r.failures.length ? ` · ${r.failures.length} failed` : ""}. Run again to continue.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "AI regeneration failed"),
  });

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
          <div className="flex items-center gap-2 flex-wrap">
            <LiveBadge lastUpdated={lastUpdated} className="mr-1" />
            <div className="inline-flex items-center gap-1 p-1 rounded-2xl border border-border bg-card/60 backdrop-blur">
              <Button
                size="icon"
                variant="ghost"
                title="Auto-fill images from web"
                disabled={bulkAutoFill.isPending}
                onClick={() => { if (confirm("Search the web and add a picture to every product without one?")) bulkAutoFill.mutate(); }}
              >
                <Sparkles className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Generate AI images (all)"
                disabled={bulkAIAll.isPending}
                onClick={() => { if (confirm("Generate fresh AI images for every product (replaces existing)? Processes 50 per run — click again to continue.")) bulkAIAll.mutate(); }}
              >
                <Wand2 className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Rapid scan" onClick={() => setRapidOpen(true)}>
                <Zap className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Assign to shelf" onClick={() => setBulkShelfOpen(true)}>
                <Warehouse className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Categories" onClick={() => setManageCats(true)}>
                <FolderTree className="size-4" />
              </Button>
              <div className="mx-1 w-px h-6 bg-border" />
              <ReportPdfDialog
                products={productsWithCat as any}
                lowList={reportLowList as any}
                outList={reportOutList as any}
                movements={{ inQty: reportInQty, outQty: reportOutQty, total: reportMovements.length }}
                rawMovements={reportMovements as any}
              />
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground border-0 rounded-xl"><Plus className="size-4" /> New product</Button>
                </DialogTrigger>
                <ProductDialog categories={categories} onSubmit={(f) => create.mutate(f)} />
              </Dialog>
            </div>
          </div>
        ) : <LiveBadge lastUpdated={lastUpdated} />}
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
          <Select value={mainFilter} onValueChange={(v) => { setMainFilter(v); setSubFilter("all"); }}>
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
            onValueChange={setSubFilter}
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
                        onClearBarcode={() => clearBarcode.mutate(p.id)}
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
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("0"); const [stock, setStock] = useState("0"); const [threshold, setThreshold] = useState("5");
  const [sizeNum, setSizeNum] = useState(""); const [sizeUnit, setSizeUnit] = useState<string>("g");
  const [pcsPerCase, setPcsPerCase] = useState("");
  const [mainCatId, setMainCatId] = useState<string>("");
  const [subCatId, setSubCatId] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [scanOpen, setScanOpen] = useState(false);

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);
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
          <div><Label>Vendor / Subcategory</Label>
            <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId || subCats.length === 0}>
              <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors yet" : "Select vendor"} /></SelectTrigger>
              <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
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
          <div><Label>Price</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
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
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [price, setPrice] = useState(String(product.price ?? 0));
  const [stock, setStock] = useState(String(product.stock ?? 0));
  const [threshold, setThreshold] = useState(String(product.low_stock_threshold ?? 5));
  const _ppc = product.pcs_per_case && product.pcs_per_case > 0 ? product.pcs_per_case : 0;
  const [stockBoxes, setStockBoxes] = useState(String(_ppc > 0 ? Math.floor((product.stock ?? 0) / _ppc) : 0));
  const [stockPcs, setStockPcs] = useState(String(_ppc > 0 ? (product.stock ?? 0) % _ppc : (product.stock ?? 0)));
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

  const mainCats = categories.filter((c: any) => !c.parent_id);
  const subCats = categories.filter((c: any) => c.parent_id === mainCatId);
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
            <div><Label>Vendor / Subcategory</Label>
              <Select value={subCatId} onValueChange={setSubCatId} disabled={!mainCatId || subCats.length === 0}>
                <SelectTrigger><SelectValue placeholder={!mainCatId ? "Pick category first" : subCats.length === 0 ? "No vendors yet" : "Select vendor"} /></SelectTrigger>
                <SelectContent>{subCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
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
            <div><Label>Price</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
            <div><Label>Low at</Label><Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} /></div>
          </div>
          <div>
            <Label>Pcs per box</Label>
            <Input type="number" inputMode="numeric" placeholder="e.g. 48 (leave blank if not boxed)" value={pcsPerCase} onChange={e => setPcsPerCase(e.target.value)} />
          </div>
          <div>
            <Label>Stock</Label>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mt-1">
              <div>
                <Input type="number" inputMode="numeric" placeholder="Boxes" value={stockBoxes} onChange={e => setStockBoxes(e.target.value)} />
                <p className="text-[10px] text-muted-foreground text-center mt-0.5">{Number(pcsPerCase) > 0 ? `boxes × ${pcsPerCase}` : "boxes"}</p>
              </div>
              <span className="text-muted-foreground font-medium">+</span>
              <div>
                <Input type="number" inputMode="numeric" placeholder="Pcs" value={stockPcs} onChange={e => setStockPcs(e.target.value)} />
                <p className="text-[10px] text-muted-foreground text-center mt-0.5">extra pcs</p>
              </div>
            </div>
            {Number(pcsPerCase) > 0 ? (() => {
              const b = Number(stockBoxes) || 0;
              const p = Number(stockPcs) || 0;
              const ppc = Number(pcsPerCase);
              const total = b * ppc + p;
              return <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">{b} boxes × {ppc} + {p} pcs = {total} total pcs</p>;
            })() : <p className="text-[11px] text-muted-foreground mt-1">Set pcs per box above to use boxes, or enter pcs directly.</p>}
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button className="gradient-primary text-primary-foreground border-0" onClick={() => onSave({
            name, sku: sku || null, barcode: barcode || null,
            category_id: categoryId || null, image_url: imageUrl || null,
            size: sizeNum ? sizeNum : null,
            unit: sizeNum ? sizeUnit : null,
            price: Number(price),
            stock: Number(stockBoxes) * (Number(pcsPerCase) || 0) + Number(stockPcs),
            low_stock_threshold: Number(threshold),
            pcs_per_case: pcsPerCase ? Number(pcsPerCase) : null,
          })}>Save changes</Button>
        </DialogFooter>
        <StrichScanner open={scanOpen} onClose={() => setScanOpen(false)} onDetected={(c) => { setBarcode(c); setScanOpen(false); }} />
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
              {stockInBoxes(product.stock, product.pcs_per_case) && (
                <div className="text-xs text-muted-foreground">
                  ≈ <span className="text-foreground font-semibold">{stockInBoxes(product.stock, product.pcs_per_case)}</span>
                  <span className="opacity-70"> ({product.pcs_per_case}/box)</span>
                </div>
              )}
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

function ImagePicker({ value, onChange, productName }: { value: string; onChange: (url: string) => void; productName?: string }) {
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const fetchImageFn = useServerFn(fetchProductImage);
  async function searchWeb() {
    if (!productName?.trim()) { toast.error("Enter product name first"); return; }
    setSearching(true);
    try {
      const res = await fetchImageFn({ data: { name: productName.trim() } });
      onChange(res.url);
      toast.success("Image found");
    } catch (e: any) {
      toast.error(e?.message ?? "Search failed");
    } finally { setSearching(false); }
  }
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
        <Button type="button" variant="secondary" size="sm" className="h-7 text-xs" disabled={searching} onClick={searchWeb}>
          <Globe className="size-3.5" /> {searching ? "Searching…" : "Search web"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => onChange("")}>Remove</Button>
        )}
      </div>
    </div>
  );
}

function ProductCard({ p, canEdit, canDelete, onView, onEdit, onDelete, onScan, onClearBarcode }:
  { p: any; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void; onScan: () => void; onClearBarcode: () => void }) {
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
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">{p.barcode}</span>
              {canEdit && (
                <button
                  onClick={() => { if (confirm(`Remove barcode ${p.barcode} from "${p.name}"?`)) onClearBarcode(); }}
                  className="size-5 grid place-items-center rounded text-destructive hover:bg-destructive/10"
                  aria-label="Remove barcode"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          )}
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
