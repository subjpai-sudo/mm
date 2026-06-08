import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScanLine, Search, Camera, Folder, ChevronRight, ChevronLeft, FolderOpen, Package, Truck, Store, Zap, Trash2, X, Plus, ReceiptText, ExternalLink, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

import {
  createWarehouseBill,
  openBillingInvoiceBuilder,
  type IssuedBill,
  type WarehouseBillRow,
} from "@/lib/warehouse-bills";
import { StrichScanner } from "@/components/app/StrichScanner";
import { displaySize, displayStock } from "@/lib/product-format";

type StockOutSearch = { barcode?: string };
export const Route = createFileRoute("/_authenticated/stock-out")({
  component: StockOut,
  validateSearch: (s: Record<string, unknown>): StockOutSearch => ({
    barcode: typeof s.barcode === "string" && s.barcode.length ? s.barcode : undefined,
  }),
});

const TOP_DESTINATIONS = ["Delivery", "Shops"] as const;
type DestKind = (typeof TOP_DESTINATIONS)[number];
type ScanRow = WarehouseBillRow;

function formatDetectedProductLabel(code: string, products: any[]) {
  const match = products.find((x: any) => x.barcode === code || x.sku === code);
  return match ? `${match.name} · ${code}` : code;
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("en-US")}`;
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

function StockOut() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const routeSearch = Route.useSearch();
  const nav = Route.useNavigate();
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [outBoxes, setOutBoxes] = useState("0");
  const [outPcs, setOutPcs] = useState("1");
  const [destKind, setDestKind] = useState<DestKind>("Delivery");
  const [shop, setShop] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustCompany, setNewCustCompany] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const [parent, setParent] = useState<any | null>(null);
  const [child, setChild] = useState<any | null>(null);
  const [scanned, setScanned] = useState<ScanRow[]>([]);
  const [massSearch, setMassSearch] = useState("");
  const [destModalOpen, setDestModalOpen] = useState(false);
  const [massScanMode, setMassScanMode] = useState(false);
  const [issuedBill, setIssuedBill] = useState<IssuedBill | null>(null);
  const [speedMode, setSpeedMode] = useState(false);
  const [errorProductCode, setErrorProductCode] = useState<string | null>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  // Auto-prefill from ?barcode=… when navigating from the scanner.
  useEffect(() => {
    if (!routeSearch.barcode || products.length === 0) return;
    const p = (products as any[]).find((x) => x.barcode === routeSearch.barcode || x.sku === routeSearch.barcode);
    if (p) setSelected(p);
    else toast.error(`Barcode ${routeSearch.barcode} not found`);
    nav({ search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.barcode, products.length]);
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: billingStores = [] } = useQuery<{ id: string; name: string; sub: string | null }[]>({
    queryKey: ["billing-stores"],
    queryFn: async () => ((await (supabase as any).from("billing_stores").select("id,name,sub").order("sub")).data ?? []),
  });
  const { data: billingCustomers = [] } = useQuery<{ id: string; name: string; company: string | null }[]>({
    queryKey: ["billing-customers"],
    queryFn: async () => ((await (supabase as any).from("billing_customers").select("id,name,company").order("name")).data ?? []),
  });
  const selectedCustomer = billingCustomers.find((c) => c.id === customerId) ?? null;
  const addCustomerMut = useMutation({
    mutationFn: async () => {
      if (!newCustName.trim()) throw new Error("Name required");
      const { data, error } = await (supabase as any)
        .from("billing_customers")
        .insert({ name: newCustName.trim(), company: newCustCompany.trim() || null })
        .select("id,name,company")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (d) => {
      setCustomerId(d.id);
      setAddingCustomer(false);
      setNewCustName("");
      setNewCustCompany("");
      await qc.invalidateQueries({ queryKey: ["billing-customers"] });
      toast.success("Customer added");
    },
    onError: (e: any) => toast.error(e.message),
  });
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

  function lookup(code: string) {
    const v = code.trim();
    if (!v) return;
    if (destKind === "Shops" && !shop) {
      toast.error("Pick a shop first");
      return;
    }
    const p = products.find((x: any) => x.barcode === v || x.sku === v);
    if (!p) {
      playErrorBuzz();
      if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
      setCamOpen(false);
      setErrorProductCode(v);
      setScan("");
      return;
    }

    playSuccessBeep();
    if (navigator.vibrate) navigator.vibrate(60);

    if (speedMode) {
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
      setScan("");
      setOutBoxes("0");
      setOutPcs(p.pcs_per_case && p.pcs_per_case > 0 ? "0" : "1");
      // pause camera while product dialog is shown — no two dialogs at once
      if (camOpen) setCamOpen(false);
      setSelected(p);
    }
  }

  function updateRow(productId: string, patch: Partial<ScanRow>) {
    setScanned((rows) => rows.map((r) => r.productId === productId ? { ...r, ...patch } : r));
  }
  function removeRow(productId: string) {
    setScanned((rows) => rows.filter((r) => r.productId !== productId));
  }

  function addProductToScanned(p: any) {
    if (destKind === "Shops" && !shop) { toast.error("Pick a shop first"); return; }
    setScanned((rows) => {
      const idx = rows.findIndex((r) => r.productId === p.id);
      if (idx >= 0) {
        const next = [...rows];
        next[idx] = { ...next[idx], qty: String((Number(next[idx].qty) || 0) + 1) };
        return next;
      }
      return [...rows, {
        productId: p.id, name: p.name,
        stock: p.stock, barcode: p.barcode ?? null, boxes: "0", qty: "1",
        pcsPerCase: p.pcs_per_case ?? null,
      }];
    });
    toast.success(`Added ${p.name}`, { duration: 1000 });
    setMassSearch("");
  }

  const massSuggestions = massSearch.trim().length === 0 ? [] : products.filter((p: any) => {
    const q = massSearch.toLowerCase();
    return `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(q);
  }).slice(0, 8);

  const submitAll = useMutation({
    mutationFn: async () => {
      return await createWarehouseBill({
        rows: scanned,
        products: products as any[],
        destKind,
        shop,
        customerId,
        billingStores,
        billingCustomers,
        userId: user?.id,
      });
    },
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      qc.invalidateQueries({ queryKey: ["shop-movements"] });
      qc.invalidateQueries({ queryKey: ["warehouse-bills"] });
      qc.invalidateQueries({ queryKey: ["warehouse-bill-items"] });
      setIssuedBill(bill);
      toast.success(`Bill ${bill.bill_no} created`);
      setScanned([]);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onScan = () => lookup(scan);
  const filtered = products.filter((p: any) => {
    if (child && p.category_id !== child.id) return false;
    if (!child && parent && !subIdsByParent(parent.id).includes(p.category_id) && p.category_id !== parent.id) return false;
    if (search && !`${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const showResults = !!search || !!parent;

  const apply = useMutation({
    mutationFn: async () => {
      const b = Math.max(0, Number(outBoxes) || 0);
      const p = Math.max(0, Number(outPcs) || 0);
      const perBox = selected.pcs_per_case && selected.pcs_per_case > 0 ? selected.pcs_per_case : 0;
      const actual = perBox > 0 ? b * perBox + p : p;
      if (!actual || actual < 1) throw new Error("Enter a quantity");
      if (actual > selected.stock) throw new Error(`${actual} pcs exceeds available stock (${selected.stock})`);
      return await createWarehouseBill({
        rows: [{
          productId: selected.id,
          name: selected.name,
          stock: selected.stock,
          barcode: selected.barcode ?? null,
          boxes: String(b),
          qty: String(p),
          pcsPerCase: selected.pcs_per_case ?? null,
        }],
        products: products as any[],
        destKind,
        shop,
        customerId,
        billingStores,
        billingCustomers,
        userId: user?.id,
      });
    },
    onSuccess: (bill) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["movements-recent"] });
      qc.invalidateQueries({ queryKey: ["warehouse-bills"] });
      qc.invalidateQueries({ queryKey: ["warehouse-bill-items"] });
      setIssuedBill(bill);
      toast.success(`Bill ${bill.bill_no} created`);
      setSelected(null); setOutBoxes("0"); setOutPcs("1");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-3 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader eyebrow="Dispatching" title="Stock Out" subtitle="Issue inventory with reason logging." />

      <div className="space-y-3 sm:space-y-4">
        {/* Destination is chosen FIRST */}
        <Card className="card-elevated p-3 sm:p-4 space-y-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Destination</Label>
          <div className="grid grid-cols-2 gap-2">
            {TOP_DESTINATIONS.map((d) => {
              const Icon = d === "Delivery" ? Truck : Store;
              const active = destKind === d;
              return (
                <button key={d} type="button"
                  onClick={() => { setDestKind(d); if (d === "Delivery") setShop(null); }}
                  className={cn(
                    "h-16 rounded-2xl border flex items-center justify-center gap-2 text-base font-semibold transition active:scale-[0.98]",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "border-border bg-secondary/40 hover:bg-secondary",
                  )}>
                  <Icon className="size-5" /> {d}
                </button>
              );
            })}
          </div>
          {destKind === "Shops" && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Choose shop</Label>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {billingStores.map((s) => {
                  const label = s.sub || s.name;
                  return (
                    <button key={s.id} type="button" onClick={() => setShop(label)}
                      className={cn(
                        "h-11 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                        shop === label
                          ? "border-warning bg-warning text-warning-foreground shadow-sm"
                          : "border-border bg-secondary/40 hover:bg-secondary",
                      )}>
                      {label}
                    </button>
                  );
                })}
              </div>
              {!shop && <p className="text-[11px] text-warning mt-1.5 font-medium">Pick a shop before scanning.</p>}
            </div>
          )}
          {destKind === "Delivery" && (
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Customer</Label>
              <div className="flex gap-2 flex-wrap">
                {billingCustomers.map((c) => {
                  const label = c.company || c.name;
                  return (
                    <button key={c.id} type="button" onClick={() => setCustomerId(c.id)}
                      className={cn(
                        "h-10 px-4 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                        customerId === c.id
                          ? "border-warning bg-warning text-warning-foreground shadow-sm"
                          : "border-border bg-secondary/40 hover:bg-secondary",
                      )}>
                      {label}
                    </button>
                  );
                })}
                <button type="button" onClick={() => setAddingCustomer(v => !v)}
                  className="h-10 px-3 rounded-xl border border-dashed border-border bg-secondary/20 hover:bg-secondary text-sm text-muted-foreground transition flex items-center gap-1">
                  <Plus className="size-3.5" /> Add customer
                </button>
              </div>
              {addingCustomer && (
                <div className="mt-2 p-3 rounded-xl border border-border bg-muted/20 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Name</Label><Input className="h-8 text-sm" value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="Contact name" /></div>
                    <div><Label className="text-xs">Company</Label><Input className="h-8 text-sm" value={newCustCompany} onChange={e => setNewCustCompany(e.target.value)} placeholder="Optional" /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setAddingCustomer(false)}>Cancel</Button>
                    <Button size="sm" className="gradient-primary text-primary-foreground border-0" onClick={() => addCustomerMut.mutate()} disabled={!newCustName.trim() || addCustomerMut.isPending}>
                      {addCustomerMut.isPending ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Button onClick={() => setDestModalOpen(true)} className="w-full h-14 gradient-warning text-warning-foreground border-0 text-base font-bold">
            <Zap className="size-5 mr-1" /> Start mass scan
          </Button>
          {(destKind === "Delivery" || (destKind === "Shops" && shop)) && (
            <>
              <div className="relative">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Or type SKU / product name to add</Label>
                <div className="relative mt-2">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={massSearch}
                    onChange={(e) => setMassSearch(e.target.value)}
                    placeholder="Start typing SKU, barcode or name…"
                    className="pl-9"
                  />
                </div>
                {massSuggestions.length > 0 && (
                  <div className="mt-2 rounded-xl border border-border bg-card shadow-md max-h-72 overflow-y-auto divide-y divide-border">
                    {massSuggestions.map((p: any) => (
                      <button key={p.id} type="button" onClick={() => addProductToScanned(p)}
                        className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary/60 text-left">
                        <div className="size-10 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><Package className="size-4" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} · {p.barcode ?? "no barcode"} · stock {displayStock(p)}</div>
                        </div>
                        <span className="text-[10px] uppercase tracking-wider text-warning font-bold shrink-0">Add</span>
                      </button>
                    ))}
                  </div>
                )}
                {massSearch.trim().length > 0 && massSuggestions.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2 px-1">No products match "{massSearch}".</p>
                )}
              </div>
            </>
          )}
        </Card>

        {scanned.length > 0 && (
          <Card className="card-elevated p-3 sm:p-4 space-y-2 border-warning/40">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg gradient-warning grid place-items-center">
                <Zap className="size-4 text-warning-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm">Scanned items · {scanned.length}</div>
                <div className="text-[11px] text-muted-foreground">
                  → {destKind === "Shops" ? (shop ?? "—") : (selectedCustomer ? (selectedCustomer.company || selectedCustomer.name) : "Delivery")} · set quantity then submit
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setScanned([])} className="text-muted-foreground">
                <Trash2 className="size-4" /> Clear
              </Button>
            </div>
            <div className="divide-y divide-border max-h-[55vh] overflow-y-auto -mx-1">
              {scanned.map((r) => (
                <div key={r.productId} className="flex items-center gap-2 py-2 px-1">
                  <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border shrink-0"><Package className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{r.barcode ?? "—"} · stock {displayStock({ stock: r.stock, pcs_per_case: r.pcsPerCase })}</div>
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
                        type="number" inputMode="numeric" min="1" max={r.stock}
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
              className="w-full h-12 gradient-warning text-warning-foreground border-0 font-bold">
              <ReceiptText className="size-5 mr-1" /> Generate bill · {scanned.length}
            </Button>
          </Card>
        )}

        <Card className="card-elevated p-3 sm:p-4 relative overflow-hidden space-y-3">
          <div className="absolute -top-20 -right-20 size-60 rounded-full bg-destructive/20 blur-3xl pointer-events-none" />
          <div className="relative">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Manual scan / search</Label>
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
          </div>
          <div className="relative">
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
                className="size-4 accent-destructive"
              />
              <span className="text-xs font-semibold flex items-center gap-1 text-foreground">
                <Zap className="size-3 text-destructive fill-destructive animate-pulse" /> Speed Scan Mode (Continuous)
              </span>
            </label>
            {scanned.length > 0 && (
              <span className="text-[11px] text-muted-foreground font-semibold bg-destructive/15 text-destructive px-2 py-0.5 rounded-full">
                Queue: {scanned.length} items
              </span>
            )}
          </div>
        </Card>

        {!showResults ? (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Browse categories</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
              {parents.map((c: any) => {
                const count = countFor(c);
                return (
                  <button key={c.id} onClick={() => setParent(c)}
                    className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-destructive/10 via-card to-card hover:border-destructive/60 hover:shadow-md active:scale-[0.98] transition-all p-4 text-left min-h-[110px]">
                    <div className="size-10 rounded-xl bg-destructive grid place-items-center mb-3 shadow-sm">
                      <Folder className="size-5 text-destructive-foreground" />
                    </div>
                    <div className="font-bold text-sm leading-tight line-clamp-2">{c.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{count} item{count === 1 ? "" : "s"}</div>
                    <ChevronRight className="size-4 text-muted-foreground absolute top-3 right-3 group-hover:text-destructive transition-colors" />
                  </button>
                );
              })}
              {parents.length === 0 && <p className="text-xs text-muted-foreground p-3 col-span-full">No categories yet.</p>}
            </div>
          </Card>
        ) : (
          <Card className="card-elevated p-3 sm:p-4">
            <div className="flex items-center gap-2 text-sm mb-3 flex-wrap">
              <button onClick={() => { setParent(null); setChild(null); setSearch(""); }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="size-4" /> Back
              </button>
              {parent && (<><ChevronRight className="size-3 text-muted-foreground" />
                <button onClick={() => setChild(null)} className="font-semibold hover:text-destructive">{parent.name}</button></>)}
              {child && (<><ChevronRight className="size-3 text-muted-foreground" /><span className="font-semibold text-destructive">{child.name}</span></>)}
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
              {filtered.slice(0, 100).map((p: any) => (
                <button key={p.id} onClick={() => setSelected(p)}
                  className={cn("w-full flex items-center gap-3 px-2 py-2.5 hover:bg-secondary/60 active:bg-secondary rounded-lg text-left",
                    selected?.id === p.id && "bg-destructive/10")}>
                  <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground shrink-0"><Package className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{p.sku ?? "—"} · {p.barcode ?? "no barcode"}</div>
                    {displaySize(p) && (
                      <div className="text-[10px] font-semibold text-accent mt-0.5">{displaySize(p)}</div>
                    )}
                  </div>
                  <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold border tabular-nums shrink-0",
                    p.stock <= 0 ? "bg-destructive text-destructive-foreground border-destructive" : "bg-secondary border-border")}>
                    {displayStock(p)}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground p-6 text-center">No products match.</p>}
            </div>
          </Card>
        )}
      </div>

      {/* Destination picker modal — opens before camera on "Start mass scan" */}
      <Dialog open={destModalOpen} onOpenChange={setDestModalOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <div className="p-5 pb-4 border-b border-border">
            <DialogTitle className="text-lg font-bold">Where is this stock going?</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Select destination before scanning.</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {TOP_DESTINATIONS.map((d) => {
                const Icon = d === "Delivery" ? Truck : Store;
                const active = destKind === d;
                return (
                  <button key={d} type="button"
                    onClick={() => { setDestKind(d); if (d === "Delivery") setShop(null); }}
                    className={cn(
                      "h-16 rounded-2xl border flex items-center justify-center gap-2 text-base font-semibold transition active:scale-[0.98]",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-md"
                        : "border-border bg-secondary/40 hover:bg-secondary",
                    )}>
                    <Icon className="size-5" /> {d}
                  </button>
                );
              })}
            </div>
            {destKind === "Shops" && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Choose shop</Label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {billingStores.map((s) => {
                    const label = s.sub || s.name;
                    return (
                      <button key={s.id} type="button" onClick={() => setShop(label)}
                        className={cn(
                          "h-11 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                          shop === label
                            ? "border-warning bg-warning text-warning-foreground shadow-sm"
                            : "border-border bg-secondary/40 hover:bg-secondary",
                        )}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {!shop && <p className="text-[11px] text-warning mt-1.5 font-medium">Pick a shop to continue.</p>}
              </div>
            )}
            {destKind === "Delivery" && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Customer (optional)</Label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setCustomerId(null)}
                    className={cn(
                      "h-10 px-4 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                      customerId === null
                        ? "border-warning bg-warning text-warning-foreground shadow-sm"
                        : "border-border bg-secondary/40 hover:bg-secondary",
                    )}>
                    General Delivery
                  </button>
                  {billingCustomers.map((c) => {
                    const label = c.company || c.name;
                    return (
                      <button key={c.id} type="button" onClick={() => setCustomerId(c.id)}
                        className={cn(
                          "h-10 px-4 rounded-xl border text-sm font-semibold transition active:scale-[0.98]",
                          customerId === c.id
                            ? "border-warning bg-warning text-warning-foreground shadow-sm"
                            : "border-border bg-secondary/40 hover:bg-secondary",
                        )}>
                        {label}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setAddingCustomer(v => !v)}
                    className="h-10 px-3 rounded-xl border border-dashed border-border bg-secondary/20 hover:bg-secondary text-sm text-muted-foreground transition flex items-center gap-1">
                    <Plus className="size-3.5" /> Add customer
                  </button>
                </div>
                {addingCustomer && (
                  <div className="mt-2 p-3 rounded-xl border border-border bg-muted/20 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-xs">Name</Label><Input className="h-8 text-sm" value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="Contact name" /></div>
                      <div><Label className="text-xs">Company</Label><Input className="h-8 text-sm" value={newCustCompany} onChange={e => setNewCustCompany(e.target.value)} placeholder="Optional" /></div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setAddingCustomer(false)}>Cancel</Button>
                      <Button size="sm" className="gradient-primary text-primary-foreground border-0" onClick={() => addCustomerMut.mutate()} disabled={!newCustName.trim() || addCustomerMut.isPending}>
                        {addCustomerMut.isPending ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="px-5 pb-5 gap-2">
            <Button variant="ghost" className="flex-1 h-12" onClick={() => setDestModalOpen(false)}>Cancel</Button>
            <Button
              className="gradient-warning text-warning-foreground border-0 flex-1 h-12 font-bold"
              disabled={destKind === "Shops" && !shop}
              onClick={() => { setDestModalOpen(false); setMassScanMode(true); setCamOpen(true); }}>
              <Zap className="size-4 mr-1" />
              Start Scanning {destKind === "Shops" ? `→ ${shop ?? ""}` : `→ ${selectedCustomer ? (selectedCustomer.company || selectedCustomer.name) : "Delivery"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setOutBoxes("0"); setOutPcs("0"); if (massScanMode) setCamOpen(true); } }}>
        <DialogContent className="max-w-md p-0 gap-0 max-h-[92vh] overflow-y-auto">
          {selected && (
            <>
              <div className="relative w-full bg-secondary shrink-0 p-5">
                <div className="size-14 rounded-2xl bg-background grid place-items-center text-muted-foreground border border-border">
                  <Package className="size-7" />
                </div>
                <div className="absolute top-2 right-2 px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-medium border border-border">
                  Stock: <span className="font-bold">{displayStock(selected)}</span>
                </div>
                <div className="mt-4 inline-flex px-2.5 py-1 rounded-full bg-background/90 backdrop-blur text-[11px] font-semibold border border-border">
                  → {destKind === "Shops" ? (shop ?? "—") : (selectedCustomer ? (selectedCustomer.company || selectedCustomer.name) : "Delivery")}
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-4">
                <div>
                  <DialogTitle className="text-lg sm:text-xl font-bold leading-tight break-words">{selected.name}</DialogTitle>
                  <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                    <span>SKU <span className="font-mono text-foreground">{selected.sku ?? "—"}</span></span>
                    <span>Barcode <span className="font-mono text-foreground">{selected.barcode ?? "—"}</span></span>
                    {displaySize(selected) && <span>Size <span className="font-semibold text-foreground">{displaySize(selected)}</span></span>}
                    <span className="inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-foreground">
                      🏠 Rack: {selected.rack ? `${selected.rack}${selected.shelf ? ` / ${selected.shelf}` : ""}` : "Unassigned"}
                    </span>
                  </div>
                </div>
                {selected.pcs_per_case > 0 ? (
                  <div className="space-y-3">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quantity to remove</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Boxes <span className="text-foreground">× {selected.pcs_per_case} pcs</span></div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setOutBoxes(String(Math.max(0, Number(outBoxes) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={outBoxes}
                            onChange={e => setOutBoxes(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setOutBoxes(String(Number(outBoxes) + 1))}>+</Button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5 font-medium">Extra Pcs</div>
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setOutPcs(String(Math.max(0, Number(outPcs) - 1)))}>−</Button>
                          <Input type="number" inputMode="numeric" min="0" value={outPcs}
                            onChange={e => setOutPcs(e.target.value)}
                            className="h-11 text-center text-lg font-bold rounded-xl" />
                          <Button variant="secondary" size="icon" className="size-11 text-xl font-bold rounded-xl shrink-0"
                            onClick={() => setOutPcs(String(Number(outPcs) + 1))}>+</Button>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 text-sm font-semibold text-center">
                      {Number(outBoxes) > 0 && <span>{outBoxes} box{Number(outBoxes) !== 1 ? "es" : ""} × {selected.pcs_per_case}</span>}
                      {Number(outBoxes) > 0 && Number(outPcs) > 0 && <span className="text-muted-foreground"> + </span>}
                      {Number(outPcs) > 0 && <span>{outPcs} pcs</span>}
                      <span className="text-warning font-bold"> = {Number(outBoxes) * selected.pcs_per_case + Number(outPcs)} total pcs</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pieces to remove</Label>
                    <div className="mt-2 flex items-center gap-3">
                      <Button variant="secondary" size="icon" className="size-14 sm:size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                        onClick={() => setOutPcs(String(Math.max(1, Number(outPcs) - 1)))}>−</Button>
                      <Input type="number" inputMode="numeric" min="1" max={selected.stock} value={outPcs} onChange={e => setOutPcs(e.target.value)}
                        className="h-14 sm:h-16 text-center text-2xl font-bold rounded-2xl" />
                      <Button variant="secondary" size="icon" className="size-14 sm:size-16 text-3xl font-bold shrink-0 rounded-2xl active:scale-95"
                        onClick={() => setOutPcs(String(Math.min(selected.stock, Number(outPcs) + 1)))}>+</Button>
                    </div>
                  </div>
                )}
                <DialogFooter className="gap-2 sm:gap-2 sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 bg-card border-t border-border">
                  <Button variant="ghost" onClick={() => { setSelected(null); setOutBoxes("0"); setOutPcs("1"); }} className="flex-1 h-12">Cancel</Button>
                  <Button className="gradient-warning text-warning-foreground border-0 flex-1 h-12 text-base font-bold"
                    disabled={apply.isPending}
                    onClick={() => {
                      const perBox = selected.pcs_per_case && selected.pcs_per_case > 0 ? selected.pcs_per_case : 0;
                      const b = Number(outBoxes) || 0;
                      const p = Number(outPcs) || 0;
                      const actual = perBox > 0 ? b * perBox + p : p;
                      if (!actual || actual < 1) { toast.error("Enter a quantity"); return; }
                      if (massScanMode || speedMode || scanned.length > 0) {
                        setScanned((rows) => {
                          const idx = rows.findIndex((r) => r.productId === selected.id);
                          if (idx >= 0) {
                            const next = [...rows];
                            const existB = Number(next[idx].boxes) || 0;
                            const existP = Number(next[idx].qty) || 0;
                            next[idx] = { ...next[idx], boxes: String(existB + b), qty: String(existP + p) };
                            return next;
                          }
                          return [...rows, {
                            productId: selected.id, name: selected.name,
                            stock: selected.stock, barcode: selected.barcode ?? null,
                            boxes: String(b), qty: String(p),
                            pcsPerCase: selected.pcs_per_case ?? null,
                          }];
                        });
                        toast.success(`Added ${actual} pcs of ${selected.name}`, { duration: 1200 });
                        setSelected(null); setOutBoxes("0"); setOutPcs("0");
                      } else {
                        apply.mutate();
                      }
                    }}>
                    {(() => {
                      const perBox = selected.pcs_per_case && selected.pcs_per_case > 0 ? selected.pcs_per_case : 0;
                      const total = perBox > 0 ? Number(outBoxes) * perBox + Number(outPcs) : Number(outPcs);
                      return (massScanMode || speedMode || scanned.length > 0) ? `Add ${total} pcs to list` : `OK · Remove ${total} pcs`;
                    })()}
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!issuedBill} onOpenChange={(v) => !v && setIssuedBill(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {issuedBill && (
            <>
              <div className="space-y-4">
                <div className="size-12 rounded-2xl gradient-warning grid place-items-center">
                  <ReceiptText className="size-6 text-warning-foreground" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold">Bill issued</DialogTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Stock reduced. Review lines below, then open billing to edit wholesale prices and finalize the invoice.
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-secondary/40 p-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Bill No</span>
                    <span className="font-mono font-bold">{issuedBill.bill_no}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Destination</span>
                    <span className="font-semibold text-right">{issuedBill.destination_label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Items</span>
                    <span className="font-semibold">{issuedBill.itemCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                    <span className="text-muted-foreground">Default total</span>
                    <span className="font-bold text-base">{formatYen(issuedBill.subtotal)}</span>
                  </div>
                </div>
                {issuedBill.lines.length > 0 && (
                  <div className="rounded-2xl border border-border overflow-hidden">
                    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/50">
                      Bill lines
                    </div>
                    <div className="divide-y divide-border max-h-48 overflow-y-auto">
                      {issuedBill.lines.map((line, i) => (
                        <div key={i} className="px-3 py-2.5 text-sm flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-tight line-clamp-2">{line.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {line.sku ?? "—"} · {line.qty_pcs} pcs
                              {line.pcs_per_case && line.pcs_per_case > 0
                                ? ` (${line.boxes} box + ${line.loose_pcs} pcs)`
                                : ""}
                              {" · "}@{formatYen(line.default_price)}
                            </div>
                          </div>
                          <span className="font-semibold shrink-0">{formatYen(line.line_total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Billing uses its own customer list and editable wholesale prices. Warehouse default prices are only a starting point.
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
                <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setIssuedBill(null)}>Close</Button>
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => nav({ to: "/warehouse-bills" })}>
                  View bills
                </Button>
                <Button className="w-full sm:flex-1 gradient-primary text-primary-foreground border-0" onClick={() => {
                  openBillingInvoiceBuilder(issuedBill)
                    .then(() => qc.invalidateQueries({ queryKey: ["warehouse-bills"] }))
                    .catch((e) => toast.error(e.message ?? "Could not generate invoice"));
                }}>
                  <ExternalLink className="size-4" /> Generate invoice
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!errorProductCode} onOpenChange={(v) => !v && setErrorProductCode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 text-destructive animate-bounce" /> Product Not Found
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The scanned barcode/SKU does not exist in the product catalog. Continuous scanning has been paused.
            </p>
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-sm font-mono text-center text-destructive font-bold">
              {errorProductCode}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button className="w-full gradient-primary text-primary-foreground border-0 h-11 font-bold" onClick={() => setErrorProductCode(null)}>
              Dismiss & Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StrichScanner
        open={camOpen}
        onClose={() => { setCamOpen(false); setMassScanMode(false); }}
        onDetected={lookup}
        keepOpenOnDetect
        onDetectedLabel={(code) => formatDetectedProductLabel(code, products)}
        muteBeep
      />
    </div>
  );
}
