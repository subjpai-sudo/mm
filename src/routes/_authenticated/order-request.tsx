import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Send, MessageSquare, AlertTriangle, ImageIcon, Plus, RotateCcw, Pencil } from "lucide-react";
import { sendOrderRequestAlert } from "@/lib/notifications.functions";

export const Route = createFileRoute("/_authenticated/order-request")({ component: OrderRequest });

function OrderRequest() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<"restock" | "new_order">("restock");
  const [productName, setProductName] = useState("");
  const [qty, setQty] = useState("10");
  const [notes, setNotes] = useState("");
  const [editTemplate, setEditTemplate] = useState(false);
  const [customMsg, setCustomMsg] = useState<string | null>(null);

  if (role && role !== "admin") return <Navigate to="/dashboard" />;

  const { data: lowStock = [] } = useQuery({
    queryKey: ["products", "low-stock"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("*").order("stock", { ascending: true });
      return (data ?? []).filter((p: any) => p.stock <= p.low_stock_threshold);
    },
  });

  const defaultPreview = `📦 ${type === "restock" ? "RESTOCK REQUEST" : "NEW ORDER REQUEST"}\n\nProduct: ${productName || "—"}\nQuantity: ${qty}\nRequested by: ${user?.email}\n${notes ? `Notes: ${notes}\n` : ""}\nDate: ${new Date().toLocaleString()}`;
  const preview = customMsg ?? defaultPreview;

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("order_requests").insert({
        type, product_name: productName, quantity: Number(qty),
        notes: notes || null, viber_message: preview, created_by: user?.id,
      });
      if (error) throw error;
      const r = await sendOrderRequestAlert({ data: { message: preview } }).catch(() => ({ sent: false, reason: "exception" as const }));
      return r;
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (r?.sent) toast.success("Request sent to Owner via Viber");
      else if (r?.reason === "viber-not-configured") toast.success("Request saved. Configure Viber in Settings to notify the owner.");
      else toast.success("Request saved. Viber delivery failed — check Settings.");
      setProductName(""); setQty("10"); setNotes(""); setCustomMsg(null); setEditTemplate(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const quickRestock = useMutation({
    mutationFn: async (p: any) => {
      const suggested = Math.max(p.low_stock_threshold * 3, 10);
      const msg = `📦 RESTOCK REQUEST\n\nProduct: ${p.name}\nSKU: ${p.sku ?? "—"}\nCurrent stock: ${p.stock}\nSuggested order: ${suggested}\nRequested by: ${user?.email}\nDate: ${new Date().toLocaleString()}`;
      const { error } = await supabase.from("order_requests").insert({
        type: "restock", product_name: p.name, quantity: suggested,
        notes: `Auto-suggested from low stock (current ${p.stock}, low at ${p.low_stock_threshold})`,
        viber_message: msg, created_by: user?.id,
      });
      if (error) throw error;
      await sendOrderRequestAlert({ data: { message: msg } }).catch(() => {});
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Restock request sent to Owner"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader title="Order Request" subtitle="Send restock and new-order requests to the Owner." />

      <Card className="card-elevated p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-warning/15 grid place-items-center text-warning"><AlertTriangle className="size-4" /></div>
            <div>
              <div className="font-semibold leading-tight">Low stock alerts</div>
              <div className="text-xs text-muted-foreground">{lowStock.length} item{lowStock.length === 1 ? "" : "s"} at or below threshold</div>
            </div>
          </div>
        </div>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">All items are well stocked. 🎉</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2 max-h-[320px] overflow-auto">
            {lowStock.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-border bg-secondary/40">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="size-12 rounded-lg object-cover border border-border" />
                ) : (
                  <div className="size-12 rounded-lg bg-secondary grid place-items-center text-muted-foreground border border-border"><ImageIcon className="size-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Stock <span className={p.stock === 0 ? "text-destructive font-semibold" : "text-warning font-semibold"}>{p.stock}</span> · low at {p.low_stock_threshold}
                  </div>
                </div>
                <Button size="sm" onClick={() => quickRestock.mutate(p)} disabled={quickRestock.isPending}
                  className="gradient-primary text-primary-foreground border-0 h-8 text-xs">
                  <Send className="size-3.5" /> Restock
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Tabs value={type} onValueChange={(v: any) => setType(v)} className="mb-6">
        <TabsList>
          <TabsTrigger value="restock"><Send className="size-3.5" /> Custom restock</TabsTrigger>
          <TabsTrigger value="new_order"><Plus className="size-3.5" /> New product order</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="card-elevated p-6 space-y-4">
          <div><Label>{type === "new_order" ? "New product / item to source" : "Product name"}</Label>
            <Input value={productName} onChange={e => setProductName(e.target.value)}
              placeholder={type === "new_order" ? "e.g. Imported wasabi paste 50g" : "e.g. Coca-Cola 330ml"} />
          </div>
          <div><Label>Quantity</Label><Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div><Label>Notes (optional)</Label>
            <Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={type === "new_order" ? "Why we need this, supplier ideas, target price, deadline…" : "Supplier, deadline, special instructions…"} />
          </div>
          <Button onClick={() => submit.mutate()} disabled={!productName || submit.isPending}
            className="w-full gradient-primary text-primary-foreground border-0">
            <Send className="size-4" /> Send to Owner
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Owner will be notified in-app instantly. WhatsApp / Viber delivery can be connected later in Settings.
          </p>
        </Card>

        <Card className="card-elevated p-0 overflow-hidden">
          <div className="bg-[oklch(0.55_0.18_295)] text-white p-3 flex items-center gap-2 text-sm">
            <MessageSquare className="size-4" /> Message {editTemplate ? "editor" : "preview"} (WhatsApp / Viber)
            <div className="ml-auto flex gap-1">
              {customMsg !== null && (
                <Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/10"
                  onClick={() => { setCustomMsg(null); }}>
                  <RotateCcw className="size-3.5" /> Reset
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/10"
                onClick={() => { if (!editTemplate && customMsg === null) setCustomMsg(defaultPreview); setEditTemplate(v => !v); }}>
                <Pencil className="size-3.5" /> {editTemplate ? "Done" : "Edit"}
              </Button>
            </div>
          </div>
          <div className="p-6 bg-secondary/40 min-h-[300px]">
            {editTemplate ? (
              <Textarea
                value={customMsg ?? defaultPreview}
                onChange={e => setCustomMsg(e.target.value)}
                rows={14}
                className="font-mono text-xs bg-card"
              />
            ) : (
              <div className="bg-card rounded-2xl p-4 max-w-sm shadow-md whitespace-pre-line text-sm">
                {preview}
              </div>
            )}
            {customMsg !== null && !editTemplate && (
              <p className="text-[11px] text-muted-foreground mt-2">Custom message — auto-update from form fields is paused. Click Reset to use the live template again.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
