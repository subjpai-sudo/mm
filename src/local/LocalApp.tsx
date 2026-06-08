import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../integrations/supabase/client";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  stock: number | null;
  price: number | null;
  default_price: number | null;
  pcs_per_case: number | null;
};

type Customer = { id: string; name: string; company: string | null };

type Tab = "products" | "stock-out";

function money(value: number | null | undefined) {
  return `¥${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

export function LocalApp() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productRes, customerRes] = await Promise.all([
        supabase.from("products").select("id,name,sku,barcode,stock,price,default_price,pcs_per_case").order("name"),
        (supabase as any).from("billing_customers").select("id,name,company").order("name"),
      ]);
      if (productRes.error) throw productRes.error;
      if (customerRes.error) throw customerRes.error;
      setProducts((productRes.data ?? []) as Product[]);
      setCustomers((customerRes.data ?? []) as Customer[]);
    } catch (e: any) {
      setError(e?.message ?? "Could not load local preview data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return products;
    return products.filter((p) => `${p.name} ${p.sku ?? ""} ${p.barcode ?? ""}`.toLowerCase().includes(text));
  }, [products, q]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur px-6 py-4">
        <div className="mx-auto max-w-6xl flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="upper-label">Local preview only</div>
            <h1 className="text-2xl font-semibold tracking-tight">CityStar Warehouse</h1>
            <p className="text-sm text-muted-foreground">Products and stock-out data check before deploy.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTab("products")} className={`px-4 py-2 rounded-lg border text-sm ${tab === "products" ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>MAIN Product List</button>
            <button onClick={() => setTab("stock-out")} className={`px-4 py-2 rounded-lg border text-sm ${tab === "stock-out" ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>Stock Out Bill Flow</button>
            <button onClick={load} className="px-4 py-2 rounded-lg border border-border bg-card text-sm">Refresh</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6 space-y-5">
        {error && <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
        {loading && <div className="rounded-xl border border-border bg-card p-6 text-muted-foreground">Loading warehouse data...</div>}

        {!loading && tab === "products" && (
          <section className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">MAIN Product List</h2>
                <p className="text-sm text-muted-foreground">Internal stock master: SKU, barcode, stock, price, pcs per box. No images, no PDF.</p>
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product, SKU, barcode" className="h-10 rounded-lg border border-border bg-background px-3 text-sm sm:w-80" />
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Product</th>
                    <th className="text-left p-3">SKU</th>
                    <th className="text-left p-3">Barcode</th>
                    <th className="text-right p-3">Stock</th>
                    <th className="text-right p-3">Pcs/Box</th>
                    <th className="text-right p-3">Default Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-3 font-medium">{p.name}</td>
                      <td className="p-3 text-muted-foreground">{p.sku || "-"}</td>
                      <td className="p-3 text-muted-foreground">{p.barcode || "-"}</td>
                      <td className="p-3 text-right">{Number(p.stock || 0).toLocaleString("en-US")}</td>
                      <td className="p-3 text-right">{p.pcs_per_case || "-"}</td>
                      <td className="p-3 text-right">{money(p.default_price ?? p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Showing {Math.min(filtered.length, 100)} of {filtered.length} matched products.</p>
          </section>
        )}

        {!loading && tab === "stock-out" && (
          <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Stock Out Destination</h2>
                <p className="text-sm text-muted-foreground">Delivery/customer selection check. Bill first, invoice later in billing system.</p>
              </div>
              <label className="text-sm font-medium">Route</label>
              <select className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm">
                <option>Delivery</option>
                <option>Shops</option>
              </select>
              <label className="text-sm font-medium">Customer / person</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm">
                <option value="">Select customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` - ${c.company}` : ""}</option>)}
              </select>
              <div className="rounded-lg bg-secondary p-3 text-sm">
                {selectedCustomer ? <>Selected: <b>{selectedCustomer.name}</b>{selectedCustomer.company ? ` (${selectedCustomer.company})` : ""}</> : "No customer selected yet."}
              </div>
              <a className="block rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary" href="https://billing-server-421265140321.asia-southeast1.run.app/" target="_blank" rel="noreferrer">Open billing system for invoice editing</a>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="font-semibold">Bill Preview Idea</h3>
              <p className="text-sm text-muted-foreground">Generated warehouse bill should reduce stock and save bill items. If invoice price needs changes, use Generate Invoice to continue in billing.</p>
              <div className="rounded-lg border border-dashed border-border p-4 text-sm">
                {"Bill ID -> Billing System -> Edit wholesale/customer price -> Invoice / credit note if needed."}
              </div>
              <h3 className="font-semibold pt-2">Available Products</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {products.slice(0, 12).map((p) => (
                  <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-muted-foreground">Stock {Number(p.stock || 0).toLocaleString("en-US")} | {money(p.default_price ?? p.price)}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
