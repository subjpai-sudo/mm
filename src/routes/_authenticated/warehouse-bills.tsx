import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink, ReceiptText, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { markWarehouseBillInvoiceGenerated, voidWarehouseBill, warehouseBillDownloadUrl, type IssuedBill } from "@/lib/warehouse-bills";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/warehouse-bills")({ component: WarehouseBillsPage });

type BillRow = {
  id: string;
  bill_no: string;
  destination_type: "delivery" | "shop";
  destination_label: string;
  customer_id: string | null;
  shop_id: string | null;
  status: "issued" | "sent_to_billing" | "invoiced" | "cancelled" | "deleted";
  billing_invoice_id: string | null;
  billing_invoice_url: string | null;
  subtotal: number | null;
  created_at: string;
  warehouse_bill_items?: Array<{
    id: string;
    name_snapshot: string;
    sku: string | null;
    qty_pcs: number;
    boxes: number;
    loose_pcs: number;
    pcs_per_case: number | null;
    default_price: number;
    line_total: number;
  }>;
};

function formatYen(value: number | null | undefined) {
  return `¥${Math.round(Number(value || 0)).toLocaleString("en-US")}`;
}

function statusTone(bill: BillRow) {
  if (bill.status === "cancelled") return "text-destructive border-destructive/30 bg-destructive/10";
  if (bill.status === "deleted") return "text-destructive border-destructive/30 bg-destructive/10";
  if (bill.billing_invoice_id) return "text-success border-success/30 bg-success/10";
  if (bill.status === "invoiced" || bill.status === "sent_to_billing") return "text-primary border-primary/30 bg-primary/10";
  return "text-warning border-warning/30 bg-warning/10";
}

function statusLabel(bill: BillRow) {
  if (bill.billing_invoice_id) return "Invoice saved";
  if (bill.status === "invoiced" || bill.status === "sent_to_billing") return "Invoice started";
  if (bill.status === "cancelled" || bill.status === "deleted") return "Deleted";
  return bill.status.replaceAll("_", " ");
}

function toIssuedBill(bill: BillRow): Pick<IssuedBill, "id" | "bill_no" | "customer_id" | "shop_id" | "destination_type"> {
  return {
    id: bill.id,
    bill_no: bill.bill_no,
    customer_id: bill.customer_id,
    shop_id: bill.shop_id,
    destination_type: bill.destination_type,
  };
}

function WarehouseBillsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: bills = [], isLoading } = useQuery<BillRow[]>({
    queryKey: ["warehouse-bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_bills")
        .select("id,bill_no,destination_type,destination_label,customer_id,shop_id,status,billing_invoice_id,billing_invoice_url,subtotal,created_at,warehouse_bill_items(id,name_snapshot,sku,qty_pcs,boxes,loose_pcs,pcs_per_case,default_price,line_total)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as BillRow[];
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (billId: string) => voidWarehouseBill(billId, user?.id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["warehouse-bills"] }),
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["movements-recent"] }),
      ]);
      toast.success("Bill voided and stock returned");
    },
    onError: (e: any) => toast.error(e.message ?? "Could not void bill"),
  });

  const invoiceMut = useMutation({
    mutationFn: async (bill: BillRow) => markWarehouseBillInvoiceGenerated(toIssuedBill(bill)),
    onSuccess: async (url) => {
      await qc.invalidateQueries({ queryKey: ["warehouse-bills"] });
      window.location.assign(url);
    },
    onError: (e: any) => toast.error(e.message ?? "Could not generate invoice"),
  });

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto">
      <PageHeader
        title="Warehouse Bills"
        subtitle="Packing-list bills created from Stock Out. Generate invoice opens the external billing system for final prices."
        actions={<Button className="gradient-primary text-primary-foreground border-0" onClick={() => window.location.assign("/stock-out")}><ReceiptText className="size-4" /> New stock-out bill</Button>}
      />

      <Card className="card-elevated overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Loading bills...</TableCell></TableRow>}
            {!isLoading && bills.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No warehouse bills yet.</TableCell></TableRow>}
            {bills.map((bill) => {
              const canVoid = bill.status === "issued" || ((bill.status === "invoiced" || bill.status === "sent_to_billing") && !bill.billing_invoice_id);
              const canGenerateInvoice = bill.status === "issued";
              const canFinishInvoice = (bill.status === "invoiced" || bill.status === "sent_to_billing") && !bill.billing_invoice_id;
              const canDownloadInvoice = Boolean(bill.billing_invoice_id);
              return (
                <TableRow key={bill.id}>
                  <TableCell>
                    <div className="font-mono font-bold text-sm">{bill.bill_no}</div>
                    <div className="text-[11px] text-muted-foreground">{bill.id}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{bill.destination_label}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{bill.destination_type}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={cn("capitalize", statusTone(bill))}>{statusLabel(bill)}</Badge></TableCell>
                  <TableCell>{bill.warehouse_bill_items?.length ?? 0}</TableCell>
                  <TableCell className="font-semibold">{formatYen(bill.subtotal)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(bill.created_at), "PP p")}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {canGenerateInvoice && (
                        <Button size="sm" className="gradient-primary text-primary-foreground border-0" disabled={invoiceMut.isPending} onClick={() => invoiceMut.mutate(bill)}>
                          <ExternalLink className="size-3.5" /> Generate invoice
                        </Button>
                      )}
                      {canFinishInvoice && (
                        <Button size="sm" variant="outline" onClick={() => window.location.assign(warehouseBillDownloadUrl({ ...toIssuedBill(bill), billing_invoice_id: bill.billing_invoice_id }))}>
                          <ExternalLink className="size-3.5" /> Finish invoice
                        </Button>
                      )}
                      {canDownloadInvoice && (
                        <Button size="sm" className="gradient-primary text-primary-foreground border-0" onClick={() => window.location.assign(warehouseBillDownloadUrl({ ...toIssuedBill(bill), billing_invoice_id: bill.billing_invoice_id }))}>
                          <ExternalLink className="size-3.5" /> Download invoice
                        </Button>
                      )}
                      {canVoid && (
                        <Button size="sm" variant="outline" className="text-destructive border-destructive/30" disabled={cancelMut.isPending} onClick={() => {
                          if (window.confirm(`Void ${bill.bill_no} and return stock?`)) cancelMut.mutate(bill.id);
                        }}>
                          {bill.status === "sent_to_billing" || bill.status === "invoiced" ? <RotateCcw className="size-3.5" /> : <XCircle className="size-3.5" />} Void bill
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
