import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, getCachedStorageUrl } from "@/integrations/supabase/client";
import { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScanLine, Search, ChevronRight, ChevronLeft, Folder, FolderOpen, Camera, ImageIcon, PackageSearch, Package, PackagePlus, Sparkles, RotateCcw, Loader2, Trash2, Zap, X } from "lucide-react";
import { useServerFn } from "@/lib/use-server-fn";
import { scanProductImage } from "@/lib/ai-scan.functions";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

import { notifyBillingStockSync } from "@/lib/billing-server";
import { cn } from "@/lib/utils";
import { StrichScanner } from "@/components/app/StrichScanner";
import { displaySize, displayStock, extractSizeFromName } from "@/lib/product-format";

type StockInSearch = { barcode?: string };
type ScanRow = {
  productId: string;
  name: string;
  stock: number;
  barcode: string | null;
  boxes: string;
  qty: string;
  pcsPerCase: number | null;
};
export const Route = createFileRoute("/_authenticated/stock-in")({
  component: StockIn,
  validateSearch: (s: Record<string, unknown>): StockInSearch => ({
    barcode: typeof s.barcode === "string" && s.barcode.length ? s.barcode : undefined,
  }),
});

function formatDetectedProductLabel(code: string, products: any[]) {
  const match = products.find((x: any) => x.barcode === code || x.sku === code);
  return match ? `${match.name} · ${code}` : code;
}

function playErrorBuzz() {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.value = 150;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
    o.onended = () => ctx.close().catch(() => undefined);
  } catch {}
}

function playSuccessBeep() {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 1046; // C6 note
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.14);
    o.onended = () => ctx.close().catch(() => undefined);
  } catch {}
}

function StockIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const routeSearch = Route.useSearch();
  const nav = Route.useNavigate();
  const [parent, setParent] = useState<any | null>(null);
  const [child, setChild] = useState<any | null>(null);
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<any | null>(null);
  const [boxQty, setBoxQty] = useState("0");
  const [xPcs, setXPcs] = useState("1");
  const LOCATIONS = ["Kita Otsuka", "Kawaguchi"] as const;
  type Location = (typeof LOCATIONS)[number];
  const [location, setLocation] = useState<Location>("Kita Otsuka");
  const [camOpen, setCamOpen] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pickSearch, setPickSearch] = useState("");
  const [newProdOpen, setNewProdOpen] = useState(false);
  const [newProdImg, setNewProdImg] = useState<string | null>(null);
  const [aiScanning, setAiScanning] = useState(false);
  const [newProdFields, setNewProdFields] = useState({ name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "" });

  const [scanned, setScanned] = useState<ScanRow[]>([]);
  const [speedMode, setSpeedMode] = useState(false);

  function updateRow(productId: string, patch: Partial<ScanRow>) {
    setScanned((rows) => rows.map((r) => r.productId === productId ? { ...r, ...patch } : r));
  }
  function removeRow(productId: string) {
    setScanned((rows) => rows.filter((r) => r.productId !== productId));
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const callScanProduct = useServerFn(scanProductImage);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  // Auto-prefill from ?barcode=… when navigating from the scanner.
  useEffect(() => {
    if (!routeSearch.barcode || products.length === 0) return;
    const p = (products as any[]).find((x) => x.barcode === routeSearch.barcode || x.sku === routeSearch.barcode);
    if (p) {
      if (speedMode) {
        lookup(routeSearch.barcode);
      } else {
        setConfirm(p);
      }
    } else {
      setNotFound(routeSearch.barcode);
    }
    nav({ search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.barcode, products.length]);

  const parents = categories.filter((c: any) => !c.parent_id);
  const children = parent ? categories.filter((c: any) => c.parent_id === parent.id) : [];
  const subIdsByParent = (pid: string) => categories.filter((c: any) => c.parent_id === pid).map((c: any) => c.id);
  const countFor = (cat: any) => {
    if (!cat.parent_id) {
      const ids = new Set<string>([cat.id, ...subIdsByParent(cat.id)]);
      return products.filter((p: any) => ids.has(p.category_id)).length;
    }
    return products.filter((p: any) => p.category_id === cat.id).length;
  };
  const visibleProducts = products.filter((p: any) => {
    if (child && p.category_id !== child.id) return false;
    if (!child && parent && !subIdsByParent(parent.id).includes(p.category_id) && p.category_id !== parent.id) return false;
    if (search && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const showResults = !!search || !!parent;

  function lookup(code: string) {
    const v = code.trim();
    if (!v) return;
    const p = products.find((x: any) => x.barcode === v || x.sku === v);
    if (!p) {
      playErrorBuzz();
      if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
      setCamOpen(false);
      setNotFound(v);
      setPickSearch("");
      setScan("");
      return;
    }

    if (speedMode) {
      playSuccessBeep();
      if (navigator.vibrate) navigator.vibrate(60);
      setScanned((rows) => {
        const idx = rows.findIndex((r) => r.productId === p.id);
        if (idx >= 0) {
          const next = [...rows];
          if (p.pcs_per_case && p.pcs_per_case > 0) {
            next[idx] = { ...next[idx], boxes: String((Number(next[idx].boxes) || 0) + 1) };
          } else {
            next[idx] = { ...next[idx], qty: String((Number(next[idx].qty) || 0) + 1) };
          }
          return next;
        }
        return [...rows, {
          productId: p.id,
          name: p.name,
          stock: p.stock,
          barcode: p.barcode ?? null,
          boxes: p.pcs_per_case && p.pcs_per_case > 0 ? "1" : "0",
          qty: p.pcs_per_case && p.pcs_per_case > 0 ? "0" : "1",
          pcsPerCase: p.pcs_per_case ?? null,
        }];
      });
      const addedQty = p.pcs_per_case && p.pcs_per_case > 0 ? `${p.pcs_per_case} pcs (1 box)` : "1 pc";
      toast.success(`Added ${addedQty} of ${p.name}`, { duration: 1200 });
      setScan("");
    } else {
      setConfirm(p);
      setScan("");
    }
  }
  const onScan = () => lookup(scan);

  const apply = useMutation({
    mutationFn: async () => {
      const b = Math.max(0, Number(boxQty) || 0);
      const p = Math.max(0, Number(xPcs) || 0);
      const perBox = confirm.pcs_per_case && confirm.pcs_per_case > 0 ? confirm.pcs_per_case : 0;
      const actual = perBox > 0 ? b * perBox + p : b + p;
      if (!actual || actual < 1) throw new Error("Enter a quantity");
      const parts = perBox > 0 && b > 0
        ? `${b} box${b !== 1 ? "es" : ""} × ${perBox}${p > 0 ? ` + ${p} pcs` : ""} = ${actual} pcs`
        : `${actual} pcs`;
      const { error } = await supabase.from("stock_movements").insert({
        product_id: confirm.id, type: "in", quantity: actual, user_id: user?.id,
        reason: `Stock In · ${parts} · ${location}`,
        destination: location,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      notifyBillingStockSync();
      const b = Number(boxQty) || 0;
      const p = Number(xPcs) || 0;
      const perBox = confirm.pcs_per_case && confirm.pcs_per_case > 0 ? confirm.pcs_per_case : 0;
      const actual = perBox > 0 ? b * perBox + p : b + p;
      toast.success(`Added ${actual} pcs to ${confirm.name}`);
      setConfirm(null); setBoxQty("0"); setXPcs("0");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const submitAll = useMutation({
    mutationFn: async () => {
      const movements = scanned.map((r) => {
        const b = Math.max(0, Number(r.boxes) || 0);
        const p = Math.max(0, Number(r.qty) || 0);
        const perBox = r.pcsPerCase && r.pcsPerCase > 0 ? r.pcsPerCase : 0;
        const actual = perBox > 0 ? b * perBox + p : b + p;
        if (actual < 1) return null;
        const parts = perBox > 0 && b > 0
          ? `${b} box${b !== 1 ? "es" : ""} × ${perBox}${p > 0 ? ` + ${p} pcs` : ""} = ${actual} pcs`
          : `${actual} pcs`;
        return {
          product_id: r.productId,
          type: "in",
          quantity: actual,
          user_id: user?.id,
          reason: `Stock In (Batch) · ${parts} · ${location}`,
          destination: location,
        };
      }).filter(Boolean);

      if (movements.length === 0) throw new Error("No items to stock in");

      const { error } = await supabase.from("stock_movements").insert(movements as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      notifyBillingStockSync();
      toast.success(`Received ${scanned.length} items successfully`);
      setScanned([]);
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

  function resizeImage(file: File, maxPx = 1024): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = url;
    });
  }

  async function handlePhotoSelected(file: File) {
    const dataUrl = await resizeImage(file);
    setNewProdImg(dataUrl);
    setAiScanning(true);
    try {
      const json = await callScanProduct({ data: { images: [dataUrl] } });
      if (json.ok && json.product) {
        const p = json.product as any;
        const nm = p.name ?? "";
        let size = p.size ?? "";
        let unit = p.unit ?? "";
        if (!size) {
          const parsed = extractSizeFromName(nm);
          if (parsed) { size = parsed.size; if (!unit) unit = parsed.unit; }
        }
        setNewProdFields({
          name: nm,
          brand: p.brand ?? "",
          sku: p.sku ?? (notFound ?? ""),
          size,
          unit,
          origin: p.origin ?? "",
          pcs_per_case: p.pcs_per_case != null ? String(p.pcs_per_case) : "",
        });
      } else {
        toast.error("AI couldn't read the product — please fill in manually.");
        setNewProdFields((f) => ({ ...f, sku: f.sku || (notFound ?? "") }));
      }
    } catch {
      toast.error("AI scan failed — fill in manually.");
      setNewProdFields((f) => ({ ...f, sku: f.sku || (notFound ?? "") }));
    } finally {
      setAiScanning(false);
    }
  }

  const saveNewProduct = useMutation({
    mutationFn: async () => {
      if (!newProdFields.name.trim()) throw new Error("Product name is required");
      // If size still missing, try to extract from the product name.
      let finalSize = newProdFields.size.trim();
      let finalUnit = newProdFields.unit.trim();
      if (!finalSize) {
        const parsed = extractSizeFromName(newProdFields.name);
        if (parsed) { finalSize = parsed.size; if (!finalUnit) finalUnit = parsed.unit; }
      }
      let uncategorized = (categories as any[]).find((c: any) => c.name.toLowerCase() === "uncategorized");
      if (!uncategorized) {
        const { data: created, error: catErr } = await supabase
          .from("categories")
          .insert({ name: "Uncategorized" })
          .select()
          .single();
        if (catErr) throw catErr;
        uncategorized = created;
      }
      const { data, error } = await supabase.from("products").insert({
        name: newProdFields.name.trim(),
        brand: newProdFields.brand.trim() || null,
        sku: newProdFields.sku.trim() || null,
        size: finalSize || null,
        unit: finalUnit || null,
        origin: newProdFields.origin.trim() || null,
        pcs_per_case: newProdFields.pcs_per_case ? Number(newProdFields.pcs_per_case) : null,
        barcode: notFound,
        category_id: uncategorized?.id ?? null,
        stock: 0,
        price: 0,
        low_stock_threshold: 5,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("New product registered — stock in to add quantity.");
      setNewProdOpen(false);
      setNotFound(null);
      setNewProdImg(null);
      setNewProdFields({ name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "" });
      setConfirm(data);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader eyebrow="Receiving" title="Stock In" subtitle="Receive inventory by category or scan." />

      <div className="space-y-3 sm:space-y-4">
        {/* Scan + search */}
        <Card className="card-elevated p-3 sm:p-4 space-y-3 relative overflow-hidden border-success/30">
          <div aria-hidden className="absolute -top-20 -right-20 size-60 rounded-full bg-success/20 blur-3xl pointer-events-none" />
          <div className="relative">
            <Label className="text-xs uppercase tracking-[0.14em] text-success font-semibold">Barcode scan · receive</Label>
            <div className="mt-2 flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-success" />
                <Input autoFocus value={scan} onChange={e => setScan(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && onScan()}
                  placeholder="Scan or type barcode / SKU…" className="pl-9 font-mono" />
              </div>
              <Button onClick={() => setCamOpen(true)} variant="secondary" size="icon" aria-label="Open camera">
                <Camera className="size-4" />
              </Button>
              <Button onClick={onScan} className="gradient-success text-success-foreground border-0">Find</Button>
            </div>
          </div>
          <div className="relative z-10">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products by name, SKU or barcode…" className="pl-9" />
          </div>
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={speedMode}
                onChange={(e) => {
                  setSpeedMode(e.target.checked);
                  if (e.target.checked) toast.success("Speed Scan active: scanning auto-adds to queue");
                }}
                className="size-4 accent-success"
              />
              <span className="text-xs font-semibold flex items-center gap-1 text-foreground">
                <Zap className="size-3 text-success fill-success animate-pulse" /> Speed Scan Mode (Continuous)
              </span>
            </label>
            {scanned.length > 0 && (
              <span className="text-[11px] text-muted-foreground font-semibold bg-success/15 text-success px-2 py-0.5 rounded-full">
                Queue: {scanned.length} items
              </span>
            )}
          </div>
        </Card>

        {scanned.length > 0 && (
          <Card className="card-elevated p-3 sm:p-4 space-y-2 border-success/40">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg gradient-success grid place-items-center">
                <Package className="size-4 text-success-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm">Receiving Queue · {scanned.length} items</div>
                <div className="text-[11px] text-muted-foreground">
                  → receiving to {location} · set quantity then submit
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setScanned([])} className="text-muted-foreground">
                <Trash2 className="size-4 text-destructive" /> Clear
              </Button>
            </div>
            <div className="divide-y divide-border max-h-[55vh] overflow-y-auto -mx-1">
              {scanned.map((r) => (
                <div key={r.productId} className="flex items-center gap-2 py-2 px-1">
                  <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0">
                    <Package className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {r.barcode ?? "—"} · stock {displayStock({ stock: r.stock, pcs_per_case: r.pcsPerCase })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {r.pcsPerCase && r.pcsPerCase > 0 ? (
                      <>
                        <div className="flex flex-col items-center">
                          <Input
                            type="number" inputMode="numeric" min="0"
                            value={r.boxes}
                            onChange={(e) => updateRow(r.productId, { boxes: e.target.value })}
                            className="h-9 w-12 text-center font-bold text-xs"
                          />
                          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">box</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-bold">+</span>
                        <div className="flex flex-col items-center">
                          <Input
                            type="number" inputMode="numeric" min="0"
                            value={r.qty}
                            onChange={(e) => updateRow(r.productId, { qty: e.target.value })}
                            className="h-9 w-12 text-center font-bold text-xs"
                          />
                          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">pcs</span>
                        </div>
                        <span className="text-[9px] font-bold text-success whitespace-nowrap">
                          ={Number(r.boxes) * r.pcsPerCase + Number(r.qty)}
                        </span>
                      </>
                    ) : (
                      <Input
                        type="number" inputMode="numeric" min="1"
                        value={r.qty}
                        onChange={(e) => updateRow(r.productId, { qty: e.target.value })}
                        className="h-9 w-16 text-center font-bold"
                      />
                    )}
                    <button type="button" onClick={() => removeRow(r.productId)}
                      className="size-9 rounded-lg bg-secondary text-muted-foreground hover:text-destructive grid place-items-center border border-border">
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Button onClick={() => submitAll.mutate()} disabled={submitAll.isPending}
              className="w-full h-12 gradient-success text-success-foreground border-0 font-bold">
              <PackagePlus className="size-5 mr-1" /> Complete Stock In · {scanned.length}
            </Button>
          </Card>
        )}

        {/* Browse: category cards or results */}
        {!showResults ? (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Browse categories</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
              {parents.map((c: any) => {
                const count = countFor(c);
                return (
                  <button key={c.id} onClick={() => setParent(c)}
                    className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/60 hover:shadow-md active:scale-[0.98] transition-all p-4 text-left min-h-[110px]">
                    <div className="size-10 rounded-xl gradient-primary grid place-items-center mb-3 shadow-sm">
                      <Folder className="size-5 text-primary-foreground" />
                    </div>
                    <div className="font-bold text-sm leading-tight line-clamp-2">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{count} item{count === 1 ? "" : "s"}</div>
                    <ChevronRight className="size-4 text-muted-foreground absolute top-3 right-3 group-hover:text-primary transition-colors" />
                  </button>
                );
              })}
              {parents.length === 0 && <p className="text-xs text-muted-foreground p-3 col-span-full">No categories yet.</p>}
            </div>
          </Card>
        ) : (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="flex items-center gap-2 text-sm mb-3">
              <button onClick={() => { setParent(null); setChild(null); setSearch(""); }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" /> Back
              </button>
              {parent && (
                <>
                  <ChevronRight className="size-3 text-muted-foreground" />
                  <button onClick={() => setChild(null)} className="font-semibold hover:text-primary">{parent.name}</button>
                </>
              )}
              {child && (<><ChevronRight className="size-3 text-muted-foreground" /><span className="font-semibold text-primary">{child.name}</span></>)}
              {!parent && search && <span className="text-muted-foreground">Search results</span>}
            </div>

            {parent && !child && children.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {children.map((c: any) => (
                  <button key={c.id} onClick={() => setChild(c)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-secondary/40 hover:bg-secondary text-xs font-semibold transition active:scale-[0.97]">
                    <FolderOpen className="size-3.5 text-accent" />
                    {c.name}
                    <span className="text-muted-foreground">{countFor(c)}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="divide-y divide-border max-h-[60vh] overflow-auto -mx-1">
              {visibleProducts.slice(0, 100).map((p: any) => (
                <button key={p.id} onClick={() => setConfirm(p)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 hover:bg-secondary/60 active:bg-secondary rounded-lg text-left">
                  {p.image_url ? (
                    <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-12 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground shrink-0"><Package className="size-5" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} · {p.barcode ?? "no barcode"}</div>
                    {displaySize(p) && (
                      <div className="text-[10px] font-semibold text-accent mt-0.5">{displaySize(p)}</div>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-secondary text-[11px] font-bold border border-border tabular-nums shrink-0">{displayStock(p)}</span>
                </button>
              ))}
              {visibleProducts.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No products match.</p>}
            </div>
          </Card>
        )}
      </div>

      <Dialog open={!!confirm} onOpenChange={(v) => { if (!v) { setConfirm(null); setBoxQty("0"); setXPcs("0"); } }}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[92vh] overflow-y-auto">
          {confirm && (
            <>
              <div className="relative w-full aspect-[4/3] sm:aspect-square bg-secondary shrink-0">
                {confirm.image_url ? (
                  <img src={getCachedStorageUrl(confirm.image_url)} alt={confirm.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="size-16" /></div>
                )}
                <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-medium border border-border">
                  Stock: <span className="font-bold">{displayStock(confirm)}</span>
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-4">
                <div>
                  <DialogTitle className="text-lg sm:text-xl font-bold leading-tight break-words">{confirm.name}</DialogTitle>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                    <span>SKU <span className="font-mono text-foreground">{confirm.sku ?? "—"}</span></span>
                    <span>Barcode <span className="font-mono text-foreground">{confirm.barcode ?? "—"}</span></span>
                    {displaySize(confirm) && <span>Size <span className="font-semibold text-foreground">{displaySize(confirm)}</span></span>}
                    <span className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-foreground">
                      🏠 Rack: {confirm.rack ? `${confirm.rack}${confirm.shelf ? ` / ${confirm.shelf}` : ""}` : "Unassigned"}
                    </span>
                  </div>
                </div>
                {confirm.pcs_per_case > 0 ? (
                  <div className="space-y-3">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to add</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Boxes <span className="text-foreground">× {confirm.pcs_per_case} pcs</span></div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setBoxQty(String(Math.max(0, Number(boxQty) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={boxQty}
                            onChange={e => setBoxQty(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setBoxQty(String(Number(boxQty) + 1))}>+</Button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Extra Pcs</div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setXPcs(String(Math.max(0, Number(xPcs) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={xPcs}
                            onChange={e => setXPcs(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setXPcs(String(Number(xPcs) + 1))}>+</Button>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-success/10 border border-success/30 text-sm font-semibold text-center">
                      {Number(boxQty) > 0 && <span>{boxQty} box{Number(boxQty) !== 1 ? "es" : ""} × {confirm.pcs_per_case}</span>}
                      {Number(boxQty) > 0 && Number(xPcs) > 0 && <span className="text-muted-foreground"> + </span>}
                      {Number(xPcs) > 0 && <span>{xPcs} pcs</span>}
                      <span className="text-success font-bold"> = {Number(boxQty) * confirm.pcs_per_case + Number(xPcs)} total pcs</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to add</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Boxes</div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setBoxQty(String(Math.max(0, Number(boxQty) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={boxQty}
                            onChange={e => setBoxQty(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setBoxQty(String(Number(boxQty) + 1))}>+</Button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Extra Pcs</div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setXPcs(String(Math.max(0, Number(xPcs) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={xPcs}
                            onChange={e => setXPcs(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setXPcs(String(Number(xPcs) + 1))}>+</Button>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-success/10 border border-success/30 text-sm font-semibold text-center">
                      {Number(boxQty) > 0 && <span>{boxQty} box{Number(boxQty) !== 1 ? "es" : ""}</span>}
                      {Number(boxQty) > 0 && Number(xPcs) > 0 && <span className="text-muted-foreground"> + </span>}
                      {Number(xPcs) > 0 && <span>{xPcs} pcs</span>}
                      <span className="text-success font-bold"> = {Number(boxQty) + Number(xPcs)} total pcs</span>
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Location</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {LOCATIONS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setLocation(d)}
                        className={cn(
                          "h-12 rounded-xl border text-sm font-semibold transition",
                          location === d
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-secondary/40 hover:bg-secondary"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2 sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-card border-t border-border">
                  <Button variant="ghost" onClick={() => { setConfirm(null); setBoxQty("0"); setXPcs("1"); }} className="flex-1 h-12">Cancel</Button>
                  <Button
                    className="gradient-success text-success-foreground border-0 flex-1 h-12 text-base font-bold"
                    disabled={apply.isPending || submitAll.isPending}
                    onClick={() => {
                      const b = Math.max(0, Number(boxQty) || 0);
                      const p = Math.max(0, Number(xPcs) || 0);
                      const perBox = confirm.pcs_per_case && confirm.pcs_per_case > 0 ? confirm.pcs_per_case : 0;
                      const actual = perBox > 0 ? b * perBox + p : b + p;
                      if (!actual || actual < 1) { toast.error("Enter a quantity"); return; }

                      if (speedMode || scanned.length > 0) {
                        setScanned((rows) => {
                          const idx = rows.findIndex((r) => r.productId === confirm.id);
                          if (idx >= 0) {
                            const next = [...rows];
                            const existB = Number(next[idx].boxes) || 0;
                            const existP = Number(next[idx].qty) || 0;
                            next[idx] = { ...next[idx], boxes: String(existB + b), qty: String(existP + p) };
                            return next;
                          }
                          return [...rows, {
                            productId: confirm.id,
                            name: confirm.name,
                            stock: confirm.stock,
                            barcode: confirm.barcode ?? null,
                            boxes: String(b),
                            qty: String(p),
                            pcsPerCase: confirm.pcs_per_case ?? null,
                          }];
                        });
                        const addedQty = perBox > 0 && b > 0
                          ? `${b} box${b !== 1 ? "es" : ""} × ${perBox}${p > 0 ? ` + ${p} pcs` : ""} = ${actual} pcs`
                          : `${actual} pcs`;
                        toast.success(`Added ${addedQty} of ${confirm.name} to queue`, { duration: 1200 });
                        setConfirm(null); setBoxQty("0"); setXPcs("0");
                      } else {
                        apply.mutate();
                      }
                    }}
                  >
                    {(() => {
                      const perBox = confirm.pcs_per_case ?? 0;
                      const total = perBox > 0 ? Number(boxQty) * perBox + Number(xPcs) : Number(boxQty) + Number(xPcs);
                      return `OK · Add ${total} pcs`;
                    })()}
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <StrichScanner
        open={camOpen}
        onClose={() => setCamOpen(false)}
        onDetected={lookup}
        keepOpenOnDetect
        onDetectedLabel={(code) => formatDetectedProductLabel(code, products)}
      />

      <Dialog open={!!notFound} onOpenChange={(v) => !v && setNotFound(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackageSearch className="size-5 text-primary" />Barcode not registered</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-secondary/60 border border-border text-sm">
              Scanned code: <span className="font-mono text-foreground">{notFound}</span>
            </div>
            <Button
              onClick={() => { setNewProdFields((f) => ({ ...f, sku: f.sku || (notFound ?? "") })); setNewProdOpen(true); }}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <PackagePlus className="size-4" /> Register as New Product
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or assign to existing product</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Search products or categories…" className="pl-9" />
            </div>
            <div className="max-h-[280px] overflow-auto space-y-1">
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
                        <img src={getCachedStorageUrl(p.image_url)} alt={p.name} className="size-10 rounded-lg object-cover border border-border" />
                      ) : (
                        <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground"><ImageIcon className="size-4" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {cat?.name ?? "Uncategorized"}
                          {displaySize(p) && <> · <span className="text-accent font-semibold">{displaySize(p)}</span></>}
                          {" · Stock "}{displayStock(p)}
                        </div>
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

      {/* ── Register New Product dialog ── */}
      <Dialog open={newProdOpen} onOpenChange={(v) => { if (!v) { setNewProdOpen(false); setNewProdImg(null); setNewProdFields({ name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "" }); } }}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="size-5 text-primary" /> Register New Product
            </DialogTitle>
            {notFound && (
              <p className="text-xs text-muted-foreground mt-1">
                Barcode: <span className="font-mono text-foreground">{notFound}</span>
              </p>
            )}
          </DialogHeader>

          <div className="p-4 space-y-4">
            {/* Camera section — optional */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Photo <span className="normal-case font-normal">(optional — AI auto-fill)</span></span>
              </div>
              <div
                onClick={() => !aiScanning && fileRef.current?.click()}
                className={cn(
                  "relative rounded-2xl border-2 border-dashed overflow-hidden cursor-pointer transition-colors",
                  newProdImg ? "border-border" : "border-border/60 hover:border-primary bg-secondary/30 hover:bg-primary/5",
                  aiScanning && "pointer-events-none",
                )}
                style={{ minHeight: 120 }}
              >
                {newProdImg ? (
                  <>
                    <img src={newProdImg} alt="Product" className="w-full object-contain max-h-48" />
                    {aiScanning && (
                      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm grid place-items-center gap-2 flex-col">
                        <Loader2 className="size-8 text-primary animate-spin" />
                        <span className="text-sm font-medium flex items-center gap-1.5"><Sparkles className="size-4 text-primary" /> AI reading product…</span>
                      </div>
                    )}
                    {!aiScanning && (
                      <button
                        onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                        className="absolute bottom-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/90 border border-border text-xs font-medium hover:bg-secondary"
                      >
                        <RotateCcw className="size-3" /> Retake
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                    <Camera className="size-6 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Tap to take a photo</p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">AI will read the label — or skip and fill below</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handlePhotoSelected(f); e.target.value = ""; }} />

            {/* Form fields */}
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Product Name <span className="text-destructive">*</span></Label>
                <Input autoFocus className="mt-1" value={newProdFields.name} onChange={e => setNewProdFields(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Fish Sauce Premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Brand</Label>
                  <Input className="mt-1" value={newProdFields.brand} onChange={e => setNewProdFields(p => ({ ...p, brand: e.target.value }))} placeholder="e.g. Tiparos" />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">SKU</Label>
                  <Input className="mt-1 font-mono" value={newProdFields.sku} onChange={e => setNewProdFields(p => ({ ...p, sku: e.target.value }))} placeholder="auto from barcode" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Size / Weight</Label>
                  <Input className="mt-1" value={newProdFields.size} onChange={e => setNewProdFields(p => ({ ...p, size: e.target.value }))} placeholder="e.g. 700ml" />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit</Label>
                  <select
                    value={newProdFields.unit}
                    onChange={e => setNewProdFields(p => ({ ...p, unit: e.target.value }))}
                    className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {["bottle", "bag", "can", "box", "pack", "jar", "sachet", "pcs"].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Origin</Label>
                  <Input className="mt-1" value={newProdFields.origin} onChange={e => setNewProdFields(p => ({ ...p, origin: e.target.value }))} placeholder="e.g. Thailand" />
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pcs per Case</Label>
                  <Input className="mt-1" type="number" inputMode="numeric" value={newProdFields.pcs_per_case} onChange={e => setNewProdFields(p => ({ ...p, pcs_per_case: e.target.value }))} placeholder="e.g. 12" />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="px-4 pb-4 gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => { setNewProdOpen(false); setNewProdImg(null); setNewProdFields({ name: "", brand: "", sku: "", size: "", unit: "", origin: "", pcs_per_case: "" }); }}>
              Cancel
            </Button>
            <Button
              className="flex-1 gradient-success text-success-foreground border-0 gap-2"
              onClick={() => saveNewProduct.mutate()}
              disabled={saveNewProduct.isPending || aiScanning || !newProdFields.name.trim()}
            >
              {saveNewProduct.isPending ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              Save to Uncategorized
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
