import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Send, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/order-request")({ component: OrderRequest });

function OrderRequest() {
  const { role, user } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<"restock" | "new_order">("restock");
  const [productName, setProductName] = useState("");
  const [qty, setQty] = useState("10");
  const [notes, setNotes] = useState("");

  if (role && role !== "admin") return <Navigate to="/dashboard" />;

  const preview = `📦 ${type === "restock" ? "RESTOCK REQUEST" : "NEW ORDER REQUEST"}\n\nProduct: ${productName || "—"}\nQuantity: ${qty}\nRequested by: ${user?.email}\n${notes ? `Notes: ${notes}\n` : ""}\nDate: ${new Date().toLocaleString()}`;

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("order_requests").insert({
        type, product_name: productName, quantity: Number(qty),
        notes: notes || null, viber_message: preview, created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Order request submitted");
      setProductName(""); setQty("10"); setNotes("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <PageHeader title="Order Request" subtitle="Send orders to your Viber channel." />

      <Tabs value={type} onValueChange={(v: any) => setType(v)} className="mb-6">
        <TabsList>
          <TabsTrigger value="restock">Restock</TabsTrigger>
          <TabsTrigger value="new_order">New Order</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="card-elevated p-6 space-y-4">
          <div><Label>Product name</Label><Input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Coca-Cola 330ml" /></div>
          <div><Label>Quantity</Label><Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div><Label>Notes (optional)</Label><Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Supplier, deadline, special instructions…" /></div>
          <Button onClick={() => submit.mutate()} disabled={!productName || submit.isPending}
            className="w-full gradient-primary text-primary-foreground border-0">
            <Send className="size-4" /> Submit request
          </Button>
        </Card>

        <Card className="card-elevated p-0 overflow-hidden">
          <div className="bg-[oklch(0.55_0.18_295)] text-white p-3 flex items-center gap-2 text-sm">
            <MessageSquare className="size-4" /> Viber message preview
          </div>
          <div className="p-6 bg-secondary/40 min-h-[300px]">
            <div className="bg-card rounded-2xl p-4 max-w-sm shadow-md whitespace-pre-line text-sm">
              {preview}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
