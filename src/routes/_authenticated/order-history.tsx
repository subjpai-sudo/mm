import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/order-history")({ component: History });

function History() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => (await supabase.from("order_requests").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "declined" | "pending" }) => {
      const { error } = await supabase.from("order_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast.success("Status updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader title="Order History" subtitle={`${orders.length} requests on record`} />
      <Card className="card-elevated p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Product</TableHead>
            <TableHead>Qty</TableHead><TableHead>Status</TableHead>{(role === "admin" || role === "owner") && <TableHead>Actions</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {orders.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">No order requests</TableCell></TableRow>}
            {orders.map((o: any) => (
              <TableRow key={o.id}>
                <TableCell className="text-muted-foreground text-xs">{format(new Date(o.created_at), "PP p")}</TableCell>
                <TableCell><Badge variant="outline">{o.type === "restock" ? "Restock" : "New Order"}</Badge></TableCell>
                <TableCell className="font-medium">{o.product_name}</TableCell>
                <TableCell>{o.quantity}</TableCell>
                <TableCell>
                  {o.status === "approved" && <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/15"><Check className="size-3 mr-1" />Approved</Badge>}
                  {o.status === "pending" && <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/15"><Clock className="size-3 mr-1" />Pending</Badge>}
                  {o.status === "declined" && <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/15"><X className="size-3 mr-1" />Declined</Badge>}
                </TableCell>
                {(role === "admin" || role === "owner") && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: o.id, status: "approved" })}><Check className="size-4 text-success" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: o.id, status: "pending" })}><Clock className="size-4 text-warning" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: o.id, status: "declined" })}><X className="size-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
