import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer, Plus, Search, History, X, Receipt } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({ component: BillingPage });

// ── Types ─────────────────────────────────────────────────────────────────────
interface BillingStore { id: string; name: string; sub: string | null; address: string | null; tel: string | null; email: string | null; zip: string | null; }
interface InvoiceItem { key: string; product_id: string | null; name: string; qty: number; price: number; }
interface SavedInvoice { id: string; store_id: string | null; invoice_no: string | null; date: string; items: any[]; tax_rate: number; subtotal: number; tax: number; total: number; created_at: string; }

const db = () => supabase as any;
const uid = () => crypto.randomUUID();

// ── Page ──────────────────────────────────────────────────────────────────────
function BillingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [storeId, setStoreId] = useState("");
  const [invDate, setInvDate] = useState(today);
  const [invNo, setInvNo] = useState("INV-" + String(Date.now()).slice(-4));
  const [taxRate, setTaxRate] = useState("8");
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const { data: stores = [] } = useQuery<BillingStore[]>({
    queryKey: ["billing-stores"],
    queryFn: async () => (await db().from("billing_stores").select("*").order("sub")).data ?? [],
  });

  const { data: history = [] } = useQuery<SavedInvoice[]>({
    queryKey: ["billing-invoices"],
    queryFn: async () => (await db().from("billing_invoices").select("*").order("created_at", { ascending: false }).limit(60)).data ?? [],
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ["billing-product-search", searchQ],
    enabled: searchQ.trim().length >= 2,
    queryFn: async () => {
      const q = searchQ.trim();
      const { data } = await supabase
        .from("products")
        .select("id, name, price, barcode, image_url")
        .or(`name.ilike.%${q}%,barcode.eq.${q}`)
        .limit(10);
      return data ?? [];
    },
  });

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.qty * i.price, 0), [items]);
  const tax = useMemo(() => Math.round(subtotal * (Number(taxRate) / 100)), [subtotal, taxRate]);
  const total = subtotal + tax;
  const selectedStore = stores.find(s => s.id === storeId) ?? null;

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { store_id: storeId || null, invoice_no: invNo, date: invDate, items: items.map(({ key: _k, ...rest }) => rest), tax_rate: Number(taxRate), subtotal, tax, total, created_by: user?.id ?? null };
      if (savedId) {
        const { data } = await db().from("billing_invoices").update(payload).eq("id", savedId).select().single();
        return data as SavedInvoice;
      }
      const { data } = await db().from("billing_invoices").insert(payload).select().single();
      return data as SavedInvoice;
    },
    onSuccess: (d) => { setSavedId(d.id); qc.invalidateQueries({ queryKey: ["billing-invoices"] }); },
  });

  const addProduct = useCallback((p: any) => {
    setItems(prev => [...prev, { key: uid(), product_id: p.id, name: p.name, qty: 1, price: p.price ?? 0 }]);
    setSearchQ(""); setSearchOpen(false); setSavedId(null);
  }, []);

  const removeItem = (key: string) => { setItems(p => p.filter(i => i.key !== key)); setSavedId(null); };

  const updateItem = (key: string, field: "qty" | "price" | "name", val: string) => {
    setItems(p => p.map(i => i.key === key ? { ...i, [field]: field === "name" ? val : Math.max(0, Number(val) || 0) } : i));
    setSavedId(null);
  };

  function reset() {
    setStoreId(""); setInvDate(today); setInvNo("INV-" + String(Date.now()).slice(-4));
    setTaxRate("8"); setItems([]); setSavedId(null);
  }

  function loadInvoice(inv: SavedInvoice) {
    setStoreId(inv.store_id ?? ""); setInvDate(inv.date); setInvNo(inv.invoice_no ?? "");
    setTaxRate(String(inv.tax_rate));
    setItems((Array.isArray(inv.items) ? inv.items : []).map((i: any) => ({ ...i, key: uid() })));
    setSavedId(inv.id);
  }

  async function handlePrint() {
    await saveMut.mutateAsync();
    setPrintOpen(true);
  }

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader eyebrow="Point of Sale" title="Billing" subtitle="Create invoices and print receipts for your shops." />

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">

        {/* ── New invoice ───────────────────────────────────────────────── */}
        <Card className="card-elevated p-5">
          {/* Store / Date / No */}
          <div className="grid sm:grid-cols-[1fr_150px_150px] gap-3 mb-4">
            <div>
              <Label className="upper-label mb-1.5 block">Store</Label>
              <Select value={storeId} onValueChange={v => { setStoreId(v); setSavedId(null); }}>
                <SelectTrigger><SelectValue placeholder="Select store…" /></SelectTrigger>
                <SelectContent>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}{s.sub ? ` — ${s.sub}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="upper-label mb-1.5 block">Date</Label>
              <Input type="date" value={invDate} onChange={e => { setInvDate(e.target.value); setSavedId(null); }} />
            </div>
            <div>
              <Label className="upper-label mb-1.5 block">Invoice No.</Label>
              <Input value={invNo} onChange={e => { setInvNo(e.target.value); setSavedId(null); }} />
            </div>
          </div>

          {/* Product search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search by product name or scan barcode…"
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 180)}
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute z-50 w-full top-full mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
                {(searchResults as any[]).map(p => (
                  <button
                    key={p.id}
                    onMouseDown={() => addProduct(p)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent/50 flex items-center gap-3"
                  >
                    {p.image_url
                      ? <img src={p.image_url} className="size-8 rounded object-cover shrink-0" />
                      : <div className="size-8 rounded bg-muted shrink-0 flex items-center justify-center"><Receipt className="size-4 text-muted-foreground" /></div>}
                    <span className="flex-1 font-medium truncate">{p.name}</span>
                    <span className="text-muted-foreground shrink-0">¥{(p.price ?? 0).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items table */}
          {items.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg py-14 text-center text-muted-foreground text-sm">
              Search a product above or add a manual row
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden mb-3">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs w-8">#</th>
                    <th className="text-left px-3 py-2 text-muted-foreground font-medium text-xs">Product</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium text-xs w-20">Qty</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium text-xs w-28">Unit ¥</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-medium text-xs w-24">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item, idx) => (
                    <tr key={item.key} className="hover:bg-muted/20">
                      <td className="px-3 py-1.5 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="px-2 py-1">
                        <Input
                          className="h-7 text-sm border-0 bg-transparent px-1 focus-visible:ring-1"
                          value={item.name}
                          onChange={e => updateItem(item.key, "name", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" min={1}
                          className="h-7 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-1 w-full"
                          value={item.qty}
                          onChange={e => updateItem(item.key, "qty", e.target.value)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number" min={0}
                          className="h-7 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-1 w-full"
                          value={item.price}
                          onChange={e => updateItem(item.key, "price", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                        ¥{(item.qty * item.price).toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeItem(item.key)} className="text-muted-foreground hover:text-destructive">
                          <X className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer: actions + totals */}
          <div className="flex items-end justify-between gap-4 mt-2 flex-wrap">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>
              <Button variant="outline" size="sm" onClick={() => { setItems(p => [...p, { key: uid(), product_id: null, name: "", qty: 1, price: 0 }]); setSavedId(null); }}>
                <Plus className="size-3.5 mr-1" /> Add row
              </Button>
            </div>

            <div className="text-right space-y-1 min-w-[210px]">
              <div className="flex justify-between gap-8 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">¥{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Tax</span>
                  <Input type="number" min={0} max={100} className="h-6 w-14 text-xs text-right" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
                <span className="tabular-nums">¥{tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-8 font-bold text-lg border-t border-border pt-1.5 mt-1">
                <span>Total</span>
                <span className="tabular-nums">¥{total.toLocaleString()}</span>
              </div>
              <Button
                className="gradient-primary text-primary-foreground border-0 w-full mt-2"
                disabled={items.length === 0 || saveMut.isPending}
                onClick={handlePrint}
              >
                <Printer className="size-4 mr-2" />
                {saveMut.isPending ? "Saving…" : "Print / Save Invoice"}
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Invoice history ───────────────────────────────────────────── */}
        <Card className="card-elevated p-5">
          <div className="upper-label mb-3 flex items-center gap-1.5">
            <History className="size-3.5" /> Invoice History
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No invoices yet</p>
          ) : (
            <ScrollArea className="h-[calc(100vh-260px)] min-h-[300px]">
              <div className="space-y-2 pr-1">
                {history.map(inv => {
                  const st = stores.find(s => s.id === inv.store_id);
                  return (
                    <button
                      key={inv.id}
                      onClick={() => loadInvoice(inv)}
                      className={cn(
                        "w-full text-left rounded-lg border border-border p-3 hover:bg-accent/40 transition-colors",
                        savedId === inv.id && "border-primary/50 bg-primary/5"
                      )}
                    >
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="font-mono text-xs font-semibold">{inv.invoice_no || "—"}</span>
                        <span className="text-xs text-muted-foreground">{inv.date}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {st ? `${st.name}${st.sub ? ` — ${st.sub}` : ""}` : "No store"}
                      </div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-xs text-muted-foreground">
                          {Array.isArray(inv.items) ? inv.items.length : 0} items
                        </span>
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

      {printOpen && (
        <PrintModal
          store={selectedStore}
          invNo={invNo}
          date={invDate}
          items={items}
          taxRate={Number(taxRate)}
          subtotal={subtotal}
          tax={tax}
          total={total}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}

// ── Print Modal ───────────────────────────────────────────────────────────────
function PrintModal({ store, invNo, date, items, taxRate, subtotal, tax, total, onClose }: {
  store: BillingStore | null;
  invNo: string; date: string;
  items: InvoiceItem[];
  taxRate: number; subtotal: number; tax: number; total: number;
  onClose: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);

  function doPrint() {
    const html = previewRef.current?.innerHTML ?? "";
    const w = window.open("", "_blank", "width=700,height=900");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>Invoice ${invNo}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px;max-width:580px;margin:0 auto}
.logo{text-align:center;font-size:24px;font-weight:900;letter-spacing:3px;margin-bottom:3px}
.store-sub{text-align:center;font-size:13px;color:#444;margin-bottom:2px}
.store-addr{text-align:center;font-size:11px;color:#777}
.store-tel{text-align:center;font-size:11px;color:#777;margin-bottom:4px}
hr{border:none;border-top:1px solid #d0d0d0;margin:10px 0}
.meta{display:flex;justify-content:space-between;font-size:11px;margin-bottom:14px;color:#555}
.meta b{color:#1a1a1a}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px}
thead th{padding:5px 4px;border-bottom:2px solid #1a1a1a;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#444}
thead th.r{text-align:right}
tbody td{padding:5px 4px;border-bottom:1px solid #efefef}
tbody td.r{text-align:right}
.totals{margin-left:auto;width:200px}
.trow{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:#444}
.grand{font-weight:700;font-size:16px;color:#1a1a1a;border-top:2px solid #1a1a1a;padding-top:5px;margin-top:4px}
.thanks{text-align:center;margin-top:22px;font-size:10px;color:#aaa}
@media print{body{padding:8px}}
</style>
</head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice Preview</DialogTitle>
        </DialogHeader>

        {/* Preview rendered in white */}
        <div ref={previewRef} className="bg-white text-black rounded border border-border p-6 font-sans text-sm">
          {/* Header */}
          <div className="logo">{store?.name ?? "MM-MART"}</div>
          {store?.sub && <div className="store-sub">{store.sub}</div>}
          {store?.address && <div className="store-addr">{store.address}</div>}
          {store?.tel && <div className="store-tel">Tel: {store.tel}</div>}

          <hr />

          <div className="meta">
            <div>Invoice No: <b>{invNo}</b></div>
            <div>Date: <b>{date}</b></div>
            {taxRate > 0 && <div>Tax: <b>{taxRate}%</b></div>}
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Product</th>
                <th className="r" style={{ width: 44 }}>Qty</th>
                <th className="r" style={{ width: 80 }}>Unit ¥</th>
                <th className="r" style={{ width: 80 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.key}>
                  <td style={{ color: "#888", fontSize: 11 }}>{i + 1}</td>
                  <td>{item.name}</td>
                  <td className="r">{item.qty}</td>
                  <td className="r">¥{item.price.toLocaleString()}</td>
                  <td className="r"><b>¥{(item.qty * item.price).toLocaleString()}</b></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals">
            <div className="trow"><span>Subtotal</span><span>¥{subtotal.toLocaleString()}</span></div>
            {taxRate > 0 && <div className="trow"><span>Tax ({taxRate}%)</span><span>¥{tax.toLocaleString()}</span></div>}
            <div className="trow grand"><span>TOTAL</span><span>¥{total.toLocaleString()}</span></div>
          </div>

          <div className="thanks">Thank you for your business!</div>
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
