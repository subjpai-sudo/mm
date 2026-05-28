import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer, Plus, Search, History, X, Receipt, Store, Truck, Settings, Pencil, Trash2, Upload } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({ component: BillingPage });

// ── Types ─────────────────────────────────────────────────────────────────────
interface BillingStore { id: string; name: string; sub: string | null; address: string | null; tel: string | null; email: string | null; zip: string | null; }
interface BillingCustomer { id: string; name: string; company: string | null; address: string | null; tel: string | null; email: string | null; notes: string | null; }
interface InvoiceItem { key: string; product_id: string | null; name: string; qty: number; price: number; pcs_per_case?: number | null; sku?: string | null; barcode?: string | null; }
interface SavedInvoice { id: string; store_id: string | null; bill_to_type: string; bill_to_store_id: string | null; customer_id: string | null; invoice_no: string | null; date: string; items: any[]; tax_rate: number; discount: number; subtotal: number; tax: number; total: number; created_at: string; }
type BillToType = "store" | "customer";

const db = () => supabase as any;
const uid = () => crypto.randomUUID();

// ── Page ──────────────────────────────────────────────────────────────────────
function BillingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [issuingStoreId, setIssuingStoreId] = useState("");
  const [billToType, setBillToType] = useState<BillToType>("store");
  const [billToStoreId, setBillToStoreId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [invDate, setInvDate] = useState(today);
  const [invNo, setInvNo] = useState("INV-" + String(Date.now()).slice(-4));
  const [taxRate, setTaxRate] = useState("8");
  const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [manageStoresOpen, setManageStoresOpen] = useState(false);
  const [manageCustomersOpen, setManageCustomersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const { data: stores = [] } = useQuery<BillingStore[]>({
    queryKey: ["billing-stores"],
    queryFn: async () => (await db().from("billing_stores").select("*").order("sub")).data ?? [],
  });
  const { data: customers = [] } = useQuery<BillingCustomer[]>({
    queryKey: ["billing-customers"],
    queryFn: async () => (await db().from("billing_customers").select("*").order("name")).data ?? [],
  });
  const { data: history = [] } = useQuery<SavedInvoice[]>({
    queryKey: ["billing-invoices"],
    queryFn: async () => (await db().from("billing_invoices").select("*").order("created_at", { ascending: false }).limit(60)).data ?? [],
  });
  const { data: searchResults = [] } = useQuery({
    queryKey: ["billing-product-search", searchQ],
    enabled: searchQ.trim().length >= 1,
    queryFn: async () => {
      const q = searchQ.trim();
      const { data } = await supabase.from("products")
        .select("id, name, price, barcode, sku, image_url, pcs_per_case")
        .or(`name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(12);
      return data ?? [];
    },
  });

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.qty * i.price, 0), [items]);
  const discountAmt = useMemo(() => Math.max(0, Number(discount) || 0), [discount]);
  const taxable = useMemo(() => Math.max(0, subtotal - discountAmt), [subtotal, discountAmt]);
  const tax = useMemo(() => Math.round(taxable * (Number(taxRate) / 100)), [taxable, taxRate]);
  const total = taxable + tax;

  const issuingStore = stores.find(s => s.id === issuingStoreId) ?? null;
  const billToStore = stores.find(s => s.id === billToStoreId) ?? null;
  const billToCustomer = customers.find(c => c.id === customerId) ?? null;

  const dirty = () => setSavedId(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        store_id: issuingStoreId || null,
        bill_to_type: billToType,
        bill_to_store_id: billToType === "store" ? billToStoreId || null : null,
        customer_id: billToType === "customer" ? customerId || null : null,
        invoice_no: invNo, date: invDate,
        items: items.map(({ key: _k, ...rest }) => rest),
        tax_rate: Number(taxRate), discount: discountAmt,
        subtotal, tax, total, created_by: user?.id ?? null,
      };
      if (savedId) {
        const { data, error } = await db().from("billing_invoices").update(payload).eq("id", savedId).select().single();
        if (error) throw new Error(error.message);
        return data as SavedInvoice;
      }
      const { data, error } = await db().from("billing_invoices").insert(payload).select().single();
      if (error) throw new Error(error.message);
      return data as SavedInvoice;
    },
    onSuccess: (d) => { setSavedId(d.id); qc.invalidateQueries({ queryKey: ["billing-invoices"] }); toast.success("Invoice saved"); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save invoice"),
  });

  const addProduct = useCallback((p: any) => {
    setItems(prev => [...prev, { key: uid(), product_id: p.id, name: p.name, qty: 1, price: p.price ?? 0, pcs_per_case: p.pcs_per_case ?? null, sku: p.sku ?? null, barcode: p.barcode ?? null }]);
    setSearchQ(""); setSearchOpen(false); dirty();
  }, []);
  const removeItem = (key: string) => { setItems(p => p.filter(i => i.key !== key)); dirty(); };
  const updateItem = (key: string, field: "qty" | "price" | "name", val: string) => {
    setItems(p => p.map(i => i.key === key ? { ...i, [field]: field === "name" ? val : Math.max(0, Number(val) || 0) } : i));
    dirty();
  };

  function reset() {
    setIssuingStoreId(""); setBillToType("store"); setBillToStoreId(""); setCustomerId("");
    setInvDate(today); setInvNo("INV-" + String(Date.now()).slice(-4));
    setTaxRate("8"); setDiscount("0"); setItems([]); setSavedId(null);
  }

  function loadInvoice(inv: SavedInvoice) {
    setIssuingStoreId(inv.store_id ?? "");
    setBillToType((inv.bill_to_type as BillToType) ?? "store");
    setBillToStoreId(inv.bill_to_store_id ?? "");
    setCustomerId(inv.customer_id ?? "");
    setInvDate(inv.date); setInvNo(inv.invoice_no ?? "");
    setTaxRate(String(inv.tax_rate)); setDiscount(String(inv.discount ?? 0));
    setItems((Array.isArray(inv.items) ? inv.items : []).map((i: any) => ({ ...i, key: uid() })));
    setSavedId(inv.id);
  }

  async function handlePrint() {
    try {
      await saveMut.mutateAsync();
      setPrintOpen(true);
    } catch {
      // error already shown by onError
    }
  }

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <PageHeader eyebrow="Point of Sale" title="Billing" subtitle="Create invoices and print receipts." />
        <div className="flex items-center gap-2">
          <Link to="/billing-history">
            <Button variant="outline" size="icon" title="Invoice History"><History className="size-4" /></Button>
          </Link>
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} title="Stamp & settings">
            <Settings className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">

        {/* ── Invoice creation ─────────────────────────────────────────── */}
        <Card className="card-elevated p-5 space-y-4">

          {/* Issuing store + date + invoice no */}
          <div className="grid sm:grid-cols-[1fr_150px_150px] gap-3">
            <div>
              <Label className="upper-label mb-1.5 block">Our Store (FROM)</Label>
              <Select value={issuingStoreId} onValueChange={v => { setIssuingStoreId(v); dirty(); }}>
                <SelectTrigger><SelectValue placeholder="Select issuing store…" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.sub ? ` — ${s.sub}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="upper-label mb-1.5 block">Date</Label>
              <Input type="date" value={invDate} onChange={e => { setInvDate(e.target.value); dirty(); }} />
            </div>
            <div>
              <Label className="upper-label mb-1.5 block">Invoice No.</Label>
              <Input value={invNo} onChange={e => { setInvNo(e.target.value); dirty(); }} />
            </div>
          </div>

          {/* Bill To */}
          <div>
            <Label className="upper-label mb-2 block">Bill To</Label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(["store", "customer"] as BillToType[]).map(t => (
                <button key={t} onClick={() => { setBillToType(t); dirty(); }}
                  className={cn("h-10 rounded-xl border flex items-center justify-center gap-2 text-sm font-semibold transition",
                    billToType === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/40 hover:bg-secondary")}>
                  {t === "store" ? <Store className="size-4" /> : <Truck className="size-4" />}
                  {t === "store" ? "Store / Shop" : "Customer / Delivery"}
                </button>
              ))}
            </div>
            {billToType === "store" ? (
              <div className="flex gap-2">
                <Select value={billToStoreId} onValueChange={v => { setBillToStoreId(v); dirty(); }}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select destination shop…" /></SelectTrigger>
                  <SelectContent>
                    {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.sub ? ` — ${s.sub}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => setManageStoresOpen(true)} title="Manage stores"><Pencil className="size-4" /></Button>
                <Button variant="outline" size="icon" onClick={() => { setManageStoresOpen(true); }} title="Add store"><Plus className="size-4" /></Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={customerId} onValueChange={v => { setCustomerId(v); dirty(); }}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder={customers.length === 0 ? "No customers yet — add one →" : "Select customer…"} /></SelectTrigger>
                  <SelectContent>
                    {customers.length === 0
                      ? <div className="px-3 py-4 text-sm text-muted-foreground text-center">No customers yet.<br />Use the + button to add one.</div>
                      : customers.map(c => <SelectItem key={c.id} value={c.id}>{c.company ? `${c.company} — ${c.name}` : c.name}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => setManageCustomersOpen(true)} title="Manage customers"><Pencil className="size-4" /></Button>
                <Button variant="outline" size="icon" onClick={() => setManageCustomersOpen(true)} title="Add customer"><Plus className="size-4" /></Button>
              </div>
            )}
          </div>

          {/* Product search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input className="pl-9" placeholder="Search product by name or scan barcode…"
              value={searchQ} onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)} onBlur={() => setTimeout(() => setSearchOpen(false), 180)} />
            {searchOpen && (searchResults as any[]).length > 0 && (
              <div className="absolute z-50 w-full top-full mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
                {(searchResults as any[]).map(p => (
                  <button key={p.id} onMouseDown={() => addProduct(p)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent/50 flex items-center gap-3">
                    {p.image_url
                      ? <img src={p.image_url} className="size-8 rounded object-cover shrink-0" />
                      : <div className="size-8 rounded bg-muted shrink-0 grid place-items-center"><Receipt className="size-3.5 text-muted-foreground" /></div>}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      {(p.sku || p.barcode) && (
                        <div className="text-xs text-muted-foreground font-mono">{p.sku ?? p.barcode}</div>
                      )}
                    </div>
                    <span className="text-muted-foreground shrink-0">¥{(p.price ?? 0).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items table */}
          {items.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg py-12 text-center text-muted-foreground text-sm">
              Search a product above or add a manual row
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs w-8">#</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs">Product</th>
                    <th className="text-right px-2 py-2 text-muted-foreground font-medium text-xs w-20">Qty</th>
                    <th className="text-right px-2 py-2 text-muted-foreground font-medium text-xs w-28">Unit ¥</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium text-xs w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, idx) => (
                    <tr key={item.key} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="px-2 py-1">
                        <Input className="h-7 text-sm border-0 bg-transparent px-1 focus-visible:ring-1" value={item.name}
                          onChange={e => updateItem(item.key, "name", e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" min={1} className="h-7 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-1 w-full"
                          value={item.qty} onChange={e => updateItem(item.key, "qty", e.target.value)} />
                        {item.pcs_per_case && item.pcs_per_case > 1 && (
                          <div className="text-xs text-muted-foreground text-right tabular-nums pr-1">{item.qty * item.pcs_per_case}pcs</div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" min={0} className="h-7 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-1 w-full"
                          value={item.price} onChange={e => updateItem(item.key, "price", e.target.value)} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">¥{(item.qty * item.price).toLocaleString()}</td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeItem(item.key)} className="text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals + actions */}
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>
              <Button variant="outline" size="sm" onClick={() => { setItems(p => [...p, { key: uid(), product_id: null, name: "", qty: 1, price: 0 }]); dirty(); }}>
                <Plus className="size-3.5 mr-1" /> Add row
              </Button>
            </div>
            <div className="text-right space-y-1 min-w-[220px]">
              <div className="flex justify-between gap-8 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">¥{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm items-center">
                <span className="text-muted-foreground">Discount (¥)</span>
                <Input type="number" min={0} className="h-6 w-28 text-xs text-right" value={discount}
                  onChange={e => { setDiscount(e.target.value); dirty(); }} />
              </div>
              <div className="flex justify-between gap-4 text-sm items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Tax</span>
                  <Input type="number" min={0} max={100} className="h-6 w-14 text-xs text-right" value={taxRate}
                    onChange={e => { setTaxRate(e.target.value); dirty(); }} />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums">¥{tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-8 font-bold text-lg border-t border-border pt-1.5 mt-1">
                <span>Total</span>
                <span className="tabular-nums">¥{total.toLocaleString()}</span>
              </div>
              <Button className="gradient-primary text-primary-foreground border-0 w-full mt-2"
                disabled={items.length === 0 || saveMut.isPending} onClick={handlePrint}>
                <Printer className="size-4 mr-2" />
                {saveMut.isPending ? "Saving…" : "Print / Save Invoice"}
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Invoice history ───────────────────────────────────────────── */}
        <Card className="card-elevated p-5">
          <div className="upper-label mb-3 flex items-center gap-1.5"><History className="size-3.5" /> Invoice History</div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No invoices yet</p>
          ) : (
            <ScrollArea className="h-[calc(100vh-260px)] min-h-[300px]">
              <div className="space-y-2 pr-1">
                {history.map(inv => {
                  const fromStore = stores.find(s => s.id === inv.store_id);
                  const toStore = stores.find(s => s.id === inv.bill_to_store_id);
                  const cust = customers.find(c => c.id === inv.customer_id);
                  const toLabel = inv.bill_to_type === "customer"
                    ? (cust?.company || cust?.name || "Customer")
                    : (toStore ? `${toStore.name}${toStore.sub ? ` ${toStore.sub}` : ""}` : "—");
                  return (
                    <button key={inv.id} onClick={() => loadInvoice(inv)}
                      className={cn("w-full text-left rounded-lg border border-border p-3 hover:bg-accent/40 transition-colors",
                        savedId === inv.id && "border-primary/50 bg-primary/5")}>
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="font-mono text-xs font-semibold">{inv.invoice_no || "—"}</span>
                        <span className="text-xs text-muted-foreground">{inv.date}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {fromStore ? `${fromStore.sub ?? fromStore.name} → ` : ""}{toLabel}
                      </div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-xs text-muted-foreground">{Array.isArray(inv.items) ? inv.items.length : 0} items</span>
                        <span className="font-semibold tabular-nums">¥{inv.total.toLocaleString()}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </Card>
      </div>

      {/* Modals */}
      {manageStoresOpen && <ManageStoresModal onClose={() => { setManageStoresOpen(false); qc.invalidateQueries({ queryKey: ["billing-stores"] }); }} />}
      {manageCustomersOpen && <ManageCustomersModal onClose={() => { setManageCustomersOpen(false); qc.invalidateQueries({ queryKey: ["billing-customers"] }); }} />}
      {settingsOpen && <BillingSettingsModal onClose={() => setSettingsOpen(false)} />}
      {printOpen && (
        <PrintModal
          issuingStore={issuingStore} billToType={billToType}
          billToStore={billToStore} billToCustomer={billToCustomer}
          invNo={invNo} date={invDate} items={items}
          taxRate={Number(taxRate)} discount={discountAmt}
          subtotal={subtotal} tax={tax} total={total}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}

// ── Manage Stores Modal ────────────────────────────────────────────────────────
function ManageStoresModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: stores = [] } = useQuery<BillingStore[]>({
    queryKey: ["billing-stores"],
    queryFn: async () => (await db().from("billing_stores").select("*").order("sub")).data ?? [],
  });
  const blank = (): Omit<BillingStore, "id"> => ({ name: "MM-MART", sub: "", address: "", tel: "", email: "", zip: "" });
  const [form, setForm] = useState<Omit<BillingStore, "id"> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form) return;
      if (editId) {
        await db().from("billing_stores").update(form).eq("id", editId);
      } else {
        const id = form.sub ? form.sub.toLowerCase().replace(/\s+/g, "_") : uid();
        await db().from("billing_stores").insert({ id, ...form });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing-stores"] }); setForm(null); setEditId(null); toast.success("Store saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => { await db().from("billing_stores").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing-stores"] }); toast.success("Deleted"); },
  });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manage Stores</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {stores.map(s => (
            <div key={s.id} className="flex items-center gap-2 p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{s.name}{s.sub ? ` — ${s.sub}` : ""}</div>
                <div className="text-xs text-muted-foreground truncate">{s.address || "—"} {s.tel ? `· Tel: ${s.tel}` : ""}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => { setEditId(s.id); setForm({ name: s.name, sub: s.sub ?? "", address: s.address ?? "", tel: s.tel ?? "", email: s.email ?? "", zip: s.zip ?? "" }); }}><Pencil className="size-4" /></Button>
              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("Delete this store?")) deleteMut.mutate(s.id); }}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="w-full mt-2" onClick={() => { setEditId(null); setForm(blank()); }}>
          <Plus className="size-4 mr-2" /> Add Store
        </Button>
        {form && (
          <div className="mt-4 p-4 border border-border rounded-lg space-y-3 bg-muted/20">
            <div className="text-sm font-semibold">{editId ? "Edit Store" : "Add Store"}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)} /></div>
              <div><Label className="text-xs">Branch / Sub</Label><Input value={form.sub ?? ""} onChange={e => setForm(f => f ? { ...f, sub: e.target.value } : f)} /></div>
              <div className="col-span-2"><Label className="text-xs">Address</Label><Input value={form.address ?? ""} onChange={e => setForm(f => f ? { ...f, address: e.target.value } : f)} /></div>
              <div><Label className="text-xs">Tel</Label><Input value={form.tel ?? ""} onChange={e => setForm(f => f ? { ...f, tel: e.target.value } : f)} /></div>
              <div><Label className="text-xs">ZIP</Label><Input value={form.zip ?? ""} onChange={e => setForm(f => f ? { ...f, zip: e.target.value } : f)} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setForm(null); setEditId(null); }}>Cancel</Button>
              <Button className="gradient-primary text-primary-foreground border-0" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save</Button>
            </div>
          </div>
        )}
        <DialogFooter className="mt-2"><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Manage Customers Modal ────────────────────────────────────────────────────
function ManageCustomersModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useQuery<BillingCustomer[]>({
    queryKey: ["billing-customers"],
    queryFn: async () => (await db().from("billing_customers").select("*").order("name")).data ?? [],
  });
  const blank = () => ({ name: "", company: "", address: "", tel: "", email: "", notes: "" });
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload = { name: form.name, company: form.company || null, address: form.address || null, tel: form.tel || null, email: form.email || null, notes: form.notes || null };
      if (editId) { await db().from("billing_customers").update(payload).eq("id", editId); }
      else { await db().from("billing_customers").insert(payload); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing-customers"] }); setForm(null); setEditId(null); toast.success("Customer saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => { await db().from("billing_customers").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing-customers"] }); toast.success("Deleted"); },
  });

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Manage Customers</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {customers.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No customers yet</p>}
          {customers.map(c => (
            <div key={c.id} className="flex items-center gap-2 p-3 border border-border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{c.company ? `${c.company} — ` : ""}{c.name}</div>
                <div className="text-xs text-muted-foreground truncate">{c.address || "—"} {c.tel ? `· ${c.tel}` : ""}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => { setEditId(c.id); setForm({ name: c.name, company: c.company ?? "", address: c.address ?? "", tel: c.tel ?? "", email: c.email ?? "", notes: c.notes ?? "" }); }}><Pencil className="size-4" /></Button>
              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("Delete this customer?")) deleteMut.mutate(c.id); }}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <Button variant="outline" className="w-full mt-2" onClick={() => { setEditId(null); setForm(blank()); }}>
          <Plus className="size-4 mr-2" /> Add Customer
        </Button>
        {form && (
          <div className="mt-4 p-4 border border-border rounded-lg space-y-3 bg-muted/20">
            <div className="text-sm font-semibold">{editId ? "Edit Customer" : "Add Customer"}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(f => f ? { ...f, name: e.target.value } : f)} /></div>
              <div><Label className="text-xs">Company</Label><Input value={form.company} onChange={e => setForm(f => f ? { ...f, company: e.target.value } : f)} /></div>
              <div className="col-span-2"><Label className="text-xs">Address</Label><Input value={form.address} onChange={e => setForm(f => f ? { ...f, address: e.target.value } : f)} /></div>
              <div><Label className="text-xs">Tel</Label><Input value={form.tel} onChange={e => setForm(f => f ? { ...f, tel: e.target.value } : f)} /></div>
              <div><Label className="text-xs">Email</Label><Input value={form.email} onChange={e => setForm(f => f ? { ...f, email: e.target.value } : f)} /></div>
              <div className="col-span-2"><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={e => setForm(f => f ? { ...f, notes: e.target.value } : f)} /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setForm(null); setEditId(null); }}>Cancel</Button>
              <Button className="gradient-primary text-primary-foreground border-0" onClick={() => saveMut.mutate()} disabled={!form.name || saveMut.isPending}>Save</Button>
            </div>
          </div>
        )}
        <DialogFooter className="mt-2"><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Billing Settings Modal ────────────────────────────────────────────────────
function BillingSettingsModal({ onClose }: { onClose: () => void }) {
  const [stampB64, setStampB64] = useState<string>(() => localStorage.getItem("billing-stamp-b64") ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target?.result as string;
      setStampB64(b64);
      localStorage.setItem("billing-stamp-b64", b64);
      toast.success("Stamp saved");
    };
    reader.readAsDataURL(file);
  }

  function clearStamp() { setStampB64(""); localStorage.removeItem("billing-stamp-b64"); toast.success("Stamp removed"); }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Billing Settings</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-semibold mb-2 block">Company Stamp / Seal</Label>
            <p className="text-xs text-muted-foreground mb-3">Upload your stamp image. It will appear in the top-right of printed invoices. Saved in this browser.</p>
            {stampB64 ? (
              <div className="flex items-center gap-3">
                <img src={stampB64} className="size-20 object-contain border border-border rounded-lg bg-white p-1" alt="Stamp" />
                <div className="space-y-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="size-3.5 mr-1.5" /> Replace</Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive w-full" onClick={clearStamp}><Trash2 className="size-3.5 mr-1.5" /> Remove</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4 mr-2" /> Upload Stamp Image
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </div>
        </div>
        <DialogFooter><Button className="gradient-primary text-primary-foreground border-0" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Print Modal ────────────────────────────────────────────────────────────────
function PrintModal({ issuingStore, billToType, billToStore, billToCustomer, invNo, date, items, taxRate, discount, subtotal, tax, total, onClose }: {
  issuingStore: BillingStore | null;
  billToType: BillToType;
  billToStore: BillingStore | null;
  billToCustomer: BillingCustomer | null;
  invNo: string; date: string; items: InvoiceItem[];
  taxRate: number; discount: number; subtotal: number; tax: number; total: number;
  onClose: () => void;
}) {
  const [stampB64] = useState<string>(() => localStorage.getItem("billing-stamp-b64") ?? "");

  const billToName = billToType === "customer"
    ? (billToCustomer?.company || billToCustomer?.name || "")
    : (billToStore ? `${billToStore.name}${billToStore.sub ? ` — ${billToStore.sub}` : ""}` : "");
  const billToAddr = billToType === "customer" ? billToCustomer?.address : billToStore?.address;
  const billToTel  = billToType === "customer" ? billToCustomer?.tel    : billToStore?.tel;

  const fmt     = (n: number) => n.toLocaleString("ja-JP");
  const qtyLabel = (it: InvoiceItem) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty} Case` : String(it.qty);
  const unitLabel = (it: InvoiceItem) => it.pcs_per_case && it.pcs_per_case > 1 ? `${it.qty * it.pcs_per_case}pcs` : "PCS";
  const itemNo   = (it: InvoiceItem, idx: number) => it.sku || it.barcode || String(idx + 1);

  function doPrint() {
    const w = window.open("", "_blank", "width=820,height=1100");
    if (!w) { toast.error("Popup blocked — allow popups for this site then try again"); return; }
    const ROWS_PER_PAGE = 20;
    const filled = items.filter(i => i.name);
    if (!filled.length) { toast.error("No items to print"); return; }
    const pages: InvoiceItem[][] = [];
    for (let i = 0; i < filled.length; i += ROWS_PER_PAGE) pages.push(filled.slice(i, i + ROWS_PER_PAGE));

    const issuingName = `${issuingStore?.name ?? "CITY STAR 株式会社"}${issuingStore?.sub ? ` — ${issuingStore.sub}` : ""}`;
    const addrLines = [
      issuingStore?.zip ? `〒${issuingStore.zip}` : null,
      issuingStore?.address ?? null,
      issuingStore?.tel ? `TELL＝${issuingStore.tel}` : null,
    ].filter(Boolean) as string[];

    const pagesHtml = pages.map((pg, pi) => {
      const isLast = pi === pages.length - 1;
      const emptyRows = Math.max(0, ROWS_PER_PAGE - pg.length);
      return `<div class="inv-page">
  <div class="inv-header">
    <div></div>
    <div class="inv-header-right">
      ${stampB64 ? `<img src="${stampB64}" class="stamp-img" alt="stamp">` : ""}
      <div class="co-name">${issuingName}</div>
      ${addrLines.length ? `<div class="co-addr">${addrLines.join("<br>")}</div>` : ""}
    </div>
  </div>
  <hr class="divider">
  <div class="inv-customer">
    <div>
      <div class="cust-name">CUSTOMER: &nbsp;${billToName || "—"}</div>
      ${billToAddr ? `<div class="cust-detail">DETAILS: &nbsp;${billToAddr}</div>` : ""}
      ${billToTel  ? `<div class="cust-detail">${billToTel}</div>` : ""}
    </div>
    <div class="cust-right">
      <div><span class="mlbl">DATE</span> &nbsp; <span class="mval">${date}</span></div>
      <div><span class="mlbl">INVOICE NO:</span> &nbsp; <span class="mval">${invNo || "—"}</span></div>
      <div class="cod">CASH ON DELIVER</div>
      <div><span class="mlbl">SHEET NO:</span> &nbsp; <span class="mval">${pi + 1}-${pages.length}</span></div>
    </div>
  </div>
  ${pi === 0 ? `<div class="grand-total-banner">GRAND TOTAL : &nbsp;¥ ${fmt(total)}</div>` : ""}
  <div class="invoice-title">INVOICE</div>
  <table class="inv-table">
    <thead><tr>
      <th style="width:32px">S.NO</th>
      <th style="width:60px">ITEM NO</th>
      <th class="left">PRODUCT NAME</th>
      <th style="width:56px">QNT</th>
      <th style="width:56px">UNIT</th>
      <th style="width:80px">UNIT PRICE</th>
      <th style="width:80px">AMOUNT</th>
    </tr></thead>
    <tbody>
      ${pg.map((it, i) => `<tr>
        <td class="ctr">${pi * ROWS_PER_PAGE + i + 1}</td>
        <td class="ctr mono">${itemNo(it, pi * ROWS_PER_PAGE + i)}</td>
        <td>${it.name}</td>
        <td class="ctr">${qtyLabel(it)}</td>
        <td class="ctr">${unitLabel(it)}</td>
        <td class="rgt">¥${fmt(it.price)}</td>
        <td class="rgt">¥${fmt(it.qty * it.price)}</td>
      </tr>`).join("")}
      ${Array(emptyRows).fill(`<tr class="empty-row"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("")}
    </tbody>
  </table>
  ${isLast ? `<div class="inv-footer">
    <div class="bank-info">シティスター株式会社<br>ゆうちょ銀行　11370-03843431<br>マツモト</div>
    <table class="totals-tbl">
      <tr><td class="lbl">TOTAL</td><td class="val">¥${fmt(subtotal)}</td></tr>
      ${discount > 0 ? `<tr><td class="lbl">DISCOUNT</td><td class="val dsc">−¥${fmt(discount)}</td></tr>` : ""}
      ${taxRate > 0 ? `<tr><td class="lbl">TAX (${taxRate}%)</td><td class="val">¥${fmt(tax)}</td></tr>` : ""}
      <tr><td class="grand-lbl">TOTAL</td><td class="grand-val">¥${fmt(total)}</td></tr>
    </table>
  </div>` : ""}
</div>`;
    }).join("");

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${invNo}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,'Yu Gothic','游ゴシック',sans-serif;font-size:11px;background:#fff;padding:10px}
@page{size:A4;margin:10mm 12mm}
.inv-page{background:#fff;width:100%;page-break-after:always;padding:2px}
.inv-page:last-child{page-break-after:avoid}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.inv-header-right{text-align:right;position:relative;padding-right:${stampB64 ? "90px" : "4px"};min-width:260px}
.co-name{font-size:20px;font-weight:700;color:#1a1a1a;line-height:1.2}
.co-addr{font-size:9.5px;color:#333;line-height:1.7;margin-top:3px}
.stamp-img{position:absolute;top:0;right:0;width:80px;height:72px;object-fit:contain;opacity:.92}
hr.divider{border:none;border-top:2px solid #1a1a1a;margin:6px 0}
.inv-customer{display:grid;grid-template-columns:1fr auto;gap:12px;margin-bottom:6px}
.cust-name{font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:3px}
.cust-detail{font-size:10px;color:#333;line-height:1.6}
.cust-right{text-align:right;font-size:11px;line-height:2}
.mlbl{font-weight:600}
.mval{font-weight:700}
.cod{font-size:10px;color:#555;font-style:italic}
.grand-total-banner{background:#1F4E79;color:#fff;text-align:center;padding:5px 12px;font-size:13px;font-weight:700;letter-spacing:1px;margin:4px 0}
.invoice-title{text-align:center;font-size:22px;font-weight:900;letter-spacing:6px;border-top:2px solid #1a1a1a;border-bottom:2px solid #1a1a1a;padding:5px 0;margin:6px 0}
.inv-table{width:100%;border-collapse:collapse;font-size:10px}
.inv-table th{background:#1F4E79;color:#fff;padding:5px 6px;text-align:center;border:1px solid #1F4E79;font-size:10px;font-weight:700}
.inv-table th.left{text-align:left}
.inv-table td{padding:3px 6px;border:1px solid #bbb;height:20px;vertical-align:middle}
.inv-table td.ctr{text-align:center}
.inv-table td.rgt{text-align:right}
.inv-table td.mono{font-family:monospace;font-size:9px}
.inv-table .empty-row td{height:20px}
.inv-footer{margin-top:8px;display:grid;grid-template-columns:1fr auto;align-items:end;gap:12px}
.bank-info{font-size:10px;color:#333;line-height:1.8}
.totals-tbl{border-collapse:collapse;font-size:11px}
.totals-tbl td{padding:4px 10px;border:1px solid #bbb}
.totals-tbl .lbl{background:#f0f0f0;font-weight:600;text-align:right;white-space:nowrap}
.totals-tbl .val{text-align:right;min-width:90px;font-weight:600}
.totals-tbl .dsc{color:#e53e3e}
.totals-tbl .grand-lbl{background:#1F4E79;color:#fff;font-weight:700;text-align:right;white-space:nowrap}
.totals-tbl .grand-val{font-weight:700;font-size:13px;text-align:right;color:#1F4E79}
</style></head><body>${pagesHtml}</body></html>`);
    w.document.close();
    const imgs = w.document.querySelectorAll("img");
    if (!imgs.length) { setTimeout(() => { w.focus(); w.print(); }, 200); return; }
    let loaded = 0;
    const tryPrint = () => { if (++loaded === imgs.length) { w.focus(); w.print(); } };
    imgs.forEach(img => { if ((img as HTMLImageElement).complete) tryPrint(); else { img.onload = tryPrint; img.onerror = tryPrint; } });
  }

  const filledItems = items.filter(i => i.name);
  const emptyPad   = Math.max(0, 8 - filledItems.length);
  const issuingName = `${issuingStore?.name ?? "CITY STAR 株式会社"}${issuingStore?.sub ? ` — ${issuingStore.sub}` : ""}`;

  const TH = (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th style={{ background: "#1F4E79", color: "#fff", padding: "5px 6px", border: "1px solid #1F4E79", fontSize: 10, fontWeight: 700, ...props.style }} {...props} />
  );
  const TD = (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td style={{ padding: "3px 6px", border: "1px solid #bbb", height: 20, verticalAlign: "middle", ...props.style }} {...props} />
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Invoice Preview</DialogTitle></DialogHeader>

        <div className="bg-white rounded border border-border p-5 text-black" style={{ fontFamily: "Arial,'Yu Gothic',sans-serif", fontSize: 11 }}>

          {/* ── Company header (right-aligned) ── */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <div style={{ textAlign: "right", position: "relative", paddingRight: stampB64 ? 90 : 4, minWidth: 260 }}>
              {stampB64 && <img src={stampB64} style={{ position: "absolute", top: 0, right: 0, width: 80, height: 72, objectFit: "contain", opacity: 0.92 }} alt="stamp" />}
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", lineHeight: 1.2 }}>{issuingName}</div>
              {(issuingStore?.address || issuingStore?.tel) && (
                <div style={{ fontSize: 9.5, color: "#333", lineHeight: 1.7, marginTop: 3 }}>
                  {issuingStore.zip && <>{`〒${issuingStore.zip}`}<br /></>}
                  {issuingStore.address && <>{issuingStore.address}<br /></>}
                  {issuingStore.tel && <>TELL＝{issuingStore.tel}</>}
                </div>
              )}
            </div>
          </div>

          {/* ── Divider ── */}
          <hr style={{ border: "none", borderTop: "2px solid #1a1a1a", margin: "6px 0" }} />

          {/* ── Customer + meta ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a1a", marginBottom: 3 }}>CUSTOMER: &nbsp;{billToName || "—"}</div>
              {billToAddr && <div style={{ fontSize: 10, color: "#333", lineHeight: 1.6 }}>DETAILS: &nbsp;{billToAddr}</div>}
              {billToTel  && <div style={{ fontSize: 10, color: "#333" }}>{billToTel}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 11, lineHeight: 2 }}>
              <div><span style={{ fontWeight: 600 }}>DATE</span> &nbsp; <span style={{ fontWeight: 700 }}>{date}</span></div>
              <div><span style={{ fontWeight: 600 }}>INVOICE NO:</span> &nbsp; <span style={{ fontWeight: 700 }}>{invNo || "—"}</span></div>
              <div style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>CASH ON DELIVER</div>
              <div><span style={{ fontWeight: 600 }}>SHEET NO:</span> &nbsp; <span style={{ fontWeight: 700 }}>1-1</span></div>
            </div>
          </div>

          {/* ── Grand total banner ── */}
          <div style={{ background: "#1F4E79", color: "#fff", textAlign: "center", padding: "5px 12px", fontSize: 13, fontWeight: 700, letterSpacing: 1, margin: "4px 0" }}>
            GRAND TOTAL : &nbsp;¥ {fmt(total)}
          </div>

          {/* ── INVOICE title ── */}
          <div style={{ textAlign: "center", fontSize: 22, fontWeight: 900, letterSpacing: 6, borderTop: "2px solid #1a1a1a", borderBottom: "2px solid #1a1a1a", padding: "5px 0", margin: "6px 0" }}>
            INVOICE
          </div>

          {/* ── Items table ── */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <TH style={{ width: 32, textAlign: "center" }}>S.NO</TH>
                <TH style={{ width: 60, textAlign: "center" }}>ITEM NO</TH>
                <TH style={{ textAlign: "left" }}>PRODUCT NAME</TH>
                <TH style={{ width: 56, textAlign: "center" }}>QNT</TH>
                <TH style={{ width: 56, textAlign: "center" }}>UNIT</TH>
                <TH style={{ width: 80, textAlign: "center" }}>UNIT PRICE</TH>
                <TH style={{ width: 80, textAlign: "center" }}>AMOUNT</TH>
              </tr>
            </thead>
            <tbody>
              {filledItems.map((it, i) => (
                <tr key={it.key}>
                  <TD style={{ textAlign: "center" }}>{i + 1}</TD>
                  <TD style={{ textAlign: "center", fontFamily: "monospace", fontSize: 9 }}>{itemNo(it, i)}</TD>
                  <TD>{it.name}</TD>
                  <TD style={{ textAlign: "center" }}>{qtyLabel(it)}</TD>
                  <TD style={{ textAlign: "center" }}>{unitLabel(it)}</TD>
                  <TD style={{ textAlign: "right" }}>¥{fmt(it.price)}</TD>
                  <TD style={{ textAlign: "right" }}>¥{fmt(it.qty * it.price)}</TD>
                </tr>
              ))}
              {Array.from({ length: emptyPad }).map((_, i) => (
                <tr key={`e${i}`}>
                  {Array.from({ length: 7 }).map((__, j) => <TD key={j} />)}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Footer ── */}
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "end", gap: 12 }}>
            <div style={{ fontSize: 10, color: "#333", lineHeight: 1.8 }}>
              シティスター株式会社<br />
              ゆうちょ銀行　11370-03843431<br />
              マツモト
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
              <tbody>
                <tr>
                  <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TOTAL</td>
                  <td style={{ textAlign: "right", minWidth: 90, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb" }}>¥{fmt(subtotal)}</td>
                </tr>
                {discount > 0 && (
                  <tr>
                    <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>DISCOUNT</td>
                    <td style={{ textAlign: "right", minWidth: 90, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb", color: "#e53e3e" }}>−¥{fmt(discount)}</td>
                  </tr>
                )}
                {taxRate > 0 && (
                  <tr>
                    <td style={{ background: "#f0f0f0", fontWeight: 600, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TAX ({taxRate}%)</td>
                    <td style={{ textAlign: "right", minWidth: 90, fontWeight: 600, padding: "4px 10px", border: "1px solid #bbb" }}>¥{fmt(tax)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ background: "#1F4E79", color: "#fff", fontWeight: 700, textAlign: "right", padding: "4px 10px", border: "1px solid #bbb", whiteSpace: "nowrap" }}>TOTAL</td>
                  <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13, padding: "4px 10px", border: "1px solid #bbb", color: "#1F4E79" }}>¥{fmt(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="gradient-primary text-primary-foreground border-0" onClick={doPrint}>
            <Printer className="size-4 mr-2" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
